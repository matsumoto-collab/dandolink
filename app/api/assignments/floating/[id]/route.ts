import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    stringifyJsonField,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    conflictResponse,
} from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { formatAssignment } from '@/lib/formatters';
import { logger } from '@/lib/logger';
import { relocateAssignmentWorkItems } from '@/lib/relocateWorkItems';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { notifyUsers } from '@/lib/notifications';
import {
    notifyAssignmentReassigned,
    formatJpShortDate,
    SCHEDULE_CHANGED_TYPE,
} from '@/lib/scheduleChangeNotify';

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * POST /api/assignments/floating/[id] - 配置を浮き（班未定）に戻す＝降格
 *
 * 玉突き運用（浮き解消のため別現場の班を回す→その現場が浮く）を、旧来の
 * ダミー班付け替えではなく正規操作にする。「正門」の一部で、'unassigned' を
 * 書ける唯一のルート群。不変条件:
 *  - assignedEmployeeId='unassigned'・isDispatchConfirmed=false・確定職方/車両クリア
 *  - dateStatus は変更しない（仮予定を降格すると「仮の浮き」= 日付も班も未定になる）
 *  - 履歴記録（changeType='foreman'）・旧職長と案件担当者へ通知・楽観ロック対応
 *
 * body.date（ISO）を渡すと降格と同時に別日へ移動する（浮きレーンの別日セルへ
 * ドロップ/移動した場合）。日付が実際に変わったときは旧日付の作業明細を移送し
 * （孤児化＝原価二重計上の防止）、履歴に changeType='date' も併せて記録する。
 */
export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await req.json().catch(() => ({} as Record<string, unknown>));

        const current = await prisma.projectAssignment.findUnique({
            where: { id },
            include: { projectMaster: true },
        });
        if (!current) return notFoundResponse('配置');
        if (current.assignedEmployeeId === 'unassigned') {
            return errorResponse('この配置はすでに浮いています', 400);
        }

        if (body.expectedUpdatedAt) {
            const expectedTime = new Date(body.expectedUpdatedAt as string).getTime();
            if (expectedTime !== current.updatedAt.getTime()) {
                return conflictResponse(
                    '他のユーザーによって更新されています。最新のデータを確認してください。',
                    formatAssignment(current)
                );
            }
        }

        // 日付移動オプション: body.date があれば降格と同時に別日へ移す（浮きレーンの別日セルへドロップ/移動）
        const movingDate = typeof body.date === 'string' ? new Date(body.date) : null;
        const dateChanged = movingDate !== null && movingDate.getTime() !== current.date.getTime();

        const updated = await prisma.projectAssignment.update({
            where: { id },
            data: {
                assignedEmployeeId: 'unassigned',
                isDispatchConfirmed: false,
                confirmedWorkerIds: stringifyJsonField([]),
                confirmedVehicleIds: stringifyJsonField([]),
                ...(movingDate ? { date: movingDate } : {}),
                updatedBy: session!.user.id,
            },
            include: {
                projectMaster: true,
                assignmentWorkers: true,
                assignmentVehicles: true,
            },
        });

        // 別日へ動かした場合: 旧日付に残る作業明細を新日付の日報へ移送（孤児化＝原価二重計上を防止）
        if (dateChanged) {
            try {
                await relocateAssignmentWorkItems(id, current.date, updated.date, session!.user.id);
            } catch (e) {
                logger.error('[floating demote] 作業明細の移送に失敗', e);
            }
        }

        // 履歴: 職長変更として記録（new='unassigned'）。別日移動を伴う場合は日付変更も併せて記録。
        // 仮/確定の状態はそのまま残る。changeType='date' の値は既存互換で ISO 文字列。
        try {
            const historyEntries = [
                {
                    assignmentId: id,
                    changedById: session!.user.id,
                    changeType: 'foreman',
                    previousValue: current.assignedEmployeeId,
                    newValue: 'unassigned',
                },
            ];
            if (dateChanged) {
                historyEntries.push({
                    assignmentId: id,
                    changedById: session!.user.id,
                    changeType: 'date',
                    previousValue: current.date.toISOString(),
                    newValue: updated.date.toISOString(),
                });
            }
            await prisma.scheduleChangeHistory.createMany({ data: historyEntries });
        } catch (e) {
            logger.error('[floating demote] 履歴記録に失敗', e);
        }

        const pmLite = updated.projectMaster
            ? {
                  name: updated.projectMaster.name,
                  title: updated.projectMaster.title,
                  constructionSuffixId: updated.projectMaster.constructionSuffixId,
              }
            : null;

        // 旧職長へ「担当から外れました」（'unassigned' 側の宛先はユーザー不在で自動スキップされる）
        try {
            await notifyAssignmentReassigned({
                actorUserId: session!.user.id,
                assignmentId: id,
                fromForemanId: current.assignedEmployeeId,
                toForemanId: 'unassigned',
                date: updated.date,
                projectMasterId: updated.projectMasterId,
                projectMaster: pmLite,
            });
        } catch (e) {
            logger.error('[floating demote] 旧職長への通知に失敗', e);
        }

        // 案件担当者へ「浮きに戻された」ことを通知（操作者本人と退職者は除外・best-effort）
        try {
            const assigneeIds = extractAssigneeIds(current.projectMaster?.createdBy ?? undefined)
                .filter((uid) => uid !== session!.user.id);
            if (assigneeIds.length > 0) {
                const activeUsers = await prisma.user.findMany({
                    where: { id: { in: assigneeIds }, isActive: true },
                    select: { id: true },
                });
                if (activeUsers.length > 0) {
                    const site = current.projectMaster?.name || current.projectMaster?.title || '案件';
                    await notifyUsers({
                        userIds: activeUsers.map((u) => u.id),
                        type: SCHEDULE_CHANGED_TYPE,
                        title: `【浮きに変更】${site}`,
                        body: `${formatJpShortDate(updated.date)} の配置が浮き（班未定）に戻されました`,
                        url: '/?page=schedule&view=assignment',
                        pushTag: `schedule-${id}`,
                        data: { assignmentId: id, kind: 'demoted-to-floating' },
                    });
                }
            }
        } catch (e) {
            logger.error('[floating demote] 案件担当者への通知に失敗', e);
        }

        return NextResponse.json(formatAssignment(updated));
    } catch (error) {
        return serverErrorResponse('浮きへの変更', error);
    }
}
