import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/daily-reports/[id] - 日報詳細を取得
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const dailyReport = await prisma.dailyReport.findUnique({
            where: { id },
            include: {
                workItems: {
                    include: {
                        assignment: {
                            include: {
                                projectMaster: true,
                            },
                        },
                    },
                },
            },
        });

        if (!dailyReport) {
            return NextResponse.json({ error: 'Daily report not found' }, { status: 404 });
        }

        return NextResponse.json(dailyReport);
    } catch (error) {
        console.error('Failed to fetch daily report:', error);
        return NextResponse.json({ error: 'Failed to fetch daily report' }, { status: 500 });
    }
}

// DELETE /api/daily-reports/[id] - 日報を削除
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        await prisma.dailyReport.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete daily report:', error);
        return NextResponse.json({ error: 'Failed to delete daily report' }, { status: 500 });
    }
}
