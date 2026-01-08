import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Update a project
 * PATCH /api/projects/[id]
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = params;
        const body = await req.json();

        // Check if project exists
        const existingProject = await prisma.project.findUnique({
            where: { id },
        });

        if (!existingProject) {
            return NextResponse.json(
                { error: 'プロジェクトが見つかりません' },
                { status: 404 }
            );
        }

        // Prepare update data
        const updateData: any = {};

        if (body.title !== undefined) updateData.title = body.title;
        if (body.constructionType !== undefined) updateData.constructionType = body.constructionType;
        if (body.startDate !== undefined) updateData.startDate = new Date(body.startDate);
        if (body.endDate !== undefined) updateData.endDate = body.endDate ? new Date(body.endDate) : null;
        if (body.assemblyStartDate !== undefined) updateData.assemblyStartDate = body.assemblyStartDate ? new Date(body.assemblyStartDate) : null;
        if (body.assemblyDuration !== undefined) updateData.assemblyDuration = body.assemblyDuration || null;
        if (body.demolitionStartDate !== undefined) updateData.demolitionStartDate = body.demolitionStartDate ? new Date(body.demolitionStartDate) : null;
        if (body.demolitionDuration !== undefined) updateData.demolitionDuration = body.demolitionDuration || null;
        if (body.assignedEmployeeId !== undefined) updateData.assignedEmployeeId = body.assignedEmployeeId;
        if (body.customer !== undefined) updateData.customer = body.customer || null;
        if (body.description !== undefined) updateData.description = body.description || null;
        if (body.location !== undefined) updateData.location = body.location || null;
        if (body.category !== undefined) updateData.category = body.category || null;
        if (body.workers !== undefined) updateData.workers = body.workers ? JSON.stringify(body.workers) : null;
        if (body.vehicles !== undefined) updateData.vehicles = body.vehicles ? JSON.stringify(body.vehicles) : null;
        if (body.remarks !== undefined) updateData.remarks = body.remarks || null;
        if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;

        // 手配確定フィールド
        if (body.confirmedForemanId !== undefined) updateData.confirmedForemanId = body.confirmedForemanId || null;
        if (body.confirmedWorkerIds !== undefined) updateData.confirmedWorkerIds = body.confirmedWorkerIds ? JSON.stringify(body.confirmedWorkerIds) : null;
        if (body.confirmedVehicleIds !== undefined) updateData.confirmedVehicleIds = body.confirmedVehicleIds ? JSON.stringify(body.confirmedVehicleIds) : null;
        if (body.isDispatchConfirmed !== undefined) updateData.isDispatchConfirmed = body.isDispatchConfirmed;

        // Update project
        const updatedProject = await prisma.project.update({
            where: { id },
            data: updateData,
        });

        // Parse JSON fields for response
        const response = {
            ...updatedProject,
            workers: updatedProject.workers ? JSON.parse(updatedProject.workers) : [],
            vehicles: updatedProject.vehicles ? JSON.parse(updatedProject.vehicles) : [],
            confirmedWorkerIds: updatedProject.confirmedWorkerIds ? JSON.parse(updatedProject.confirmedWorkerIds) : [],
            confirmedVehicleIds: updatedProject.confirmedVehicleIds ? JSON.parse(updatedProject.confirmedVehicleIds) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Update project error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: 'プロジェクトの更新に失敗しました', details: errorMessage },
            { status: 500 }
        );
    }
}

/**
 * Delete a project
 * DELETE /api/projects/[id]
 */
export async function DELETE(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = params;

        // Check if project exists
        const existingProject = await prisma.project.findUnique({
            where: { id },
        });

        if (!existingProject) {
            return NextResponse.json(
                { error: 'プロジェクトが見つかりません' },
                { status: 404 }
            );
        }

        // Delete project
        await prisma.project.delete({
            where: { id },
        });

        return NextResponse.json({ message: 'プロジェクトを削除しました' });
    } catch (error) {
        console.error('Delete project error:', error);
        return NextResponse.json(
            { error: 'プロジェクトの削除に失敗しました' },
            { status: 500 }
        );
    }
}
