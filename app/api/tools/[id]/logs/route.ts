import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

const LOG_LIMIT = 50;

// 工具1台の持出し・返却履歴（閲覧は全ロール）
export async function GET(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const logs = await prisma.toolCheckoutLog.findMany({
            where: { toolId: id },
            orderBy: { createdAt: 'desc' },
            take: LOG_LIMIT,
        });

        return NextResponse.json(logs, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('工具の履歴取得', error);
    }
}
