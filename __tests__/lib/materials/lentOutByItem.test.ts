/**
 * 品目軸の貸出中集計 lentOutByItem の単体テスト。
 *
 * 検証観点:
 *   (a) summary: 品目ごとの貸出中合計（>0 のみ）
 *   (b) sites: 現場ごとに貸出中(>0) の品目をまとめ、残ありの現場のみ
 *   (c) 返却で 0 になった現場・品目は除外
 *   (d) 最終出庫日・担当は '出庫' 伝票の最新を採用
 *   (e) byItem: ある品目の現場逆引き（lentOut 降順）
 *   (f) loaded 以外は集計対象外
 */
import {
    computeLentOutSummary,
    computeLentOutSites,
    computeLentOutByItem,
    type SiteLentOutRequisitionInput,
} from '@/lib/materials/lentOutByItem';

function mkItem(materialItemId: string, quantity: number, opts?: { name?: string; spec?: string | null; itemSortOrder?: number; categorySortOrder?: number }) {
    return {
        materialItemId,
        quantity,
        materialItem: {
            name: opts?.name ?? materialItemId,
            spec: opts?.spec ?? null,
            unit: '本',
            sortOrder: opts?.itemSortOrder ?? 0,
            category: { name: '柱', sortOrder: opts?.categorySortOrder ?? 0 },
        },
    };
}

function req(
    opts: { type?: string; status?: string; projectMasterId: string; projectName: string; foremanName?: string | null; date: string },
    items: ReturnType<typeof mkItem>[],
): SiteLentOutRequisitionInput {
    return {
        type: opts.type ?? '出庫',
        status: opts.status ?? 'loaded',
        projectMasterId: opts.projectMasterId,
        projectName: opts.projectName,
        foremanName: opts.foremanName ?? null,
        date: opts.date,
        items,
    };
}

describe('computeLentOutSummary', () => {
    it('(a) 品目ごとの貸出中合計を返す（複数現場を合算・>0 のみ）', () => {
        const summary = computeLentOutSummary([
            req({ projectMasterId: 'p1', projectName: '現場1', date: '2026-03-01' }, [mkItem('A', 80), mkItem('B', 20)]),
            req({ projectMasterId: 'p2', projectName: '現場2', date: '2026-03-11' }, [mkItem('A', 98)]),
            req({ type: '返却', projectMasterId: 'p1', projectName: '現場1', date: '2026-03-05' }, [mkItem('B', 20)]),
        ]);
        expect(summary).toEqual({ A: 178 }); // B は全返却で 0 → 除外
    });

    it('(f) loaded 以外は対象外', () => {
        const summary = computeLentOutSummary([
            req({ status: 'draft', projectMasterId: 'p1', projectName: '現場1', date: '2026-03-01' }, [mkItem('A', 80)]),
            req({ status: 'loaded', projectMasterId: 'p1', projectName: '現場1', date: '2026-03-02' }, [mkItem('A', 10)]),
        ]);
        expect(summary).toEqual({ A: 10 });
    });
});

describe('computeLentOutSites', () => {
    it('(b)(c) 現場ごとに残ありの品目をまとめ、残0の現場は除外', () => {
        const sites = computeLentOutSites([
            req({ projectMasterId: 'p1', projectName: '現場1', foremanName: '高橋', date: '2026-03-01' }, [mkItem('A', 80), mkItem('B', 20)]),
            req({ projectMasterId: 'p2', projectName: '現場2', foremanName: '村上', date: '2026-03-11' }, [mkItem('A', 50)]),
            // p2 は全返却 → 現場ごと消える
            req({ type: '返却', projectMasterId: 'p2', projectName: '現場2', date: '2026-03-20' }, [mkItem('A', 50)]),
        ]);
        expect(sites).toHaveLength(1);
        expect(sites[0].projectMasterId).toBe('p1');
        expect(sites[0].totalQuantity).toBe(100);
        expect(sites[0].items.map(i => i.materialItemId)).toEqual(['A', 'B']);
    });

    it('(d) 最終出庫日・担当は 出庫 伝票の最新を採用（返却日は無視）', () => {
        const sites = computeLentOutSites([
            req({ projectMasterId: 'p1', projectName: '現場1', foremanName: '高橋', date: '2026-03-01' }, [mkItem('A', 80)]),
            req({ projectMasterId: 'p1', projectName: '現場1', foremanName: '佐藤', date: '2026-03-09' }, [mkItem('B', 30)]),
            req({ type: '返却', projectMasterId: 'p1', projectName: '現場1', foremanName: 'X', date: '2026-03-30' }, [mkItem('A', 10)]),
        ]);
        expect(sites[0].lastDispatchDate).toBe('2026-03-09');
        expect(sites[0].foremanName).toBe('佐藤');
    });

    it('現場は最終出庫日の新しい順', () => {
        const sites = computeLentOutSites([
            req({ projectMasterId: 'old', projectName: '古い現場', date: '2026-03-01' }, [mkItem('A', 10)]),
            req({ projectMasterId: 'new', projectName: '新しい現場', date: '2026-03-20' }, [mkItem('A', 10)]),
        ]);
        expect(sites.map(s => s.projectMasterId)).toEqual(['new', 'old']);
    });
});

describe('computeLentOutByItem', () => {
    it('(e) ある品目が出ている現場を lentOut 降順で返す', () => {
        const reqs = [
            req({ projectMasterId: 'p1', projectName: '現場1', date: '2026-03-01' }, [mkItem('A', 30)]),
            req({ projectMasterId: 'p2', projectName: '現場2', date: '2026-03-11' }, [mkItem('A', 98), mkItem('B', 5)]),
        ];
        const result = computeLentOutByItem(reqs, 'A');
        expect(result.map(s => [s.projectMasterId, s.lentOut])).toEqual([
            ['p2', 98],
            ['p1', 30],
        ]);
    });

    it('出ていない品目は空配列', () => {
        const reqs = [req({ projectMasterId: 'p1', projectName: '現場1', date: '2026-03-01' }, [mkItem('A', 30)])];
        expect(computeLentOutByItem(reqs, 'Z')).toEqual([]);
    });
});
