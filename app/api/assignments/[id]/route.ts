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

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/assignments/[id] - 配置詳細取得
 */
export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id },
            include: { projectMaster: true },
        });

        if (!assignment) {
            return notFoundResponse('配置');
        }

        return NextResponse.json(formatAssignment(assignment));
    } catch (error) {
        return serverErrorResponse('配置の取得', error);
    }
}

/**
 * PATCH /api/assignments/[id] - 配置更新
 * 楽観的ロック対応: expectedUpdatedAtパラメータで競合を検出
 *
 * 権限:
 *   - admin / manager / foreman1: フル更新可
 *   - foreman2: 自班（assignedEmployeeId === user.id）の手配のみ、
 *               かつ meetingTime / dispatchRemark / sortOrder のみ更新可
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const userRole = session!.user.role;
        const isForeman2 = userRole === 'foreman2';
        if (!canDispatch(session!.user) && !isForeman2) {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;
        const body = await req.json();

        // 楽観的ロック または foreman2 のオーナーシップ確認のため現在値をロード
        let current: Awaited<ReturnType<typeof prisma.projectAssignment.findUnique>> = null;
        if (body.expectedUpdatedAt || isForeman2) {
            current = await prisma.projectAssignment.findUnique({
                where: { id },
                include: { projectMaster: true },
            });

            if (!current) {
                return notFoundResponse('配置');
            }

            if (body.expectedUpdatedAt) {
                const expectedTime = new Date(body.expectedUpdatedAt).getTime();
                const actualTime = current.updatedAt.getTime();
                if (expectedTime !== actualTime) {
                    return conflictResponse(
                        '他のユーザーによって更新されています。最新のデータを確認してください。',
                        formatAssignment(current)
                    );
                }
            }

            if (isForeman2 && current.assignedEmployeeId !== session!.user.id) {
                return errorResponse('自班の手配のみ編集できます', 403);
            }
        }

        // foreman2 は限定フィールドのみ更新可（その他は無視してエラーにしない）
        const allowedForForeman2 = new Set(['meetingTime', 'dispatchRemark', 'sortOrder']);
        const allowed = (key: string) => !isForeman2 || allowedForForeman2.has(key);

        const updateData: Record<string, unknown> = {};
        if (body.assignedEmployeeId !== undefined && allowed('assignedEmployeeId')) updateData.assignedEmployeeId = body.assignedEmployeeId;
        if (body.date !== undefined && allowed('date')) updateData.date = new Date(body.date);
        if (body.memberCount !== undefined && allowed('memberCount')) updateData.memberCount = body.memberCount;
        if (body.workers !== undefined && allowed('workers')) updateData.workers = stringifyJsonField(body.workers);
        if (body.vehicles !== undefined && allowed('vehicles')) updateData.vehicles = stringifyJsonField(body.vehicles);
        if (body.meetingTime !== undefined && allowed('meetingTime')) updateData.meetingTime = body.meetingTime;
        if (body.sortOrder !== undefined && allowed('sortOrder')) updateData.sortOrder = body.sortOrder;
        if (body.remarks !== undefined && allowed('remarks')) updateData.remarks = body.remarks;
        if (body.dispatchRemark !== undefined && allowed('dispatchRemark')) updateData.dispatchRemark = body.dispatchRemark;
        if (body.isDispatchConfirmed !== undefined && allowed('isDispatchConfirmed')) updateData.isDispatchConfirmed = body.isDispatchConfirmed;
        if (body.confirmedWorkerIds !== undefined && allowed('confirmedWorkerIds')) updateData.confirmedWorkerIds = stringifyJsonField(body.confirmedWorkerIds);
        if (body.confirmedVehicleIds !== undefined && allowed('confirmedVehicleIds')) updateData.confirmedVehicleIds = stringifyJsonField(body.confirmedVehicleIds);
        if (body.constructionType !== undefined && allowed('constructionType')) updateData.constructionType = body.constructionType;
        if (body.estimatedHours !== undefined && allowed('estimatedHours')) updateData.estimatedHours = body.estimatedHours;
        updateData.updatedBy = session!.user.id;

        // workers/vehiclesが更新される場合、リレーションテーブルも同期
        if (body.workers !== undefined && allowed('workers')) {
            updateData.assignmentWorkers = {
                deleteMany: {},
                create: Array.isArray(body.workers) ? body.workers.map((w: string) => ({ workerName: w })) : [],
            };
        }
        if (body.vehicles !== undefined && allowed('vehicles')) {
            updateData.assignmentVehicles = {
                deleteMany: {},
                create: Array.isArray(body.vehicles) ? body.vehicles.map((v: string) => ({ vehicleName: v })) : [],
            };
        }

        const assignment = await prisma.projectAssignment.update({
            where: { id },
            data: updateData,
            include: { projectMaster: true, assignmentWorkers: true, assignmentVehicles: true },
        });

        return NextResponse.json(formatAssignment(assignment));
    } catch (error) {
        return serverErrorResponse('配置の更新', error);
    }
}

/**
 * DELETE /api/assignments/[id] - 配置削除
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;

        await prisma.projectAssignment.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('配置の削除', error);
    }
}
