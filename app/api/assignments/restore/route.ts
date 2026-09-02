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
import { buildAssignmentToolRows, normalizeToolIds } from '@/lib/assignmentTools';

interface SnapshotShape {
    assignedEmployeeId: string;
    date: string;
    memberCount?: number;
    workers?: string[];
    vehicles?: string[];
    /** 電動工具（Tool.id の配列） */
    tools?: string[];
    meetingTime?: string | null;
    sortOrder?: number;
    remarks?: string | null;
    dispatchRemark?: string | null;
    constructionType?: string | null;
    estimatedHours?: number;
    isDispatchConfirmed?: boolean;
    confirmedWorkerIds?: string[];
    confirmedVehicleIds?: string[];
    confirmedToolIds?: string[];
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
        // 工具は Tool.id の控え。復元時点で消えている工具は落ちる（名前は今の値で取り直す）
        const toolRows = await buildAssignmentToolRows(snap.tools);

        const created = await prisma.projectAssignment.create({
            data: {
                projectMasterId: log.projectMasterId,
                assignedEmployeeId: snap.assignedEmployeeId,
                date: new Date(snap.date),
                memberCount: snap.memberCount || 0,
                workers: stringifyJsonField(workers),
                vehicles: stringifyJsonField(vehicles),
                tools: stringifyJsonField(toolRows.map((t) => t.toolId)),
                meetingTime: snap.meetingTime || null,
                sortOrder: snap.sortOrder || 0,
                remarks: snap.remarks || null,
                dispatchRemark: snap.dispatchRemark || null,
                constructionType: snap.constructionType || null,
                estimatedHours: snap.estimatedHours ?? 8.0,
                isDispatchConfirmed: snap.isDispatchConfirmed || false,
                confirmedWorkerIds: stringifyJsonField(snap.confirmedWorkerIds ?? []),
                confirmedVehicleIds: stringifyJsonField(snap.confirmedVehicleIds ?? []),
                confirmedToolIds: stringifyJsonField(normalizeToolIds(snap.confirmedToolIds)),
                dateStatus: snap.dateStatus === 'tentative' ? 'tentative' : 'confirmed',
                confirmDueDate: snap.confirmDueDate ? new Date(snap.confirmDueDate) : null,
                updatedBy: session!.user.id,
                assignmentWorkers: { create: workers.map((w) => ({ workerName: w })) },
                assignmentVehicles: { create: vehicles.map((v) => ({ vehicleName: v })) },
                assignmentTools: { create: toolRows },
            },
            include: {
                projectMaster: true,
                assignmentWorkers: true,
                assignmentVehicles: true,
                assignmentTools: true,
            },
        });

        await prisma.deletedAssignmentLog.update({
            where: { id: logId },
            data: { restoredAt: new Date(), restoredById: session!.user.id },
        });

        // 変更履歴: 誰がいつ復元したかを残す（best-effort。復元は新IDで作られるため履歴もそこに付く）
        try {
            await prisma.scheduleChangeHistory.create({
                data: {
                    assignmentId: created.id,
                    changedById: session!.user.id,
                    changeType: 'restored',
                    previousValue: '',
                    newValue: '削除から復元',
                },
            });
        } catch {
            // 履歴が書けなくても復元自体は成立させる
        }

        return NextResponse.json(formatAssignment(created));
    } catch (error) {
        return serverErrorResponse('配置の復元', error);
    }
}
