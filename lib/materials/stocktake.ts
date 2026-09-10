/**
 * 実地棚卸のロジック。
 *
 * 棚卸は「置き場所 × 工法 × 日付」で 1 回。確定（confirmed）したときに
 * MaterialItem.stockQuantity を実際に数えた数へ合わせる。
 *
 * --- 在庫の決め方 ---
 *   在庫 = 置き場所 × 工法ごとの「最後に数えた数」の合計。
 *
 *   ある品目を今回の棚卸で数えていない（quantity = null）場合は、その置き場所の
 *   前回の数をそのまま引き継ぐ。「数えていない」と「0 本だった」を区別するため、
 *   StocktakeLine.quantity は null を許している。
 *
 *   例) 土場で柱 3.6 を 3,895 本、上野で 200 本数えていれば在庫は 4,095 本。
 *       次に土場だけ棚卸して 3,000 本なら、上野の 200 本は前回値のまま残り 3,200 本。
 *
 * --- 在庫の書き込み経路 ---
 *   stockQuantity を直接書かず lib/materials/stock.ts の applyInventoryAdjustment を通す。
 *   在庫を動かす経路を 1 本に保ち、InventoryTransaction（type='adjustment'）が
 *   必ず残るようにするため（既存の在庫調整画面と同じ扱いになる）。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { applyInventoryAdjustment, type InventoryAdjustmentInput } from './stock';

/** トランザクション内でも外でも使えるクライアント型 */
type StocktakePrismaClient = PrismaClient | Prisma.TransactionClient;

/** 棚卸の状態 */
export const STOCKTAKE_STATUS = {
    /** 入力中（土場で打っている最中）。在庫へは反映しない */
    DRAFT: 'draft',
    /** 確定済み（在庫へ反映済み） */
    CONFIRMED: 'confirmed',
} as const;

export type StocktakeStatus = (typeof STOCKTAKE_STATUS)[keyof typeof STOCKTAKE_STATUS];

/** 工法区分 */
export const SCAFFOLD_METHODS = ['standard', 'lock'] as const;
export type ScaffoldMethod = (typeof SCAFFOLD_METHODS)[number];

/** 工法区分の表示名 */
export const SCAFFOLD_METHOD_LABEL: Record<ScaffoldMethod, string> = {
    standard: '通常足場',
    lock: 'ロック足場',
};

export function isScaffoldMethod(value: unknown): value is ScaffoldMethod {
    return typeof value === 'string' && (SCAFFOLD_METHODS as readonly string[]).includes(value);
}

/**
 * 品目ごとの「置き場所 × 工法ごとの最後に数えた数」の合計を求める。
 *
 * 確定済み（confirmed）の棚卸だけを見る。下書きは在庫に影響させない。
 * quantity が null（数えていない）の行は無視するので、
 * 「今回数えなかった置き場所は前回の数のまま」が自然に成立する。
 *
 * @param excludeStocktakeId この棚卸を計算から外す（確定を取り消すときに使う）
 */
export async function computeStockFromStocktakes(
    client: StocktakePrismaClient,
    materialItemIds: string[],
    excludeStocktakeId?: string,
): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (materialItemIds.length === 0) return result;

    // 置き場所 × 工法 × 品目ごとに、日付が最も新しい 1 行だけを取り出して合計する。
    // DISTINCT ON は PostgreSQL 固有だが、この 3 軸の「最新 1 行」を
    // 1 クエリで取れるので N+1 を避けられる。
    const rows = await client.$queryRaw<{ materialItemId: string; total: bigint | number }[]>`
        SELECT "materialItemId", SUM("quantity")::bigint AS total
        FROM (
            SELECT DISTINCT ON (l."materialItemId", s."locationId", s."scaffoldMethod")
                   l."materialItemId",
                   l."quantity"
            FROM "public"."StocktakeLine" l
            JOIN "public"."Stocktake" s ON s."id" = l."stocktakeId"
            WHERE s."status" = ${STOCKTAKE_STATUS.CONFIRMED}
              AND l."quantity" IS NOT NULL
              AND l."materialItemId" = ANY(${materialItemIds}::text[])
              AND (${excludeStocktakeId ?? null}::text IS NULL OR s."id" <> ${excludeStocktakeId ?? null}::text)
            ORDER BY l."materialItemId", s."locationId", s."scaffoldMethod", s."date" DESC, s."createdAt" DESC
        ) latest
        GROUP BY "materialItemId"
    `;

    for (const row of rows) {
        result.set(row.materialItemId, Number(row.total));
    }
    // 1 度も数えられていない品目は 0 本として扱う
    for (const id of materialItemIds) {
        if (!result.has(id)) result.set(id, 0);
    }
    return result;
}

