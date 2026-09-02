import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { createFloatingAssignmentSchema, validateRequest } from '@/lib/validations';
import { formatAssignment } from '@/lib/formatters';
import { logger } from '@/lib/logger';

/**
 * POST /api/assignments/floating - 浮き（班未定の配置）の新規作成
 *
 * 「正門」方式: assignedEmployeeId='unassigned' を書けるのは /api/assignments/floating/*
 * ルート群だけ。通常の作成/更新経路は全て 'unassigned' を拒否している（孤児配置の再発防止）。
 * 浮きは実際には行かない班に載せる旧運用（ダミー班＋マイナス表示）の置き換えで、
 * 週間カレンダー最下部の「浮いている」レーンに描画される。
 */
export async function POST(req: NextRequest) {
    const rateLimitError = await applyRateLimit(req, RATE_LIMITS.api);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const body = await req.json();
        const validation = validateRequest(createFloatingAssignmentSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error, validation.details);

        const { projectMasterId, date, memberCount, remarks, constructionType, estimatedHours, dateStatus, confirmDueDate } = validation.data;

        const assignment = await prisma.projectAssignment.create({
            data: {
                projectMasterId,
                assignedEmployeeId: 'unassigned', // サーバー固定（クライアントからは受け取らない）
                date: new Date(date),
                memberCount: memberCount || 0,
                workers: stringifyJsonField([]),
                vehicles: stringifyJsonField([]),
                sortOrder: 0,
                remarks: remarks || null,
                constructionType: constructionType || null,
                estimatedHours: estimatedHours ?? 8.0,
                isDispatchConfirmed: false, // 固定（班が無いのに手配確定はあり得ない）
                dateStatus: dateStatus ?? 'confirmed',
                confirmDueDate: confirmDueDate ? new Date(confirmDueDate) : null,
                updatedBy: session!.user.id,
            },
            include: {
                projectMaster: true,
                assignmentWorkers: true,
                assignmentVehicles: true,
                assignmentTools: true,
            },
        });

        // 変更履歴: 誰がいつ浮きとして登録したかを残す（best-effort）
        try {
            await prisma.scheduleChangeHistory.create({
                data: {
                    assignmentId: assignment.id,
                    changedById: session!.user.id,
                    changeType: 'created',
                    previousValue: '',
                    newValue: '浮きとして登録',
                },
            });
        } catch (e) {
            logger.error('[assignments floating POST] 登録履歴の記録に失敗', e);
        }

        return NextResponse.json(formatAssignment(assignment));
    } catch (error) {
        return serverErrorResponse('浮き配置の作成', error);
    }
}
