import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse, conflictResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { formatAssignment } from '@/lib/formatters';

interface BatchUpdate {
    id: string;
    expectedUpdatedAt?: string; // 楽観的ロック用
    data: {
        assignedEmployeeId?: string;
        date?: string;
        sortOrder?: number;
        memberCount?: number;
        workers?: string[];
        vehicles?: string[];
        meetingTime?: string;
        remarks?: string;
        isDispatchConfirmed?: boolean;
        confirmedWorkerIds?: string[];
        confirmedVehicleIds?: string[];
        estimatedHours?: number;
    };
}

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

        const { updates } = await req.json() as { updates: BatchUpdate[] };

        if (!updates || !Array.isArray(updates)) {
            return validationErrorResponse('updates配列が必要です');
        }

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

                return prisma.projectAssignment.update({
                    where: { id: update.id },
                    data: updateData,
                });
            })
        );

        return NextResponse.json({ success: true, count: results.length });
    } catch (error) {
        return serverErrorResponse('配置の一括更新', error);
    }
}
