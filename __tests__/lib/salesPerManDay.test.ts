/**
 * 期別・月別の「売上 ÷ 人工」。
 * 3か月移動平均は分析用の月次ファイル（月次_売上と人工_2024-2026.csv）と同じ定義で、
 * 実データの 2024-01〜03 がファイルの値（56,797 / 45,729 / 50,716）と一致することを固定する。
 */
import { monthsBetween, shiftYearMonth, summarizeSalesPerManDay, type SalesPerManDayFact } from '@/lib/salesPerManDay';

const fact = (yearMonth: string, sales: number, manDays: number, extra: Partial<SalesPerManDayFact> = {}): SalesPerManDayFact => ({
    yearMonth, sales, manDays, customerName: null, content: null, ...extra,
});

describe('shiftYearMonth / monthsBetween', () => {
    it('年をまたいでずらせる', () => {
        expect(shiftYearMonth('2024-01', -2)).toBe('2023-11');
        expect(shiftYearMonth('2025-12', 1)).toBe('2026-01');
        expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });
});

describe('summarizeSalesPerManDay', () => {
    // 月次ファイルの実データ（税抜売上・延べ人工）
    const facts = [
        fact('2024-01', 17947810, 316),
        fact('2024-02', 15708766, 420),
        fact('2024-03', 25528959, 431),
    ];

    it('3か月移動平均は「3か月の売上の合計 ÷ 3か月の人工の合計」で、月次ファイルと一致する', () => {
        const r = summarizeSalesPerManDay(facts, { from: '2024-01', to: '2024-03', groupFrom: '2024-01', groupTo: '2024-03' });
        expect(r.months.map((m) => m.salesPerManDay)).toEqual([56797, 37402, 59232]);
        expect(r.months.map((m) => m.movingAvg3)).toEqual([56797, 45729, 50716]);
    });

    it('表示の最初の月でも、渡された前の月を移動平均に含める', () => {
        const r = summarizeSalesPerManDay(facts, { from: '2024-03', to: '2024-03', groupFrom: '2024-03', groupTo: '2024-03' });
        expect(r.months).toHaveLength(1);
        expect(r.months[0].movingAvg3).toBe(50716);
    });

    it('期別は表示している月だけで合計し、途中の期は月数で分かるようにする', () => {
        const r = summarizeSalesPerManDay(facts, { from: '2024-01', to: '2024-03', groupFrom: '2024-01', groupTo: '2024-03' });
        expect(r.terms.map((t) => [t.label, t.monthsCovered])).toEqual([['第10期', 2], ['第11期', 1]]);
        expect(r.terms[1]).toMatchObject({ sales: 25528959, manDays: 431, salesPerManDay: 59232 });
    });

    it('2026-04 までは過去データ、2026-05 からは DandoLink として印を付ける', () => {
        const r = summarizeSalesPerManDay([fact('2026-04', 10, 1), fact('2026-05', 10, 1)], {
            from: '2026-04', to: '2026-05', groupFrom: '2026-04', groupTo: '2026-05',
        });
        expect(r.months.map((m) => m.source)).toEqual(['backfill', 'live']);
    });

    it('顧客別は法人格の有無をまとめ、非現場は顧客別・工事内容別に入れない（月別には入れる）', () => {
        const r = summarizeSalesPerManDay(
            [
                fact('2024-05', 1000, 10, { customerName: 'エスケー化研' }),
                fact('2024-05', 500, 0, { customerName: '株式会社エスケー化研' }),
                fact('2024-05', 300, 5, { customerName: '雄伸工業', excludeFromGroups: true }),
            ],
            { from: '2024-05', to: '2024-05', groupFrom: '2024-05', groupTo: '2024-05' },
        );
        expect(r.months[0]).toMatchObject({ sales: 1800, manDays: 15 });
        expect(r.byCustomer).toEqual([
            { key: 'エスケー化研', name: 'エスケー化研', sales: 1500, manDays: 10, salesPerManDay: 150 },
        ]);
        expect(r.byContent.map((g) => g.sales)).toEqual([1500]);
    });

    it('人工が 0 の月・顧客は 売上 ÷ 人工 を出さない（0 で割らない）', () => {
        const r = summarizeSalesPerManDay([fact('2024-05', 1000, 0, { customerName: 'A社' })], {
            from: '2024-05', to: '2024-05', groupFrom: '2024-05', groupTo: '2024-05',
        });
        expect(r.months[0].salesPerManDay).toBeNull();
        expect(r.byCustomer[0].salesPerManDay).toBeNull();
    });
});
