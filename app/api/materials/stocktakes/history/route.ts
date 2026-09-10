import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { isScaffoldMethod, STOCKTAKE_STATUS } from '@/lib/materials/stocktake';

/**
 * 棚卸の推移。
 *
 * エクセル（🈟材料管理表.xlsx）の「品目 × 棚卸日」の横持ち表と同じ見え方を返す。
 * 見慣れた形を残しつつ、列が増え続ける問題と数量欄に文字が混ざる問題だけを解消する。
 *
 * クエリ: locationId, scaffoldMethod, limit（表示する棚卸の回数・既定 12）
 */
export async function GET(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = (session!.user.role ?? '').toLowerCase();
        if (role === 'partner' || role === 'partner_member') {
            return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const locationId = searchParams.get('locationId');
        const method = searchParams.get('scaffoldMethod');
        const limit = Math.min(Number(searchParams.get('limit') ?? 12) || 12, 40);

        if (!locationId || !isScaffoldMethod(method)) {
            return NextResponse.json({ error: '置き場所と工法を指定してください' }, { status: 400 });
        }

        // 新しい方から limit 回分を取り、表示は古い→新しい順に並べ替える
        const stocktakes = await prisma.stocktake.findMany({
            where: { locationId, scaffoldMethod: method, status: STOCKTAKE_STATUS.CONFIRMED },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            take: limit,
            select: { id: true, date: true },
        });
        stocktakes.reverse();

        if (stocktakes.length === 0) {
            return NextResponse.json(
                { dates: [], categories: [] },
                { headers: { 'Cache-Control': 'no-store' } },
            );
        }

        const lines = await prisma.stocktakeLine.findMany({
            where: { stocktakeId: { in: stocktakes.map((s) => s.id) } },
            select: {
                stocktakeId: true,
                materialItemId: true,
                quantity: true,
                note: true,
                materialItem: {
                    select: {
                        id: true,
                        name: true,
                        unit: true,
                        sortOrder: true,
                        isActive: true,
                        category: { select: { id: true, name: true, sortOrder: true } },
                    },
                },
            },
        });

        const columnIndex = new Map(stocktakes.map((s, i) => [s.id, i]));
        type ItemRow = {
            materialItemId: string;
            name: string;
            unit: string;
            sortOrder: number;
            isActive: boolean;
            values: (number | null)[];
            notes: (string | null)[];
        };
        const categoryMap = new Map<string, { id: string; name: string; sortOrder: number; items: Map<string, ItemRow> }>();

        for (const line of lines) {
            const cat = line.materialItem.category;
            if (!categoryMap.has(cat.id)) {
                categoryMap.set(cat.id, { id: cat.id, name: cat.name, sortOrder: cat.sortOrder, items: new Map() });
            }
            const bucket = categoryMap.get(cat.id)!;
            if (!bucket.items.has(line.materialItemId)) {
                bucket.items.set(line.materialItemId, {
                    materialItemId: line.materialItemId,
                    name: line.materialItem.name,
                    unit: line.materialItem.unit,
                    sortOrder: line.materialItem.sortOrder,
                    isActive: line.materialItem.isActive,
                    values: new Array(stocktakes.length).fill(null),
                    notes: new Array(stocktakes.length).fill(null),
                });
            }
            const idx = columnIndex.get(line.stocktakeId);
            if (idx === undefined) continue;
            const row = bucket.items.get(line.materialItemId)!;
            row.values[idx] = line.quantity;
            row.notes[idx] = line.note;
        }

        const categories = [...categoryMap.values()]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((c) => ({
                id: c.id,
                name: c.name,
                items: [...c.items.values()]
                    // 1 度も数量が入っていない品目は表から落とす（エクセルの空行に相当）
                    .filter((i) => i.values.some((v) => v !== null) || i.notes.some((n) => n !== null))
                    .sort((a, b) => a.sortOrder - b.sortOrder),
            }))
            .filter((c) => c.items.length > 0);

        return NextResponse.json(
            { dates: stocktakes.map((s) => s.date), categories },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('棚卸推移取得', error);
    }
}
