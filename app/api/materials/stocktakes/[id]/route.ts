import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    requireManagerOrAbove,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { getPreviousQuantities, isScaffoldMethod, STOCKTAKE_STATUS } from '@/lib/materials/stocktake';

/**
 * 棚卸 1 件の明細。
 * カテゴリごとにまとめ、各行に前回の棚卸で数えた数を添えて返す
 * （土場で打つときに前回値が見えないと桁違いに気づけないため）。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = (session!.user.role ?? '').toLowerCase();
        if (role === 'partner' || role === 'partner_member') {
            return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 });
        }

        const { id } = await params;
        const stocktake = await prisma.stocktake.findUnique({
            where: { id },
            include: {
                location: { select: { id: true, name: true } },
                lines: {
                    include: {
                        materialItem: {
                            select: {
                                id: true,
                                name: true,
                                spec: true,
                                unit: true,
                                sortOrder: true,
                                category: { select: { id: true, name: true, sortOrder: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!stocktake) return notFoundResponse('棚卸');

        const previous = await getPreviousQuantities(
            prisma,
            stocktake.locationId,
            isScaffoldMethod(stocktake.scaffoldMethod) ? stocktake.scaffoldMethod : 'standard',
            stocktake.date,
        );

        // カテゴリごとにまとめる（画面はカテゴリ単位の折りたたみで表示する）
        const byCategory = new Map<
            string,
            { id: string; name: string; sortOrder: number; items: unknown[] }
        >();
        for (const line of stocktake.lines) {
            const cat = line.materialItem.category;
            if (!byCategory.has(cat.id)) {
                byCategory.set(cat.id, { id: cat.id, name: cat.name, sortOrder: cat.sortOrder, items: [] });
            }
            const prev = previous.get(line.materialItemId);
            byCategory.get(cat.id)!.items.push({
                lineId: line.id,
                materialItemId: line.materialItemId,
                name: line.materialItem.name,
                spec: line.materialItem.spec,
                unit: line.materialItem.unit,
                sortOrder: line.materialItem.sortOrder,
                quantity: line.quantity,
                note: line.note,
                previousQuantity: prev?.quantity ?? null,
                previousDate: prev?.date ?? null,
            });
        }
        const categories = [...byCategory.values()]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((c) => ({
                ...c,
                items: (c.items as { sortOrder: number }[]).sort((a, b) => a.sortOrder - b.sortOrder),
            }));

        const countedCount = stocktake.lines.filter((l) => l.quantity !== null).length;

        return NextResponse.json(
            {
                id: stocktake.id,
                date: stocktake.date,
                status: stocktake.status,
                scaffoldMethod: stocktake.scaffoldMethod,
                location: stocktake.location,
                notes: stocktake.notes,
                createdByName: stocktake.createdByName,
                confirmedAt: stocktake.confirmedAt,
                lineCount: stocktake.lines.length,
                countedCount,
                categories,
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('棚卸取得', error);
    }
}

/**
 * 棚卸の数量を保存する（下書きのみ）。
 * 土場で少しずつ打っていくので、送られてきた行だけを更新する部分保存にする。
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = (session!.user.role ?? '').toLowerCase();
        if (role === 'partner' || role === 'partner_member') {
            return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 });
        }

        const { id } = await params;
        const stocktake = await prisma.stocktake.findUnique({ where: { id }, select: { status: true } });
        if (!stocktake) return notFoundResponse('棚卸');
        if (stocktake.status === STOCKTAKE_STATUS.CONFIRMED) {
            return validationErrorResponse('確定済みの棚卸は編集できません');
        }

        const body = await request.json();
        const { lines, notes } = body as {
            lines?: { materialItemId: string; quantity: number | null; note?: string | null }[];
            notes?: string | null;
        };

        if (lines && !Array.isArray(lines)) return validationErrorResponse('明細の形式が不正です');

        for (const line of lines ?? []) {
            if (line.quantity !== null && line.quantity !== undefined) {
                if (!Number.isInteger(line.quantity) || line.quantity < 0) {
                    return validationErrorResponse('数量は 0 以上の整数で入力してください');
                }
            }
        }

        await prisma.$transaction(async (tx) => {
            for (const line of lines ?? []) {
                await tx.stocktakeLine.updateMany({
                    where: { stocktakeId: id, materialItemId: line.materialItemId },
                    data: {
                        quantity: line.quantity ?? null,
                        ...(line.note !== undefined ? { note: line.note } : {}),
                    },
                });
            }
            if (notes !== undefined) {
                await tx.stocktake.update({ where: { id }, data: { notes } });
            } else if (lines?.length) {
                await tx.stocktake.update({ where: { id }, data: { updatedAt: new Date() } });
            }
        });

        return NextResponse.json({ success: true, savedCount: lines?.length ?? 0 });
    } catch (error) {
        return serverErrorResponse('棚卸保存', error);
    }
}

/** 棚卸の削除。確定済みは在庫に反映されているので消させない */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await params;
        const stocktake = await prisma.stocktake.findUnique({ where: { id }, select: { status: true } });
        if (!stocktake) return notFoundResponse('棚卸');
        if (stocktake.status === STOCKTAKE_STATUS.CONFIRMED) {
            return validationErrorResponse('確定済みの棚卸は削除できません');
        }

        await prisma.stocktake.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('棚卸削除', error);
    }
}
