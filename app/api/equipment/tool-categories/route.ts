import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canEditEquipment, canViewEquipment } from '@/lib/equipment';

/** 電動工具の分類（インパクト・丸ノコ など）。 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canViewEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const categories = await prisma.toolCategory.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
        return NextResponse.json(categories, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('工具の分類の取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const body = await request.json().catch(() => ({}));
        const name = String(body.name ?? '').trim();
        if (!name) return errorResponse('分類名を入力してください', 400);

        const last = await prisma.toolCategory.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
        const created = await prisma.toolCategory.create({
            data: { name: name.slice(0, 100), sortOrder: (last?.sortOrder ?? 0) + 1 },
        });
        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('工具の分類の追加', error);
    }
}
