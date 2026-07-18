import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    stringifyJsonField,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
} from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { formatAssignment } from '@/lib/formatters';

interface SnapshotShape {
    assignedEmployeeId: string;
    date: string;
    memberCount?: number;
    workers?: string[];
    vehicles?: string[];
    meetingTime?: string | null;
    sortOrder?: number;
    remarks?: string | null;
    dispatchRemark?: string | null;
    constructionType?: string | null;
    estimatedHours?: number;
    isDispatchConfirmed?: boolean;
    confirmedWorkerIds?: string[];
    confirmedVehicleIds?: string[];
    dateStatus?: string;
    confirmDueDate?: string | null;
}

/**
 * POST /api/assignments/restore - 削除した配置を控え（DeletedAssignmentLog）から復元する。
 * body: { logId }
 * 物理削除→再作成のため新しい配置IDで作られる。二重復元は restoredAt で防ぐ。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const { logId } = await req.json();
        if (!logId || typeof logId !== 'string') {
            return errorResponse('logId が必要です', 400);
        }

        const log = await prisma.deletedAssignmentLog.findUnique({ where: { id: logId } });
        if (!log) return notFoundResponse('削除控え');
        if (log.restoredAt) {
            // 二重復元を防ぐ（トーストUndoと履歴パネルの両方から復元され得るため）
            return NextResponse.json({ error: 'この配置はすでに復元されています' }, { status: 409 });
        }

        const snap = JSON.parse(log.snapshot) as SnapshotShape;
        const workers = Array.isArray(snap.workers) ? snap.workers : [];
        const vehicles = Array.isArray(snap.vehicles) ? snap.vehicles : [];

        const created = await prisma.projectAssignment.create({
            data: {
                projectMasterId: log.projectMasterId,
                assignedEmployeeId: snap.assignedEmployeeId,
                date: new Date(snap.date),
                memberCount: snap.memberCount || 0,
                workers: stringifyJsonField(workers),
                vehicles: stringifyJsonField(vehicles),
                meetingTime: snap.meetingTime || null,
                sortOrder: snap.sortOrder || 0,
                remarks: snap.remarks || null,
                dispatchRemark: snap.dispatchRemark || null,
                constructionType: snap.constructionType || null,
                estimatedHours: snap.estimatedHours ?? 8.0,
                isDispatchConfirmed: snap.isDispatchConfirmed || false,
                confirmedWorkerIds: stringifyJsonField(snap.confirmedWorkerIds ?? []),
                confirmedVehicleIds: stringifyJsonField(snap.confirmedVehicleIds ?? []),
                dateStatus: snap.dateStatus === 'tentative' ? 'tentative' : 'confirmed',
                confirmDueDate: snap.confirmDueDate ? new Date(snap.confirmDueDate) : null,
                updatedBy: session!.user.id,
                assignmentWorkers: { create: workers.map((w) => ({ workerName: w })) },
                assignmentVehicles: { create: vehicles.map((v) => ({ vehicleName: v })) },
            },
            include: {
                projectMaster: true,
                assignmentWorkers: true,
                assignmentVehicles: true,
            },
        });

        await prisma.deletedAssignmentLog.update({
            where: { id: logId },
            data: { restoredAt: new Date(), restoredById: session!.user.id },
        });

        return NextResponse.json(formatAssignment(created));
    } catch (error) {
        return serverErrorResponse('配置の復元', error);
    }
}
