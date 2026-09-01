import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canViewEquipment } from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** その工具を「いつ・誰が」使ったかの履歴（持出し・返却・状態変更）。 */
export async function GET(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canViewEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const tool = await prisma.tool.findUnique({ where: { id }, select: { id: true } });
        if (!tool) return notFoundResponse('電動工具');

        const limitParam = Number(new URL(request.url).searchParams.get('limit'));
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

        const logs = await prisma.toolCheckoutLog.findMany({
            where: { toolId: id },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return NextResponse.json(logs, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('使用記録の取得', error);
    }
}
