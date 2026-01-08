'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/assignments/[id]
 * 配置詳細取得
 */
export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = await context.params;

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id },
            include: {
                projectMaster: true,
            },
        });

        if (!assignment) {
            return NextResponse.json({ error: '配置が見つかりません' }, { status: 404 });
        }

        return NextResponse.json({
            ...assignment,
            date: assignment.date.toISOString(),
            workers: assignment.workers ? JSON.parse(assignment.workers) : [],
            vehicles: assignment.vehicles ? JSON.parse(assignment.vehicles) : [],
            confirmedWorkerIds: assignment.confirmedWorkerIds ? JSON.parse(assignment.confirmedWorkerIds) : [],
            confirmedVehicleIds: assignment.confirmedVehicleIds ? JSON.parse(assignment.confirmedVehicleIds) : [],
            createdAt: assignment.createdAt.toISOString(),
            updatedAt: assignment.updatedAt.toISOString(),
            projectMaster: assignment.projectMaster ? {
                ...assignment.projectMaster,
                createdBy: assignment.projectMaster.createdBy ? JSON.parse(assignment.projectMaster.createdBy) : null,
                createdAt: assignment.projectMaster.createdAt.toISOString(),
                updatedAt: assignment.projectMaster.updatedAt.toISOString(),
            } : null,
        });
    } catch (error) {
        console.error('Get assignment error:', error);
        return NextResponse.json(
            { error: '配置の取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/assignments/[id]
 * 配置更新
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;
        if (role !== 'admin' && role !== 'manager' && role !== 'foreman1') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const { id } = await context.params;
        const body = await req.json();

        const updateData: Record<string, unknown> = {};
        if (body.assignedEmployeeId !== undefined) updateData.assignedEmployeeId = body.assignedEmployeeId;
        if (body.date !== undefined) updateData.date = new Date(body.date);
        if (body.memberCount !== undefined) updateData.memberCount = body.memberCount;
        if (body.workers !== undefined) updateData.workers = JSON.stringify(body.workers);
        if (body.vehicles !== undefined) updateData.vehicles = JSON.stringify(body.vehicles);
        if (body.meetingTime !== undefined) updateData.meetingTime = body.meetingTime;
        if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
        if (body.remarks !== undefined) updateData.remarks = body.remarks;
        if (body.isDispatchConfirmed !== undefined) updateData.isDispatchConfirmed = body.isDispatchConfirmed;
        if (body.confirmedWorkerIds !== undefined) updateData.confirmedWorkerIds = JSON.stringify(body.confirmedWorkerIds);
        if (body.confirmedVehicleIds !== undefined) updateData.confirmedVehicleIds = JSON.stringify(body.confirmedVehicleIds);

        const assignment = await prisma.projectAssignment.update({
            where: { id },
            data: updateData,
            include: {
                projectMaster: true,
            },
        });

        return NextResponse.json({
            ...assignment,
            date: assignment.date.toISOString(),
            workers: assignment.workers ? JSON.parse(assignment.workers) : [],
            vehicles: assignment.vehicles ? JSON.parse(assignment.vehicles) : [],
            confirmedWorkerIds: assignment.confirmedWorkerIds ? JSON.parse(assignment.confirmedWorkerIds) : [],
            confirmedVehicleIds: assignment.confirmedVehicleIds ? JSON.parse(assignment.confirmedVehicleIds) : [],
            createdAt: assignment.createdAt.toISOString(),
            updatedAt: assignment.updatedAt.toISOString(),
            projectMaster: assignment.projectMaster ? {
                ...assignment.projectMaster,
                createdBy: assignment.projectMaster.createdBy ? JSON.parse(assignment.projectMaster.createdBy) : null,
                createdAt: assignment.projectMaster.createdAt.toISOString(),
                updatedAt: assignment.projectMaster.updatedAt.toISOString(),
            } : null,
        });
    } catch (error) {
        console.error('Update assignment error:', error);
        return NextResponse.json(
            { error: '配置の更新に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/assignments/[id]
 * 配置削除
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;
        if (role !== 'admin' && role !== 'manager' && role !== 'foreman1') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const { id } = await context.params;

        await prisma.projectAssignment.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete assignment error:', error);
        return NextResponse.json(
            { error: '配置の削除に失敗しました' },
            { status: 500 }
        );
    }
}
