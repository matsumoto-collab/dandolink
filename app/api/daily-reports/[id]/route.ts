import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const dailyReport = await prisma.dailyReport.findUnique({
            where: { id },
            include: { workItems: { include: { assignment: { include: { projectMaster: true } } } } },
        });

        if (!dailyReport) return notFoundResponse('日報');
        return NextResponse.json(dailyReport);
    } catch (error) {
        return serverErrorResponse('日報詳細取得', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        await prisma.dailyReport.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('日報削除', error);
    }
}
