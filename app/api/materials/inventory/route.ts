import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { applyInventoryAdjustment, type InventoryAdjustmentInput } from '@/lib/materials/stock';

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

        const result = await prisma.$transaction(async (tx) => {
            // C6 是正: 棚卸し調整の在庫直接操作も lib/materials/stock.ts の
            // 単一ヘルパ（applyInventoryAdjustment）経由に統一。
            // 直接 stockQuantity 書き込み経路は残さない。
            // 除外判定（catalog 権威）も applyStockChange 内で共通適用される
            // （ネット/リース品の棚卸し調整は自動スキップ）。
            const inputs: InventoryAdjustmentInput[] = [];
            for (const adj of adjustments) {
                const item = await tx.materialItem.findUnique({
                    where: { id: adj.materialItemId },
                    select: {
                        stockQuantity: true,
                        name: true,
                        category: { select: { name: true } },
                    },
                });
                if (!item) continue;
                inputs.push({
                    materialItemId: adj.materialItemId,
                    categoryName: item.category.name,
                    itemName: item.name,
                    currentQuantity: item.stockQuantity,
                    targetQuantity: adj.quantity,
                    note: adj.notes || '棚卸し調整',
                });
            }
            return applyInventoryAdjustment(tx, inputs, session?.user?.id || null);
        });

        // C12（レビューA[中] 解消）: 構造除外品目（ネット/リース = catalog 権威）の
        //   調整はヘルパが skip する。従来は常に { success:true } を返し
        //   「N件更新しました」と成功偽装していた。実際に適用した件数と
        //   除外でスキップした件数を返し、UI が「N件は構造除外品目のため
        //   変更不可」を可視化できるようにする。
        return NextResponse.json({
            success: true,
            appliedCount: result.appliedCount,
            excludedCount: result.excludedCount,
            unchangedCount: result.unchangedCount,
            skippedCount: result.skippedCount,
        });
    } catch (error) {
        return serverErrorResponse('在庫調整', error);
    }
}