export interface ConfirmStocktakeResult {
    /** 実際に在庫を動かした品目数 */
    appliedCount: number;
    /** 差分が無かった品目数 */
    unchangedCount: number;
    /** 構造除外品目（リース品など）でスキップした件数 */
    excludedCount: number;
    /** 数えた品目数（quantity が入っている行の数） */
    countedCount: number;
}

/**
 * 棚卸を確定して在庫へ反映する。
 *
 * 呼び出し側でトランザクションを張ること（在庫更新と status 更新を一括で行うため）。
 * 既に確定済みの棚卸を渡すとエラーにする（二重反映を防ぐ）。
 */
export async function confirmStocktake(
    tx: Prisma.TransactionClient,
    stocktakeId: string,
    userId: string | null,
): Promise<ConfirmStocktakeResult> {
    const stocktake = await tx.stocktake.findUnique({
        where: { id: stocktakeId },
        include: {
            location: { select: { name: true } },
            lines: {
                include: {
                    materialItem: {
                        select: { id: true, name: true, stockQuantity: true, category: { select: { name: true } } },
                    },
                },
            },
        },
    });
    if (!stocktake) throw new Error('棚卸が見つかりません');
    if (stocktake.status === STOCKTAKE_STATUS.CONFIRMED) throw new Error('この棚卸は既に確定済みです');

    // 先に確定済みにしてから在庫を計算する。
    // computeStockFromStocktakes は confirmed だけを見るので、
    // 今回の数量を「その置き場所の最新値」として反映させるためにこの順序が要る。
    await tx.stocktake.update({
        where: { id: stocktakeId },
        data: {
            status: STOCKTAKE_STATUS.CONFIRMED,
            confirmedAt: new Date(),
            confirmedBy: userId,
        },
    });

    const countedLines = stocktake.lines.filter((l) => l.quantity !== null);
    const itemIds = countedLines.map((l) => l.materialItemId);
    const targets = await computeStockFromStocktakes(tx, itemIds);

    const inputs: InventoryAdjustmentInput[] = countedLines.map((line) => ({
        materialItemId: line.materialItemId,
        categoryName: line.materialItem.category.name,
        itemName: line.materialItem.name,
        currentQuantity: line.materialItem.stockQuantity,
        targetQuantity: targets.get(line.materialItemId) ?? 0,
        note: `棚卸 ${formatStocktakeLabel(stocktake.date, stocktake.location.name, stocktake.scaffoldMethod)}`,
    }));

    const applied = await applyInventoryAdjustment(tx, inputs, userId);

    return {
        appliedCount: applied.appliedCount,
        unchangedCount: applied.unchangedCount,
        excludedCount: applied.excludedCount,
        countedCount: countedLines.length,
    };
}

/**
 * 同じ置き場所・同じ工法の「前回の棚卸で数えた数」を品目ごとに返す。
 *
 * 入力画面と印刷用チェックシートに前回値を薄く出すために使う。
 * 前回どこまで数えたかが見えないと、土場で数えるときに桁を間違えても気づけない。
 *
 * @param beforeDate この日付より前の棚卸だけを見る（編集中の棚卸自身を除くため）
 */
export async function getPreviousQuantities(
    client: StocktakePrismaClient,
    locationId: string,
    method: ScaffoldMethod,
    beforeDate: Date,
): Promise<Map<string, { quantity: number; date: Date }>> {
    const rows = await client.$queryRaw<{ materialItemId: string; quantity: number; date: Date }[]>`
        SELECT DISTINCT ON (l."materialItemId")
               l."materialItemId", l."quantity", s."date"
        FROM "public"."StocktakeLine" l
        JOIN "public"."Stocktake" s ON s."id" = l."stocktakeId"
        WHERE s."status" = ${STOCKTAKE_STATUS.CONFIRMED}
          AND s."locationId" = ${locationId}
          AND s."scaffoldMethod" = ${method}
          AND s."date" < ${beforeDate}
          AND l."quantity" IS NOT NULL
        ORDER BY l."materialItemId", s."date" DESC, s."createdAt" DESC
    `;
    return new Map(rows.map((r) => [r.materialItemId, { quantity: r.quantity, date: r.date }]));
}

/** InventoryTransaction.notes に残す棚卸の見出し（例: 2026-07-28 土場/通常足場） */
export function formatStocktakeLabel(date: Date, locationName: string, method: string): string {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const ymd = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
    const methodLabel = isScaffoldMethod(method) ? SCAFFOLD_METHOD_LABEL[method] : method;
    return `${ymd} ${locationName}/${methodLabel}`;
}
