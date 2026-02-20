import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { formatAssignment } from '@/lib/formatters';

interface BatchCreateAssignment {
    projectMasterId: string;
    assignedEmployeeId: string;
    date: string;
    memberCount?: number;
    workers?: string[];
    vehicles?: string[];
    meetingTime?: string;
    sortOrder?: number;
    remarks?: string;
    constructionType?: string;
    estimatedHours?: number;
}

/**
 * POST /api/assignments/batch-create - 配置の一括作成
 * 複数日スケジュール登録のパフォーマンス改善のため、1回のリクエストで複数の配置を作成
 */
export async function POST(req: NextRequest) {
    const rateLimitError = applyRateLimit(req, RATE_LIMITS.api);
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
        }

        // トランザクションで一括作成（includeなし - IDのみ取得）
        const created = await prisma.$transaction(
            assignments.map((a) =>
                prisma.projectAssignment.create({
                    data: {
                        projectMasterId: a.projectMasterId,
                        assignedEmployeeId: a.assignedEmployeeId,
                        date: new Date(a.date),
                        memberCount: a.memberCount || 0,
                        workers: stringifyJsonField(a.workers),
                        vehicles: stringifyJsonField(a.vehicles),
                        meetingTime: a.meetingTime || null,
                        sortOrder: a.sortOrder || 0,
                        remarks: a.remarks || null,
                        constructionType: a.constructionType || null,
                        estimatedHours: a.estimatedHours ?? 8.0,
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
            },
        });

        return NextResponse.json(results.map(formatAssignment));
    } catch (error) {
        return serverErrorResponse('配置の一括作成', error);
    }
}
