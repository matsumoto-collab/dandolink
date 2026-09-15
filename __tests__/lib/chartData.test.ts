import {
    REST_KEY,
    buildOwnCrewDaily,
    buildProfitComposition,
    buildSalesProfitBars,
    buildSalesShare,
    foldTopN,
    summarizeOwnCrewContent,
} from '@/lib/chartData';
import { emptyOwnCrewVolumeTotals, type OwnCrewVolumeGroup, type OwnCrewVolumeRow } from '@/lib/ownCrewVolume';
import type { MonthlyAssigneeRow } from '@/lib/profitDashboard';
import { formatYenAxis, formatYenCompact, niceScale, truncateLabel } from '@/components/charts/chartTheme';

const costs = {
    laborCost: 350000,
    loadingCost: 50000,
    vehicleCost: 80000,
    materialCost: 100000,
    subcontractorCost: 100000,
    otherExpenses: 20000,
};
const zeroCosts = { laborCost: 0, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0 };

describe('buildProfitComposition', () => {
    it('黒字なら 利益＋原価の内訳（0円の項目は外す）で売上を分ける', () => {
        const result = buildProfitComposition({ ...costs, otherExpenses: 0 }, 1000000, 320000);
        expect(result?.mode).toBe('revenue');
        expect(result?.segments.map((s) => s.key)).toEqual(['profit', 'subcontractor', 'labor', 'material', 'loading', 'vehicle']);
        expect(result?.segments.reduce((sum, s) => sum + s.value, 0)).toBe(1000000);
        expect(result?.totalCost).toBe(680000);
        expect(result?.lossAmount).toBe(0);
    });

    it('赤字なら利益を入れず原価の内訳だけにして、赤字額を返す', () => {
        const result = buildProfitComposition(costs, 600000, -100000);
        expect(result?.mode).toBe('cost');
        expect(result?.segments.some((s) => s.key === 'profit')).toBe(false);
        expect(result?.totalCost).toBe(700000);
        expect(result?.lossAmount).toBe(100000);
    });

    it('売上が無ければ原価の内訳だけ（赤字額は出さない）', () => {
        const result = buildProfitComposition(costs, 0, -700000);
        expect(result?.mode).toBe('cost');
        expect(result?.lossAmount).toBe(0);
    });

    it('売上も原価も無ければ null', () => {
        expect(buildProfitComposition(zeroCosts, 0, 0)).toBeNull();
    });
});

describe('foldTopN', () => {
    const items = [{ k: 'a', v: 5 }, { k: 'b', v: 50 }, { k: 'c', v: 20 }, { k: 'd', v: 1 }, { k: 'e', v: 3 }];
    const fold = (rest: { k: string; v: number }[]) => ({ k: 'rest', v: rest.reduce((sum, x) => sum + x.v, 0) });

    it('大きい順に並べ、上位 n 件の後ろを 1 件にまとめる', () => {
        expect(foldTopN(items, 2, (x) => x.v, fold)).toEqual([{ k: 'b', v: 50 }, { k: 'c', v: 20 }, { k: 'rest', v: 9 }]);
    });

    it('あふれるのが 1 件だけならまとめない（minRest 既定 2）', () => {
        expect(foldTopN(items, 4, (x) => x.v, fold).map((x) => x.k)).toEqual(['b', 'c', 'a', 'e', 'd']);
    });

    it('minRest=1 なら 1 件でもまとめる', () => {
        expect(foldTopN(items, 4, (x) => x.v, fold, 1).map((x) => x.k)).toEqual(['b', 'c', 'a', 'e', 'rest']);
    });
});

