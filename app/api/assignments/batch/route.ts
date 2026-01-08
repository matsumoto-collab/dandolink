'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
 * POST /api/assignments/batch
 * 配置の一括更新（ドラッグ&ドロップ、sortOrder変更等）
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;
        if (role !== 'admin' && role !== 'manager' && role !== 'foreman1') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const { updates } = await req.json() as { updates: BatchUpdate[] };

        if (!updates || !Array.isArray(updates)) {
            return NextResponse.json(
                { error: 'updates配列が必要です' },
                { status: 400 }
            );
        }

        // トランザクションで一括更新
        const results = await prisma.$transaction(
            updates.map(update => {
                const updateData: Record<string, unknown> = {};
                if (update.data.assignedEmployeeId !== undefined) updateData.assignedEmployeeId = update.data.assignedEmployeeId;
                if (update.data.date !== undefined) updateData.date = new Date(update.data.date);
                if (update.data.sortOrder !== undefined) updateData.sortOrder = update.data.sortOrder;
                if (update.data.memberCount !== undefined) updateData.memberCount = update.data.memberCount;
                if (update.data.workers !== undefined) updateData.workers = JSON.stringify(update.data.workers);
                if (update.data.vehicles !== undefined) updateData.vehicles = JSON.stringify(update.data.vehicles);
                if (update.data.meetingTime !== undefined) updateData.meetingTime = update.data.meetingTime;
                if (update.data.remarks !== undefined) updateData.remarks = update.data.remarks;
                if (update.data.isDispatchConfirmed !== undefined) updateData.isDispatchConfirmed = update.data.isDispatchConfirmed;
                if (update.data.confirmedWorkerIds !== undefined) updateData.confirmedWorkerIds = JSON.stringify(update.data.confirmedWorkerIds);
                if (update.data.confirmedVehicleIds !== undefined) updateData.confirmedVehicleIds = JSON.stringify(update.data.confirmedVehicleIds);

                return prisma.projectAssignment.update({
                    where: { id: update.id },
                    data: updateData,
                });
            })
        );

        return NextResponse.json({
            success: true,
            count: results.length,
        });
    } catch (error) {
        console.error('Batch update assignments error:', error);
        return NextResponse.json(
            { error: '配置の一括更新に失敗しました' },
            { status: 500 }
        );
    }
}
