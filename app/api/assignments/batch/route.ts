import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse, conflictResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { formatAssignment } from '@/lib/formatters';
import { batchUpdateAssignmentsSchema, validateRequest } from '@/lib/validations';
import { logger } from '@/lib/logger';
import { relocateAssignmentWorkItems } from '@/lib/relocateWorkItems';
import { notifyAssignmentMoved, notifyAssignmentReassigned } from '@/lib/scheduleChangeNotify';

/**
 * POST /api/assignments/batch - 配置の一括更新
 * 楽観的ロック対応: 1件でも競合があれば全体をロールバック
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!canDispatch(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const body = await req.json();
        const validation = validateRequest(batchUpdateAssignmentsSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const { updates } = validation.data;

        // 楽観的ロック: expectedUpdatedAtが指定されている更新がある場合、先に競合チェック
        const updatesWithLock = updates.filter(u => u.expectedUpdatedAt);
        if (updatesWithLock.length > 0) {
            const ids = updatesWithLock.map(u => u.id);
            const currentRecords = await prisma.projectAssignment.findMany({
                where: { id: { in: ids } },
                include: { projectMaster: true },
            });

            const currentMap = new Map(currentRecords.map(r => [r.id, r]));

            for (const update of updatesWithLock) {
                const current = currentMap.get(update.id);
                if (!current) {
                    return validationErrorResponse(`配置 ${update.id} が見つかりません`);
                }

                const expectedTime = new Date(update.expectedUpdatedAt!).getTime();
                const actualTime = current.updatedAt.getTime();

                if (expectedTime !== actualTime) {
                    // 競合検出: 他のユーザーが先に更新している
                    return conflictResponse(
                        `配置「${current.projectMaster?.title || update.id}」が他のユーザーによって更新されています。`,
                        formatAssignment(current)
                    );
                }
            }
        }

        // 日付変更を含む更新の旧日付を控える（リスケ後に作業明細を新日付へ移送するため）。
        // あわせて担当職長への変更通知のため、日付/担当が変わる配置の旧状態をまとめて控える。
        const dateChanges = updates.filter(u => u.data.date !== undefined);
        const changedUpdates = updates.filter(
            u => u.data.date !== undefined || u.data.assignedEmployeeId !== undefined,
        );
        const oldStateMap = new Map<
            string,
            { date: Date; assignedEmployeeId: string; projectMasterId: string }
        >();
        if (changedUpdates.length > 0) {
            const recs = await prisma.projectAssignment.findMany({
                where: { id: { in: changedUpdates.map(u => u.id) } },
                select: { id: true, date: true, assignedEmployeeId: true, projectMasterId: true },
            });
            for (const r of recs) {
                oldStateMap.set(r.id, {
                    date: r.date,
                    assignedEmployeeId: r.assignedEmployeeId,
                    projectMasterId: r.projectMasterId,
                });
            }
        }

        const results = await prisma.$transaction(
            updates.map(update => {
                const updateData: Record<string, unknown> = {};
                if (update.data.assignedEmployeeId !== undefined) updateData.assignedEmployeeId = update.data.assignedEmployeeId;
                if (update.data.date !== undefined) updateData.date = new Date(update.data.date);
                if (update.data.sortOrder !== undefined) updateData.sortOrder = update.data.sortOrder;
                if (update.data.memberCount !== undefined) updateData.memberCount = update.data.memberCount;
                if (update.data.workers !== undefined) updateData.workers = stringifyJsonField(update.data.workers);
                if (update.data.vehicles !== undefined) updateData.vehicles = stringifyJsonField(update.data.vehicles);
                if (update.data.meetingTime !== undefined) updateData.meetingTime = update.data.meetingTime;
                if (update.data.remarks !== undefined) updateData.remarks = update.data.remarks;
                if (update.data.isDispatchConfirmed !== undefined) updateData.isDispatchConfirmed = update.data.isDispatchConfirmed;
                if (update.data.confirmedWorkerIds !== undefined) updateData.confirmedWorkerIds = stringifyJsonField(update.data.confirmedWorkerIds);
                if (update.data.confirmedVehicleIds !== undefined) updateData.confirmedVehicleIds = stringifyJsonField(update.data.confirmedVehicleIds);
                if (update.data.estimatedHours !== undefined) updateData.estimatedHours = update.data.estimatedHours;
                updateData.updatedBy = session!.user.id;

                return prisma.projectAssignment.update({
                    where: { id: update.id },
                    data: updateData,
                });
            })
        );

        // 別日へ動かした配置は、旧日付に残る作業明細を新日付へ移送（孤児化＝原価二重計上を防止）
        for (const u of dateChanges) {
            const oldDate = oldStateMap.get(u.id)?.date;
            if (!oldDate) continue;
            try {
                await relocateAssignmentWorkItems(u.id, oldDate, new Date(u.data.date!), session!.user.id);
            } catch (e) {
                logger.error('[assignments batch] 作業明細の移送に失敗', e);
            }
        }

        // 担当職長へ予定変更を即時通知（向こう1週間以内のみ・自己除外・best-effort）
        const notifyTargets = changedUpdates
            .map(u => {
                const old = oldStateMap.get(u.id);
                if (!old) return null;
                const newForeman = u.data.assignedEmployeeId;
                const foremanChanged = newForeman !== undefined && newForeman !== old.assignedEmployeeId;
                const newDate = u.data.date !== undefined ? new Date(u.data.date) : null;
                const dateChanged = newDate !== null && newDate.toISOString() !== old.date.toISOString();
                return { u, old, foremanChanged, newForeman, newDate, dateChanged };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null && (x.foremanChanged || x.dateChanged));

        if (notifyTargets.length > 0) {
            const pmIds = Array.from(new Set(notifyTargets.map(t => t.old.projectMasterId)));
            const pms = await prisma.projectMaster.findMany({
                where: { id: { in: pmIds } },
                select: { id: true, name: true, title: true, constructionSuffixId: true },
            });
            const pmById = new Map(pms.map(pm => [pm.id, pm]));

            for (const t of notifyTargets) {
                const pm = pmById.get(t.old.projectMasterId);
                const pmLite = pm
                    ? { name: pm.name, title: pm.title, constructionSuffixId: pm.constructionSuffixId }
                    : null;
                try {
                    if (t.foremanChanged) {
                        await notifyAssignmentReassigned({
                            actorUserId: session!.user.id,
                            assignmentId: t.u.id,
                            fromForemanId: t.old.assignedEmployeeId,
                            toForemanId: t.newForeman as string,
                            date: t.newDate ?? t.old.date,
                            projectMasterId: t.old.projectMasterId,
                            projectMaster: pmLite,
                        });
                    } else if (t.dateChanged && t.newDate) {
                        await notifyAssignmentMoved({
                            actorUserId: session!.user.id,
                            assignmentId: t.u.id,
                            foremanId: t.old.assignedEmployeeId,
                            fromDate: t.old.date,
                            toDate: t.newDate,
                            projectMasterId: t.old.projectMasterId,
                            projectMaster: pmLite,
                        });
                    }
                } catch (e) {
                    logger.error('[assignments batch] 予定変更通知に失敗', e);
                }
            }
        }

        return NextResponse.json({ success: true, count: results.length, results: results.map(r => ({ id: r.id, updatedAt: r.updatedAt, updatedBy: r.updatedBy })) });
    } catch (error) {
        return serverErrorResponse('配置の一括更新', error);
    }
}
