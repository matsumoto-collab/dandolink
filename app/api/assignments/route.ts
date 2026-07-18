import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { createAssignmentSchema, validateRequest } from '@/lib/validations';
import { formatAssignment } from '@/lib/formatters';
import { logger } from '@/lib/logger';
import { notifyAssignmentsCreated } from '@/lib/scheduleChangeNotify';

/**
 * GET /api/assignments - 配置一覧取得
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const assignedEmployeeId = searchParams.get('assignedEmployeeId');
        const projectMasterId = searchParams.get('projectMasterId');
        const idsParam = searchParams.get('ids');

        const where: Record<string, unknown> = {};

        // Realtime同期のまとめ取り用: id指定の一括取得（上限100件）
        if (idsParam) {
            const ids = idsParam.split(',').filter(Boolean).slice(0, 100);
            if (ids.length === 0) return NextResponse.json([]);
            where.id = { in: ids };
        }
        if (startDate || endDate) {
            where.date = {};
            if (startDate) (where.date as Record<string, Date>).gte = new Date(startDate);
            if (endDate) (where.date as Record<string, Date>).lte = new Date(endDate);
        }
        if (assignedEmployeeId) where.assignedEmployeeId = assignedEmployeeId;
        if (projectMasterId) where.projectMasterId = projectMasterId;

        const assignments = await prisma.projectAssignment.findMany({
            where,
            include: {
                projectMaster: true,
                assignmentWorkers: true,
                assignmentVehicles: true,
            },
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
        });

        return NextResponse.json(assignments.map(formatAssignment), {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('配置一覧の取得', error);
    }
}

/**
 * POST /api/assignments - 配置作成
 */
export async function POST(req: NextRequest) {
    const rateLimitError = await applyRateLimit(req, RATE_LIMITS.api);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const body = await req.json();
        const validation = validateRequest(createAssignmentSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error, validation.details);

        const { projectMasterId, assignedEmployeeId, date, memberCount, workers, vehicles, meetingTime, sortOrder, remarks, isDispatchConfirmed, confirmedWorkerIds, confirmedVehicleIds, estimatedHours, dateStatus, confirmDueDate } = validation.data;
        const constructionType = body.constructionType; // バリデーションスキーマ外で取得

        // 一意制約を削除したため、重複チェックは不要（同一案件・同一職長・同一日付で複数配置可能）

        const assignment = await prisma.projectAssignment.create({
            data: {
                projectMasterId, assignedEmployeeId, date: new Date(date),
                memberCount: memberCount || 0, workers: stringifyJsonField(workers), vehicles: stringifyJsonField(vehicles),
                meetingTime: meetingTime || null, sortOrder: sortOrder || 0, remarks: remarks || null,
                isDispatchConfirmed: isDispatchConfirmed || false,
                confirmedWorkerIds: stringifyJsonField(confirmedWorkerIds), confirmedVehicleIds: stringifyJsonField(confirmedVehicleIds),
                constructionType: constructionType || null,
                estimatedHours: estimatedHours ?? 8.0,
                dateStatus: dateStatus ?? 'confirmed',
                confirmDueDate: confirmDueDate ? new Date(confirmDueDate) : null,
                updatedBy: session!.user.id,

                assignmentWorkers: {
                    create: Array.isArray(workers) ? workers.map((w: string) => ({ workerName: w })) : [],
                },
                assignmentVehicles: {
                    create: Array.isArray(vehicles) ? vehicles.map((v: string) => ({ vehicleName: v })) : [],
                },
            },
            include: {
                projectMaster: true,
                assignmentWorkers: true,
                assignmentVehicles: true,
            },
        });

        // 変更履歴: 誰がいつ登録したかを残す（best-effort）
        try {
            await prisma.scheduleChangeHistory.create({
                data: {
                    assignmentId: assignment.id,
                    changedById: session!.user.id,
                    changeType: 'created',
                    previousValue: '',
                    newValue: '登録',
                },
            });
        } catch (e) {
            logger.error('[assignments POST] 登録履歴の記録に失敗', e);
        }

        // 担当職長へ新規予定を即時通知（向こう1週間以内のみ・自己除外・best-effort）
        try {
            await notifyAssignmentsCreated({
                actorUserId: session!.user.id,
                items: [
                    {
                        assignmentId: assignment.id,
                        foremanId: assignment.assignedEmployeeId,
                        projectMasterId: assignment.projectMasterId,
                        date: assignment.date,
                    },
                ],
            });
        } catch (e) {
            logger.error('[assignments POST] 新規予定通知に失敗', e);
        }

        return NextResponse.json(formatAssignment(assignment));
    } catch (error) {
        return serverErrorResponse('配置の作成', error);
    }
}
