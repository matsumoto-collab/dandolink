import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';

interface BatchUpdate {
    id: string;
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
    };
}

/**
 * POST /api/assignments/batch - 配置の一括更新
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