describe('buildOwnCrewDaily / summarizeOwnCrewContent', () => {
    const row = (over: Partial<OwnCrewVolumeRow>): OwnCrewVolumeRow => ({
        assignmentId: 'a',
        date: '2026-09-01',
        foremanId: 'f1',
        foremanName: '田畑',
        projectMasterId: 'p1',
        projectTitle: '現場',
        customerName: null,
        managerName: null,
        constructionTypeName: '組立',
        workerCount: 3,
        memberCount: 3,
        hours: 8,
        laborCost: 54000,
        outsourcingEquivalent: 90000,
        earnings: 120000,
        salesBasis: 'invoice',
        flags: [],
        ...over,
    });
    const group = (foremanId: string, rows: OwnCrewVolumeRow[]): OwnCrewVolumeGroup => ({
        foremanId,
        foremanName: foremanId,
        rows,
        totals: emptyOwnCrewVolumeTotals(),
    });
    const groups = [
        group('f1', [
            row({}),
            row({ assignmentId: 'b', constructionTypeName: '解体', workerCount: 2, projectMasterId: 'p2', earnings: null }),
            row({ assignmentId: 'c', date: '2026-09-14', constructionTypeName: '搬入', workerCount: 1 }),
            row({ assignmentId: 'x', date: '2026-08-31', workerCount: 9 }), // 表示月の外は数えない
        ]),
        group('f2', [
            row({ assignmentId: 'd', foremanId: 'f2', workerCount: 4 }),
            row({ assignmentId: 'e', foremanId: 'f2', date: '2026-09-30', workerCount: 0, flags: ['no_report'] }),
        ]),
    ];

    it('月の日数ぶん並べ、作業内容ごとの人数・現場数・稼ぎ・人件費を日ごとに足す', () => {
        const points = buildOwnCrewDaily(groups, 2026, 9);
        expect(points).toHaveLength(30);
        expect(points[0]).toMatchObject({
            date: '2026-09-01',
            day: 1,
            weekday: 2, // 火曜
            assembly: 7,
            demolition: 2,
            other: 0,
            manDays: 9,
            siteCount: 2,
            earnings: 240000,
            laborCost: 162000,
            noReportCount: 0,
        });
        expect(points[13]).toMatchObject({ day: 14, weekday: 1, other: 1, manDays: 1 });
        expect(points[1]).toMatchObject({ day: 2, manDays: 0, siteCount: 0 });
        expect(points[29]).toMatchObject({ day: 30, manDays: 0, noReportCount: 1 });
    });

    it('月の延べ人工を 組立／解体／その他 に分ける（組立・解体以外の種別はその他）', () => {
        // 月の外の行（8/31）も入るが、画面は表示月の行しか受け取らない
        expect(summarizeOwnCrewContent([group('f1', [row({}), row({ constructionTypeName: '解体', workerCount: 2 }), row({ constructionTypeName: null, workerCount: 1 })])]))
            .toEqual({ assembly: 3, demolition: 2, other: 1 });
    });
});

describe('buildSalesProfitBars / buildSalesShare', () => {
    const r = (key: string, sales: number, cost: number, itemCount = 1): MonthlyAssigneeRow => ({
        key,
        name: key,
        sales,
        cost,
        grossProfit: sales - cost,
        items: Array.from({ length: itemCount }, (_, i) => ({
            projectId: `${key}${i}`,
            projectName: '現場',
            customerName: '',
            sales: 0,
            cost: 0,
            grossProfit: 0,
        })),
    });

    it('棒の長さ＝売上で、粗利の部分と原価の部分に分ける（赤字は全部を原価として描く・売上0は外す）', () => {
        const bars = buildSalesProfitBars([r('A', 1000, 700), r('B', 500, 800), r('Z', 0, 100)], 8);
        expect(bars.map((b) => b.key)).toEqual(['A', 'B']);
        expect(bars[0]).toMatchObject({ profitPart: 300, costPart: 700, margin: 30 });
        expect(bars[1]).toMatchObject({ profitPart: 0, costPart: 500, margin: -60 });
    });

    it('上位 N 件の後ろは「その他（件数）」に合算する', () => {
        const bars = buildSalesProfitBars([r('A', 900, 0), r('B', 800, 0), r('C', 300, 100), r('D', 200, 100)], 1);
        expect(bars).toHaveLength(2);
        expect(bars[1]).toMatchObject({ key: REST_KEY, name: 'その他（3）', sales: 1300, cost: 200, grossProfit: 1100, itemCount: 3 });
    });

    it('売上の割合は上位 N 件の後ろを 1 件でも「その他」にまとめる', () => {
        const share = buildSalesShare([r('A', 900, 0), r('B', 800, 0), r('C', 300, 0)], 2);
        expect(share).toEqual([
            { key: 'A', label: 'A', value: 900 },
            { key: 'B', label: 'B', value: 800 },
            { key: REST_KEY, label: 'その他（1）', value: 300 },
        ]);
    });
});

describe('chartTheme の書式', () => {
    it('formatYenAxis: 億未満は万単位（10万未満の端数は小数1桁）', () => {
        expect(formatYenAxis(0)).toBe('0');
        expect(formatYenAxis(5000)).toBe('5000');
        expect(formatYenAxis(25000)).toBe('2.5万');
        expect(formatYenAxis(15000000)).toBe('1,500万');
        expect(formatYenAxis(150000000)).toBe('1.5億');
        expect(formatYenAxis(-20000)).toBe('-2万');
    });

    it('formatYenCompact: 真ん中に置く短い金額', () => {
        expect(formatYenCompact(8000)).toBe('¥8,000');
        expect(formatYenCompact(345678)).toBe('34.6万');
        expect(formatYenCompact(12345678)).toBe('1,235万');
        expect(formatYenCompact(123456789)).toBe('1.2億');
    });

    it('niceScale: 最低ラインを含めて、きりのいい目盛りにする', () => {
        expect(niceScale(0, 40043)).toEqual({ domain: [0, 50000], ticks: [0, 10000, 20000, 30000, 40000, 50000] });
        expect(niceScale(-5000, 40000).domain).toEqual([-10000, 40000]);
        expect(niceScale(0, 0).domain[1]).toBeGreaterThan(0);
    });

    it('truncateLabel: 長い名前は … で切る', () => {
        expect(truncateLabel('株式会社サンプル建設', 5)).toBe('株式会社サ…');
        expect(truncateLabel('田畑', 5)).toBe('田畑');
    });
});
