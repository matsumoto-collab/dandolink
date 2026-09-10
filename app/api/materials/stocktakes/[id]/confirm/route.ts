import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { confirmStocktake, STOCKTAKE_STATUS } from '@/lib/materials/stocktake';

/**
 * 棚卸を確定して在庫へ反映する。
 *
 * これまでは棚卸の結果をエクセルで持ち、在庫画面から手で 1 品目ずつ調整していた
 * （2026-07-29 に 80 件の手入力が行われている）。この API がその作業を置き換える。
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await params;
        const stocktake = await prisma.stocktake.findUnique({
            where: { id },
            select: { status: true, _count: { select: { lines: true } } },
        });
        if (!stocktake) return notFoundResponse('棚卸');
        if (stocktake.status === STOCKTAKE_STATUS.CONFIRMED) {
            return validationErrorResponse('この棚卸は既に確定済みです');
        }

        const counted = await prisma.stocktakeLine.count({ where: { stocktakeId: id, quantity: { not: null } } });
        if (counted === 0) {
            return validationErrorResponse('数量が 1 件も入力されていません');
        }

        const result = await prisma.$transaction(
            (tx) => confirmStocktake(tx, id, session!.user.id ?? null),
            { timeout: 30000 },
        );

        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        return serverErrorResponse('棚卸確定', error);
    }
}
