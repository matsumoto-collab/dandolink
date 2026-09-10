import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, notFoundResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { getPreviousQuantities, isScaffoldMethod, SCAFFOLD_METHOD_LABEL } from '@/lib/materials/stocktake';
import { StocktakeSheetPDF, type SheetEntry } from '@/components/pdf/StocktakeSheetPDF';
// フォント登録（副作用）。サーバー側は同梱 TTF を使い CDN 取得に依存させない
import '@/components/pdf/styles';
import '@/lib/pdf/registerServerFonts';

// @react-pdf/renderer は Edge 非対応
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function formatJst(value: Date): string {
    const jst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

/**
 * 棚卸チェックシート（印刷用 PDF）。
 * 電波が届かない・手袋で画面が押せない日のために、前回値入りの白紙表を出す。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const rateLimitError = await applyRateLimit(request, RATE_LIMITS.heavy);
        if (rateLimitError) return rateLimitError;

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
                location: { select: { name: true } },
                lines: {
                    include: {
                        materialItem: {
                            select: {
                                id: true,
                                name: true,
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

        const method = isScaffoldMethod(stocktake.scaffoldMethod) ? stocktake.scaffoldMethod : 'standard';
        const previous = await getPreviousQuantities(prisma, stocktake.locationId, method, stocktake.date);

        // カテゴリ順 → 品目順に並べ、カテゴリ見出しを挟んだ 1 本のリストにする
        const sorted = [...stocktake.lines].sort((a, b) => {
            const ca = a.materialItem.category;
            const cb = b.materialItem.category;
            if (ca.sortOrder !== cb.sortOrder) return ca.sortOrder - cb.sortOrder;
            if (ca.id !== cb.id) return ca.name.localeCompare(cb.name);
            return a.materialItem.sortOrder - b.materialItem.sortOrder;
        });

        const entries: SheetEntry[] = [];
        let lastCategoryId = '';
        for (const line of sorted) {
            const cat = line.materialItem.category;
            if (cat.id !== lastCategoryId) {
                entries.push({ kind: 'category', label: cat.name });
                lastCategoryId = cat.id;
            }
            entries.push({
                kind: 'item',
                label: line.materialItem.name,
                unit: line.materialItem.unit,
                previousQuantity: previous.get(line.materialItemId)?.quantity ?? null,
            });
        }

        // 前回日付は品目ごとに違い得るので、最も新しいものを見出しに出す
        const previousDates = [...previous.values()].map((p) => p.date.getTime());
        const previousDateLabel = previousDates.length ? formatJst(new Date(Math.max(...previousDates))) : '';

        const buffer = await renderToBuffer(
            <StocktakeSheetPDF
                heading={`${stocktake.location.name} / ${SCAFFOLD_METHOD_LABEL[method]}`}
                dateLabel={formatJst(stocktake.date)}
                previousDateLabel={previousDateLabel}
                entries={entries}
            />,
        );

        const fileName = `stocktake_${formatJst(stocktake.date).replace(/\//g, '')}.pdf`;
        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${fileName}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        return serverErrorResponse('棚卸チェックシートPDF生成', error);
    }
}
