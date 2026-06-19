/**
 * 貸出中集計エンジン computeLentOut の単体テスト。
 *
 * 検証観点:
 *   (a) 出庫のみ → 出庫数がそのまま貸出中
 *   (b) 返却混在 → 出庫 − 返却
 *   (c) 紛失混在 → 出庫 − 紛失（在庫は別途・ここでは貸出中のみ）
 *   (d) 部分返却 → 残りが貸出中、全返却で 0 は結果から除外
 *   (e) loaded 以外（draft/confirmed）の伝票は集計対象外
 *   (f) カテゴリ→品目 sortOrder で整列
 */
import { computeLentOut, lentOutQuantityMap, type LentOutRequisitionInput } from '@/lib/materials/lentOut';

function mkItem(
    materialItemId: string,
    quantity: number,
    opts?: { name?: string; categoryName?: string; categorySortOrder?: number; itemSortOrder?: number },
) {
    return {
        materialItemId,
        quantity,
        materialItem: {
            name: opts?.name ?? materialItemId,
            spec: null,
            unit: '本',
            sortOrder: opts?.itemSortOrder ?? 0,
            category: {
                name: opts?.categoryName ?? '柱',
                sortOrder: opts?.categorySortOrder ?? 0,
            },
        },
    };
}

function req(
    type: string,
    status: string,
    items: ReturnType<typeof mkItem>[],
): LentOutRequisitionInput {
    return { type, status, items };
}

describe('computeLentOut', () => {
    it('(a) 出庫のみ → 出庫数がそのまま貸出中', () => {
        const result = computeLentOut([
            req('出庫', 'loaded', [mkItem('A', 100), mkItem('B', 50)]),
        ]);
        expect(result.map(r => [r.materialItemId, r.lentOut])).toEqual([
            ['A', 100],
            ['B', 50],
        ]);
    });

    it('(b) 返却混在 → 出庫 − 返却', () => {
        const result = computeLentOut([
            req('出庫', 'loaded', [mkItem('A', 100)]),
            req('返却', 'loaded', [mkItem('A', 40)]),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ materialItemId: 'A', lentOut: 60 });
    });

    it('(c) 紛失も貸出中から減算する', () => {
        const result = computeLentOut([
            req('出庫', 'loaded', [mkItem('A', 100)]),
            req('紛失', 'loaded', [mkItem('A', 30)]),
        ]);
        expect(result[0]).toMatchObject({ materialItemId: 'A', lentOut: 70 });
    });

    it('(d) 全返却で 0 になった品目は結果から除外、部分は残る', () => {
        const result = computeLentOut([
            req('出庫', 'loaded', [mkItem('A', 100), mkItem('B', 30)]),
            req('返却', 'loaded', [mkItem('A', 100), mkItem('B', 10)]),
        ]);
        expect(result.map(r => r.materialItemId)).toEqual(['B']);
        expect(result[0].lentOut).toBe(20);
    });

    it('(e) loaded 以外の伝票は集計対象外', () => {
        const result = computeLentOut([
            req('出庫', 'draft', [mkItem('A', 100)]),
            req('出庫', 'confirmed', [mkItem('A', 50)]),
            req('出庫', 'loaded', [mkItem('A', 10)]),
        ]);
        expect(result).toEqual([
            expect.objectContaining({ materialItemId: 'A', lentOut: 10 }),
        ]);
    });

    it('(f) カテゴリ→品目 sortOrder で整列', () => {
        const result = computeLentOut([
            req('出庫', 'loaded', [
                mkItem('late', 10, { categoryName: '手摺', categorySortOrder: 2, itemSortOrder: 0 }),
                mkItem('earlyB', 10, { categoryName: '柱', categorySortOrder: 1, itemSortOrder: 1 }),
                mkItem('earlyA', 10, { categoryName: '柱', categorySortOrder: 1, itemSortOrder: 0 }),
            ]),
        ]);
        expect(result.map(r => r.materialItemId)).toEqual(['earlyA', 'earlyB', 'late']);
    });

    it('過返却（返却 > 出庫）は結果に出さない（負は除外）', () => {
        const result = computeLentOut([
            req('出庫', 'loaded', [mkItem('A', 50)]),
            req('返却', 'loaded', [mkItem('A', 80)]),
        ]);
        expect(result).toEqual([]);
    });

    it('lentOutQuantityMap は materialItemId -> lentOut を返す', () => {
        const map = lentOutQuantityMap([
            req('出庫', 'loaded', [mkItem('A', 100), mkItem('B', 20)]),
            req('返却', 'loaded', [mkItem('A', 30)]),
        ]);
        expect(map.get('A')).toBe(70);
        expect(map.get('B')).toBe(20);
        expect(map.has('C')).toBe(false);
    });
});
