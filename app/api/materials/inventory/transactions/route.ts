import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const materialItemId = searchParams.get('materialItemId');
        const type = searchParams.get('type');
        const limit = parseInt(searchParams.get('limit') || '50');

        const where: Record<string, unknown> = {};
        if (materialItemId) where.materialItemId = materialItemId;
        if (type) where.type = type;

        const transactions = await prisma.inventoryTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                materialItem: {
                    include: {
                        category: { select: { name: true } },
                    },
                },
            },
        });

        return NextResponse.json(transactions, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('在庫取引履歴取得', error);
    }
}
