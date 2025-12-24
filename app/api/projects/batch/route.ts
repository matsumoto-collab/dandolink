import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Batch update projects
 * PATCH /api/projects/batch
 */
export async function PATCH(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const body = await req.json();
        const { updates } = body;

        if (!Array.isArray(updates)) {
            return NextResponse.json(
                { error: '更新データが不正です' },
                { status: 400 }
            );
        }

        // Perform batch updates using transaction
        const results = await prisma.$transaction(
            updates.map((update: { id: string; data: any }) => {
                const updateData: any = {};

                if (update.data.title !== undefined) updateData.title = update.data.title;
                if (update.data.constructionType !== undefined) updateData.constructionType = update.data.constructionType;
                if (update.data.startDate !== undefined) updateData.startDate = new Date(update.data.startDate);
                if (update.data.endDate !== undefined) updateData.endDate = update.data.endDate ? new Date(update.data.endDate) : null;
                if (update.data.assemblyStartDate !== undefined) updateData.assemblyStartDate = update.data.assemblyStartDate ? new Date(update.data.assemblyStartDate) : null;
                if (update.data.assemblyDuration !== undefined) updateData.assemblyDuration = update.data.assemblyDuration || null;
                if (update.data.demolitionStartDate !== undefined) updateData.demolitionStartDate = update.data.demolitionStartDate ? new Date(update.data.demolitionStartDate) : null;
                if (update.data.demolitionDuration !== undefined) updateData.demolitionDuration = update.data.demolitionDuration || null;
                if (update.data.assignedEmployeeId !== undefined) updateData.assignedEmployeeId = update.data.assignedEmployeeId;
                if (update.data.customer !== undefined) updateData.customer = update.data.customer || null;
                if (update.data.description !== undefined) updateData.description = update.data.description || null;
                if (update.data.location !== undefined) updateData.location = update.data.location || null;
                if (update.data.category !== undefined) updateData.category = update.data.category || null;
                if (update.data.workers !== undefined) updateData.workers = update.data.workers ? JSON.stringify(update.data.workers) : null;
                if (update.data.vehicles !== undefined) updateData.vehicles = update.data.vehicles ? JSON.stringify(update.data.vehicles) : null;
                if (update.data.remarks !== undefined) updateData.remarks = update.data.remarks || null;
                if (update.data.sortOrder !== undefined) updateData.sortOrder = update.data.sortOrder;

                return prisma.project.update({
                    where: { id: update.id },
                    data: updateData,
                });
            })
        );

        return NextResponse.json({
            message: `${results.length}件のプロジェクトを更新しました`,
            count: results.length,
        });
    } catch (error) {
        console.error('Batch update projects error:', error);
        return NextResponse.json(
            { error: 'プロジェクトの一括更新に失敗しました' },
            { status: 500 }
        );
    }
}
