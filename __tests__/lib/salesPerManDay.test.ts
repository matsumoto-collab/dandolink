/**
 * 期別・月別・日別の「売上 ÷ 人工」。
 * 3か月移動平均は分析用の月次ファイル（月次_売上と人工_2024-2026.csv）と同じ定義で、
 * 実データの 2024-01〜03 がファイルの値（56,797 / 45,729 / 50,716）と一致することを固定する。
 */
import {
    daysBetween,
    monthsBetween,
    shiftYearMonth,
    summarizeSalesPerManDay,
    type SalesPerManDayFact,
} from '@/lib/salesPerManDay';

/** 月の 1 日を日付に持つ 1 件（月別の確認用） */
const fact = (
    yearMonth: string,
    sales: number,
    manDays: number,
    extra: Partial<SalesPerManDayFact> = {},
): SalesPerManDayFact => ({
    date: `${yearMonth}-01`,
    yearMonth,
    sales,
    manDays,
    customerName: null,
    content: null,
    assigneeId: null,
    assigneeName: null,
    ...extra,
});

/** 日付を持つ 1 件（日別の確認用） */
const dayFact = (date: string, sales: number, manDays: number, extra: Partial<SalesPerManDayFact> = {}): SalesPerManDayFact =>
    fact(date.slice(0, 7), sales, manDays, { date, ...extra });

const monthOpts = (from: string, to: string) => ({ from: `${from}-01`, to: `${to}-28`, granularity: 'month' as const });

