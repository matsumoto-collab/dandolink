import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

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
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const dailyReport = await prisma.dailyReport.findUnique({ where: { id } });
        if (!dailyReport) return notFoundResponse('日報');

        // 本人または管理者のみ削除可能
        if (dailyReport.foremanId !== session!.user.id && !isManagerOrAbove(session!.user)) {
            return errorResponse('この日報を削除する権限がありません', 403);
        }

        await prisma.dailyReport.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('日報削除', error);
    }
}
