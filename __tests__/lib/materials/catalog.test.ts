/**
 * 材料カタログ 構造検証（Jest 版）
 *
 * scripts/verify-materials-catalog.ts と同じ不変条件を Jest で検証する。
 * tsx が未導入の環境でも `npm test` で green を確認できるように用意。
 */
import {
    CATALOG_ITEMS,
    CATALOG_CATEGORIES,
    CATEGORY_ORDER,
    SHEET_TYPES,
    countByColumn,
    naturalKey,
} from '@/lib/materials/catalog';

describe('materials catalog 構造検証', () => {
    it('自然キー (categoryName + itemName) が一意', () => {
        const seen = new Set<string>();
        const dups: string[] = [];
        for (const it of CATALOG_ITEMS) {
            const k = naturalKey(it.categoryName, it.itemName);
            if (seen.has(k)) dups.push(k);
            seen.add(k);
        }
        expect(dups).toEqual([]);
    });

    it('全品目に PDF 列配置がある', () => {
        for (const it of CATALOG_ITEMS) {
            expect(['COL1', 'COL2', 'COL3']).toContain(it.pdf.column);
            expect(Number.isInteger(it.pdf.orderInGroup)).toBe(true);
            expect(it.pdf.orderInGroup).toBeGreaterThanOrEqual(0);
        }
    });

    it('SHEET_TYPES は 7 件・重複なし・誤字「新素用」が無い', () => {
        expect(SHEET_TYPES.length).toBe(7);
        expect(new Set(SHEET_TYPES).size).toBe(7);
        expect(SHEET_TYPES.some((s) => s.includes('新素用'))).toBe(false);
        expect(SHEET_TYPES.some((s) => s.includes('新築用'))).toBe(true);
    });

    it('列内グループ (column + groupIndex) の orderInGroup に重複が無い', () => {
        const map = new Map<string, Set<number>>();
        const dups: string[] = [];
        for (const it of CATALOG_ITEMS) {
            const gk = `${it.pdf.column}|${it.pdf.groupIndex}`;
            if (!map.has(gk)) map.set(gk, new Set());
            const set = map.get(gk)!;
            if (set.has(it.pdf.orderInGroup)) dups.push(`${gk}#${it.pdf.orderInGroup}`);
            set.add(it.pdf.orderInGroup);
        }
        expect(dups).toEqual([]);
    });

    it('カテゴリ内 itemSortOrder に重複が無い', () => {
        const map = new Map<string, Set<number>>();
        const dups: string[] = [];
        for (const it of CATALOG_ITEMS) {
            if (!map.has(it.categoryName)) map.set(it.categoryName, new Set());
            const set = map.get(it.categoryName)!;
            if (set.has(it.itemSortOrder)) dups.push(`${it.categoryName}#${it.itemSortOrder}`);
            set.add(it.itemSortOrder);
        }
        expect(dups).toEqual([]);
    });

    it('initialStock は全品目 0（Phase 1 要件）', () => {
        const nonZero = CATALOG_ITEMS.filter((it) => it.initialStock !== 0);
        expect(nonZero).toEqual([]);
    });

    it('countByColumn の合計が品目総数と一致', () => {
        const c = countByColumn();
        expect(c.COL1 + c.COL2 + c.COL3).toBe(CATALOG_ITEMS.length);
    });

    it('CATALOG_CATEGORIES が全品目のカテゴリを網羅', () => {
        const catSet = new Set(CATALOG_CATEGORIES.map((c) => c.name));
        for (const it of CATALOG_ITEMS) {
            expect(catSet.has(it.categoryName)).toBe(true);
        }
    });

    it('全 CatalogItem.categoryName が CATEGORY_ORDER に存在する（fallback sortOrder の静かな崩壊防止）', () => {
        const known = new Set(CATEGORY_ORDER);
        const missing = Array.from(
            new Set(
                CATALOG_ITEMS
                    .map((it) => it.categoryName)
                    .filter((c) => !known.has(c)),
            ),
        );
        expect(missing).toEqual([]);
        // 既知カテゴリは fallback（CATEGORY_ORDER.length + 1）に落ちていないこと
        const fallback = CATEGORY_ORDER.length + 1;
        const fellBack = CATALOG_ITEMS.filter((it) => it.categorySortOrder === fallback);
        expect(fellBack).toEqual([]);
    });

    it('シート全品目とリース品は excludeFromStockDecrement===true、代表品目は false/未設定', () => {
        const netItems = CATALOG_ITEMS.filter((it) => it.categoryName === 'シート');
        const leaseItems = CATALOG_ITEMS.filter((it) => it.categoryName === 'リース品');
        // 対象が catalog に存在することを前提に検証（消失で静かに緩むのを防ぐ）
        expect(netItems.length).toBeGreaterThan(0);
        expect(leaseItems.length).toBeGreaterThan(0);
        for (const it of netItems) {
            expect(it.excludeFromStockDecrement).toBe(true);
        }
        for (const it of leaseItems) {
            expect(it.excludeFromStockDecrement).toBe(true);
        }
        // 代表的な在庫対象品目（柱 3.6m）は減算対象（false / 未設定）
        const pillar = CATALOG_ITEMS.find(
            (it) => it.categoryName === '柱' && it.itemName === '3.6m',
        );
        expect(pillar).toBeDefined();
        expect(pillar!.excludeFromStockDecrement ?? false).toBe(false);
        // 除外対象は「シート」「リース品」のみであること（スコープの不用意な拡大防止）
        const excludedCats = Array.from(
            new Set(
                CATALOG_ITEMS
                    .filter((it) => it.excludeFromStockDecrement === true)
                    .map((it) => it.categoryName),
            ),
        ).sort();
        expect(excludedCats).toEqual(['シート', 'リース品'].sort());
    });

    it('構造サマリを出力（参考）', () => {
        const c = countByColumn();
        // eslint-disable-next-line no-console
        console.log(
            `[catalog] categories=${CATALOG_CATEGORIES.length} items=${CATALOG_ITEMS.length} ` +
                `COL1=${c.COL1} COL2=${c.COL2} COL3=${c.COL3} sheetTypes=${SHEET_TYPES.length}`,
        );
        expect(CATALOG_ITEMS.length).toBeGreaterThan(0);
    });
});
