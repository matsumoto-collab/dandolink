import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { formatAssignment } from '@/lib/formatters';
import { logger } from '@/lib/logger';
import { notifyAssignmentsCreated } from '@/lib/scheduleChangeNotify';
import { buildAssignmentToolRowsBatch } from '@/lib/assignmentTools';

interface BatchCreateAssignment {
    projectMasterId: string;
    assignedEmployeeId: string;
    date: string;
    memberCount?: number;
    workers?: string[];
    vehicles?: string[];
    /** 電動工具（Tool.id の配列） */
    tools?: string[];
    meetingTime?: string;
    sortOrder?: number;
    remarks?: string;
    constructionType?: string;
    estimatedHours?: number;
    dateStatus?: string;
    confirmDueDate?: string | null;
}

/**
 * POST /api/assignments/batch-create - 配置の一括作成
 * 複数日スケジュール登録のパフォーマンス改善のため、1回のリクエストで複数の配置を作成
 */
export async function POST(req: NextRequest) {
    const rateLimitError = await applyRateLimit(req, RATE_LIMITS.api);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!canDispatch(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const { assignments } = await req.json() as { assignments: BatchCreateAssignment[] };

        if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
            return validationErrorResponse('assignments配列が必要です');
        }

        // 最大100件までの制限
        if (assignments.length > 100) {
            return validationErrorResponse('一度に作成できる配置は最大100件までです');
        }

        // 必須フィールドのバリデーション
        for (let i = 0; i < assignments.length; i++) {
            const a = assignments[i];
            if (!a.projectMasterId || !a.assignedEmployeeId || !a.date) {
                return validationErrorResponse(
                    `配置[${i}]: projectMasterId, assignedEmployeeId, date は必須です`
                );
            }
            // 'unassigned' は職長行が無くカレンダーに描画されない孤児配置になるため拒否（単発POSTのzodと同じガード）
            if (a.assignedEmployeeId === 'unassigned') {
                return validationErrorResponse(`配置[${i}]: 職長が選択されていません`);
            }
        }

        // 工具名のスナップショットは1回の SELECT でまとめて解決する
        const toolRowsPerAssignment = await buildAssignmentToolRowsBatch(assignments.map((a) => a.tools));

        // トランザクションで一括作成（includeなし - IDのみ取得）
        const created = await prisma.$transaction(
            assignments.map((a, i) =>
                prisma.projectAssignment.create({
                    data: {
                        projectMasterId: a.projectMasterId,
                        assignedEmployeeId: a.assignedEmployeeId,
                        date: new Date(a.date),
                        memberCount: a.memberCount || 0,
                        workers: stringifyJsonField(a.workers),
                        vehicles: stringifyJsonField(a.vehicles),
                        tools: stringifyJsonField(toolRowsPerAssignment[i].map((t) => t.toolId)),
                        meetingTime: a.meetingTime || null,
                        sortOrder: a.sortOrder || 0,
                        remarks: a.remarks || null,
                        constructionType: a.constructionType || null,
                        estimatedHours: a.estimatedHours ?? 8.0,
                        dateStatus: a.dateStatus === 'tentative' ? 'tentative' : 'confirmed',
                        confirmDueDate: a.confirmDueDate ? new Date(a.confirmDueDate) : null,
                        updatedBy: session!.user.id,
                        assignmentWorkers: {
                            create: Array.isArray(a.workers)
                                ? a.workers.map((w: string) => ({ workerName: w }))
                                : [],
                        },
                        assignmentVehicles: {
                            create: Array.isArray(a.vehicles)
                                ? a.vehicles.map((v: string) => ({ vehicleName: v }))
                                : [],
                        },
                        assignmentTools: {
                            create: toolRowsPerAssignment[i],
                        },
                    },
                    select: { id: true },
                })
            )
        );

        // 作成したID一覧で1回のfindManyにまとめてinclude（N回→1回）
        const results = await prisma.projectAssignment.findMany({
            where: { id: { in: created.map((c) => c.id) } },
            include: {
                projectMaster: true,
                assignmentWorkers: true,
                assignmentVehicles: true,
                assignmentTools: true,
            },
        });

        // 変更履歴: 誰がいつ登録したかを残す（best-effort）
        try {
            await prisma.scheduleChangeHistory.createMany({
                data: created.map((c) => ({
                    assignmentId: c.id,
                    changedById: session!.user.id,
                    changeType: 'created',
                    previousValue: '',
                    newValue: '登録',
                })),
            });
        } catch (e) {
            logger.error('[assignments batch-create] 登録履歴の記録に失敗', e);
        }

        // 担当職長へ新規予定を即時通知（向こう1週間以内のみ・職長単位で集約・自己除外・best-effort）
        try {
            await notifyAssignmentsCreated({
                actorUserId: session!.user.id,
                items: results.map((r) => ({
                    assignmentId: r.id,
                    foremanId: r.assignedEmployeeId,
                    projectMasterId: r.projectMasterId,
                    date: r.date,
                })),
            });
        } catch (e) {
            logger.error('[assignments batch-create] 新規予定通知に失敗', e);
        }

        return NextResponse.json(results.map(formatAssignment));
    } catch (error) {
        return serverErrorResponse('配置の一括作成', error);
    }
}
