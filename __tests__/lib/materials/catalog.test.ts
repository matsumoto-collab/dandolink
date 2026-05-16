/**
 * 材料カタログ 構造検証（Jest 版）
 *
 * scripts/verify-materials-catalog.ts と同じ不変条件を Jest で検証する。
 * tsx が未導入の環境でも `npm test` で green を確認できるように用意。
 */
import {
    CATALOG_ITEMS,
    CATALOG_CATEGORIES,
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
