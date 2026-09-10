import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { jstDayStartUtc } from '@/lib/dateUtils';
import { isScaffoldMethod, STOCKTAKE_STATUS } from '@/lib/materials/stocktake';

/**
 * 棚卸の一覧。
 * 置き場所 / 工法 / 期間で絞り込める。明細は返さない（一覧は件数と合計だけ）。
 */
export async function GET(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        // 協力会社には土場の在庫を見せない
        const role = (session!.user.role ?? '').toLowerCase();
        if (role === 'partner' || role === 'partner_member') {
            return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const locationId = searchParams.get('locationId');
        const method = searchParams.get('scaffoldMethod');
        const limit = Math.min(Number(searchParams.get('limit') ?? 50) || 50, 200);

        const stocktakes = await prisma.stocktake.findMany({
            where: {
                ...(locationId ? { locationId } : {}),
                ...(method && isScaffoldMethod(method) ? { scaffoldMethod: method } : {}),
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            take: limit,
            include: {
                location: { select: { id: true, name: true } },
                _count: { select: { lines: true } },
            },
        });

        // 「何品目を数えたか」は quantity が入っている行の数。_count は未入力行も数えるので別で取る
        const countedRows = await prisma.stocktakeLine.groupBy({
            by: ['stocktakeId'],
            where: { stocktakeId: { in: stocktakes.map((s) => s.id) }, quantity: { not: null } },
            _count: { _all: true },
            _sum: { quantity: true },
        });
        const countedById = new Map(countedRows.map((r) => [r.stocktakeId, r]));

        return NextResponse.json(
            stocktakes.map((s) => ({
                id: s.id,
                date: s.date,
                status: s.status,
                scaffoldMethod: s.scaffoldMethod,
                location: s.location,
                notes: s.notes,
                createdByName: s.createdByName,
                confirmedAt: s.confirmedAt,
                lineCount: s._count.lines,
                countedCount: countedById.get(s.id)?._count._all ?? 0,
                totalQuantity: countedById.get(s.id)?._sum.quantity ?? 0,
            })),
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('棚卸一覧取得', error);
    }
}

/**
 * 棚卸を新規作成する。
 * 対象の工法の品目を全部 quantity=null（未カウント）で並べた状態で作る。
 * 土場で 1 品目ずつ埋めていく前提なので、行は最初から全部あった方が
 * 「まだ数えていない品目」が一目で分かる。
 */
export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const { locationId, scaffoldMethod, date, notes } = body as {
            locationId?: string;
            scaffoldMethod?: string;
            date?: string;
            notes?: string;
        };

        if (!locationId) return validationErrorResponse('置き場所は必須です');
        if (!isScaffoldMethod(scaffoldMethod)) return validationErrorResponse('工法区分が不正です');
        if (!date) return validationErrorResponse('棚卸日は必須です');

        const location = await prisma.storageLocation.findUnique({ where: { id: locationId } });
        if (!location) return validationErrorResponse('置き場所が見つかりません');

        // JST のカレンダー日として保存する（ProjectAssignment.date と同じ約束）
        const stocktakeDate = jstDayStartUtc(date);
        if (isNaN(stocktakeDate.getTime())) return validationErrorResponse('棚卸日の形式が不正です');

        const duplicate = await prisma.stocktake.findFirst({
            where: { locationId, scaffoldMethod, date: stocktakeDate },
            select: { id: true },
        });
        if (duplicate) {
            return NextResponse.json(
                { error: '同じ日・同じ置き場所・同じ工法の棚卸が既にあります', stocktakeId: duplicate.id },
                { status: 400 },
            );
        }

        // 対象品目 = その工法の有効な品目
        const items = await prisma.materialItem.findMany({
            where: { isActive: true, scaffoldMethod, category: { isActive: true } },
            select: { id: true },
        });
        if (items.length === 0) return validationErrorResponse('対象の品目がありません。品目マスタを確認してください');

        const created = await prisma.stocktake.create({
            data: {
                locationId,
                scaffoldMethod,
                date: stocktakeDate,
                status: STOCKTAKE_STATUS.DRAFT,
                notes: notes ?? null,
                createdBy: session!.user.id,
                createdByName: session!.user.name ?? '',
                lines: { create: items.map((i) => ({ materialItemId: i.id })) },
            },
            select: { id: true },
        });

        return NextResponse.json({ id: created.id, lineCount: items.length }, { status: 201 });
    } catch (error) {
        return serverErrorResponse('棚卸作成', error);
    }
}
