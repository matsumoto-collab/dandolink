import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';

// カテゴリ別在庫一覧（stockQuantity含む）
export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const categories = await prisma.materialCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            include: {
                items: {
                    where: { isActive: true },
                    orderBy: { sortOrder: 'asc' },
                },
            },
        });

        return NextResponse.json(categories, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('在庫一覧取得', error);
    }
}

// 在庫数一括調整（初期設定・棚卸し用）
export async function PATCH(request: NextRequest) {
    try {
        const { error, session } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const { adjustments } = body as {
            adjustments: { materialItemId: string; quantity: number; notes?: string }[];
        };

        if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
            return NextResponse.json({ error: '調整データがありません' }, { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
            for (const adj of adjustments) {
                const item = await tx.materialItem.findUnique({
                    where: { id: adj.materialItemId },
                    select: { stockQuantity: true },
                });
                if (!item) continue;

                const diff = adj.quantity - item.stockQuantity;
                if (diff === 0) continue;

                await tx.materialItem.update({
                    where: { id: adj.materialItemId },
                    data: { stockQuantity: adj.quantity },
                });

                await tx.inventoryTransaction.create({
                    data: {
                        materialItemId: adj.materialItemId,
                        quantity: diff,
                        type: 'adjustment',
                        notes: adj.notes || '棚卸し調整',
                        createdBy: session?.user?.id || null,
                    },
                });
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('在庫調整', error);
    }
}