describe('日付・月の並び', () => {
    it('年をまたいでずらせる', () => {
        expect(shiftYearMonth('2024-01', -2)).toBe('2023-11');
        expect(shiftYearMonth('2025-12', 1)).toBe('2026-01');
        expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('日の並びは月をまたいでも 1 日ずつ', () => {
        expect(daysBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    });
});

describe('月別', () => {
    // 月次ファイルの実データ（税抜売上・延べ人工）
    const facts = [
        fact('2024-01', 17947810, 316),
        fact('2024-02', 15708766, 420),
        fact('2024-03', 25528959, 431),
    ];

    it('3か月移動平均は「3か月の売上の合計 ÷ 3か月の人工の合計」で、月次ファイルと一致する', () => {
        const r = summarizeSalesPerManDay(facts, monthOpts('2024-01', '2024-03'));
        expect(r.buckets.map((b) => b.key)).toEqual(['2024-01', '2024-02', '2024-03']);
        expect(r.buckets.map((b) => b.salesPerManDay)).toEqual([56797, 37402, 59232]);
        expect(r.buckets.map((b) => b.movingAvg3)).toEqual([56797, 45729, 50716]);
    });

    it('表示の最初の月でも、渡された前の月を移動平均に含める', () => {
        const r = summarizeSalesPerManDay(facts, monthOpts('2024-03', '2024-03'));
        expect(r.buckets).toHaveLength(1);
        expect(r.buckets[0].movingAvg3).toBe(50716);
    });

    it('期別は表示している月だけで合計し、途中の期は月数で分かるようにする', () => {
        const r = summarizeSalesPerManDay(facts, monthOpts('2024-01', '2024-03'));
        expect(r.terms.map((t) => [t.label, t.monthsCovered])).toEqual([['第10期', 2], ['第11期', 1]]);
        expect(r.terms[1]).toMatchObject({ sales: 25528959, manDays: 431, salesPerManDay: 59232 });
    });

    it('2026-04 までは過去データ、2026-05 からは DandoLink として印を付ける', () => {
        const r = summarizeSalesPerManDay([fact('2026-04', 10, 1), fact('2026-05', 10, 1)], monthOpts('2026-04', '2026-05'));
        expect(r.buckets.map((b) => b.source)).toEqual(['backfill', 'live']);
    });
});

describe('日別', () => {
    it('日ごとに人工と売上を並べ、間の日は 0 で埋める。移動平均は出さない', () => {
        const r = summarizeSalesPerManDay(
            [dayFact('2026-06-01', 0, 5), dayFact('2026-06-03', 300000, 0), dayFact('2026-06-03', 0, 4)],
            { from: '2026-06-01', to: '2026-06-03', granularity: 'day' },
        );
        expect(r.buckets.map((b) => [b.key, b.sales, b.manDays, b.salesPerManDay, b.movingAvg3])).toEqual([
            ['2026-06-01', 0, 5, 0, null],
            ['2026-06-02', 0, 0, null, null],
            ['2026-06-03', 300000, 4, 75000, null],
        ]);
    });

    it('日が分からない売上調整は日別には出さず、その額を注記用に返す', () => {
        const adjustment: SalesPerManDayFact = {
            date: null, yearMonth: '2024-05', sales: 500000, manDays: 0,
            customerName: 'エスケー化研', content: null, assigneeId: null, assigneeName: null,
        };
        const r = summarizeSalesPerManDay([adjustment, dayFact('2024-05-10', 100000, 2)], {
            from: '2024-05-01', to: '2024-05-31', granularity: 'day',
        });
        expect(r.buckets.reduce((s, b) => s + b.sales, 0)).toBe(100000);
        expect(r.adjustmentExcludedFromDaily).toBe(500000);
        // 月別なら調整も入る
        const m = summarizeSalesPerManDay([adjustment, dayFact('2024-05-10', 100000, 2)], monthOpts('2024-05', '2024-05'));
        expect(m.buckets[0].sales).toBe(600000);
        expect(m.adjustmentExcludedFromDaily).toBe(0);
    });

    it('期間の外の日は入れない', () => {
        const r = summarizeSalesPerManDay(
            [dayFact('2026-06-01', 0, 5), dayFact('2026-06-10', 0, 3)],
            { from: '2026-06-01', to: '2026-06-05', granularity: 'day' },
        );
        expect(r.buckets).toHaveLength(5);
        expect(r.buckets.reduce((s, b) => s + b.manDays, 0)).toBe(5);
    });
});

describe('区分（顧客別・工事内容別・担当者別）', () => {
    it('顧客別は法人格の有無をまとめ、非現場は区分に入れない（月別・期別には入る）', () => {
        const r = summarizeSalesPerManDay(
            [
                fact('2024-05', 1000, 10, { customerName: 'エスケー化研' }),
                fact('2024-05', 500, 0, { customerName: '株式会社エスケー化研' }),
                fact('2024-05', 300, 5, { customerName: '雄伸工業', excludeFromGroups: true }),
            ],
            monthOpts('2024-05', '2024-05'),
        );
        expect(r.buckets[0]).toMatchObject({ sales: 1800, manDays: 15 });
        expect(r.byCustomer).toEqual([
            { key: 'エスケー化研', name: 'エスケー化研', sales: 1500, manDays: 10, salesPerManDay: 150 },
        ]);
        expect(r.byContent.map((g) => g.sales)).toEqual([1500]);
    });

    it('担当者別にまとめ、担当者のない過去データはまとめて出す', () => {
        const r = summarizeSalesPerManDay(
            [
                fact('2026-06', 900, 3, { assigneeId: 'u1', assigneeName: '今井' }),
                fact('2026-06', 600, 3, { assigneeId: 'u2', assigneeName: '西村' }),
                fact('2024-06', 300, 3),
            ],
            monthOpts('2024-06', '2026-06'),
        );
        expect(r.byAssignee.map((g) => [g.name, g.salesPerManDay])).toEqual([
            ['今井', 300],
            ['西村', 200],
            ['(担当者なし・過去データを含む)', 100],
        ]);
    });

    it('人工が 0 の月・顧客は 売上 ÷ 人工 を出さない（0 で割らない）', () => {
        const r = summarizeSalesPerManDay([fact('2024-05', 1000, 0, { customerName: 'A社' })], monthOpts('2024-05', '2024-05'));
        expect(r.buckets[0].salesPerManDay).toBeNull();
        expect(r.byCustomer[0].salesPerManDay).toBeNull();
    });
});
