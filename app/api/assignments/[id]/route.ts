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
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!canDispatch(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;
        const body = await req.json();

        // 楽観的ロック: expectedUpdatedAtが指定されている場合、競合をチェック
        if (body.expectedUpdatedAt) {
            const current = await prisma.projectAssignment.findUnique({
                where: { id },
                include: { projectMaster: true },
            });

            if (!current) {
                return notFoundResponse('配置');
            }

            const expectedTime = new Date(body.expectedUpdatedAt).getTime();
            const actualTime = current.updatedAt.getTime();

            if (expectedTime !== actualTime) {
                // 競合検出: 他のユーザーが先に更新している
                return conflictResponse(
                    '他のユーザーによって更新されています。最新のデータを確認してください。',
                    formatAssignment(current)
                );
            }
        }

        const updateData: Record<string, unknown> = {};
        if (body.assignedEmployeeId !== undefined) updateData.assignedEmployeeId = body.assignedEmployeeId;
        if (body.date !== undefined) updateData.date = new Date(body.date);
        if (body.memberCount !== undefined) updateData.memberCount = body.memberCount;
        if (body.workers !== undefined) updateData.workers = stringifyJsonField(body.workers);
        if (body.vehicles !== undefined) updateData.vehicles = stringifyJsonField(body.vehicles);
        if (body.meetingTime !== undefined) updateData.meetingTime = body.meetingTime;
        if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
        if (body.remarks !== undefined) updateData.remarks = body.remarks;
        if (body.isDispatchConfirmed !== undefined) updateData.isDispatchConfirmed = body.isDispatchConfirmed;
        if (body.confirmedWorkerIds !== undefined) updateData.confirmedWorkerIds = stringifyJsonField(body.confirmedWorkerIds);
        if (body.confirmedVehicleIds !== undefined) updateData.confirmedVehicleIds = stringifyJsonField(body.confirmedVehicleIds);
        if (body.constructionType !== undefined) updateData.constructionType = body.constructionType;

        const assignment = await prisma.projectAssignment.update({
            where: { id },
            data: updateData,
            include: { projectMaster: true },
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

        if (!canDispatch(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;

        await prisma.projectAssignment.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('配置の削除', error);
    }
}
