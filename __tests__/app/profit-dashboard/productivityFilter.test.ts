/**
 * 「一人当たりの稼ぎ」タブの絞り込みバーが使うヘルパー。
 * 期間のボタンが JST で作られること、日別に切り替えられる長さ、
 * 稼ぎを出せる期間（2026-05 から）の判定を固定する。
 */
import {
    MAX_DAY_RANGE_DAYS,
    defaultProductivityFilter,
    effectiveProfitFrom,
    endOfMonth,
    isBackfillOnlyRange,
    presetKeyOf,
    productivityPresets,
    rangeDays,
    recentMonths,
    spansBackfill,
    toQuery,
} from '@/app/(standalone)/profit-dashboard/components/productivityFilter';

// JST 2026-09-12 09:00（＝UTC 2026-09-12 00:00）に固定する
beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-12T00:00:00Z'));
});
afterAll(() => {
    jest.useRealTimers();
});

describe('期間', () => {
    it('直近nか月は「n-1か月前の1日」から「今日」まで', () => {
        expect(recentMonths(1)).toEqual({ from: '2026-09-01', to: '2026-09-12' });
        expect(recentMonths(12)).toEqual({ from: '2025-10-01', to: '2026-09-12' });
    });

    it('月末は月によって変わる（うるう年も）', () => {
        expect(endOfMonth('2026-02')).toBe('2026-02-28');
        expect(endOfMonth('2028-02')).toBe('2028-02-29');
        expect(endOfMonth('2027-02')).toBe('2027-02-28');
    });

    it('期のボタンは第11期から今期（第13期）まで出て、期の区切りは3月はじまり', () => {
        const terms = productivityPresets().filter((p) => p.key.startsWith('term'));
        expect(terms.map((p) => p.label)).toEqual(['第13期', '第12期', '第11期']);
        expect(terms[2]).toMatchObject({ from: '2024-03-01', to: '2025-02-28' });
        expect(terms[0]).toMatchObject({ from: '2026-03-01', to: '2027-02-28' });
    });

    it('全期間は過去データの最初（2024-01）から今日まで', () => {
        const all = productivityPresets().find((p) => p.key === 'all');
        expect(all).toMatchObject({ from: '2024-01-01', to: '2026-09-12' });
    });

    it('今の期間と同じボタンが分かる。日付を直接指定したときは null', () => {
        expect(presetKeyOf('2025-10-01', '2026-09-12')).toBe('m12');
        expect(presetKeyOf('2024-03-01', '2025-02-28')).toBe('term11');
        expect(presetKeyOf('2026-06-03', '2026-06-20')).toBeNull();
    });

    it('日数は両端を含む', () => {
        expect(rangeDays('2026-09-01', '2026-09-01')).toBe(1);
        expect(rangeDays('2026-02-27', '2026-03-02')).toBe(4);
        // 日別に切り替えられるのは 120 日まで
        expect(rangeDays('2026-05-01', '2026-08-28')).toBe(MAX_DAY_RANGE_DAYS);
        expect(rangeDays('2025-10-01', '2026-09-12')).toBeGreaterThan(MAX_DAY_RANGE_DAYS);
    });
});

describe('過去データとの境目', () => {
    it('期間が丸ごと2026-04以前なら稼ぎは出せない', () => {
        expect(isBackfillOnlyRange({ to: '2026-04-30' })).toBe(true);
        expect(isBackfillOnlyRange({ to: '2026-05-01' })).toBe(false);
    });

    it('期間が2026-04以前にかかっているかが分かる', () => {
        expect(spansBackfill({ from: '2025-10-01' })).toBe(true);
        expect(spansBackfill({ from: '2026-05-01' })).toBe(false);
    });

    it('稼ぎの開始日は2026-05-01まで切り上げる', () => {
        expect(effectiveProfitFrom('2024-01-01')).toBe('2026-05-01');
        expect(effectiveProfitFrom('2026-07-01')).toBe('2026-07-01');
    });
});

describe('APIに渡すクエリ', () => {
    it('既定は直近12か月・月別・絞り込みなし', () => {
        expect(defaultProductivityFilter()).toEqual({
            from: '2025-10-01', to: '2026-09-12', granularity: 'month',
            assigneeId: '', customerKey: '', content: '',
        });
    });

    it('空の絞り込みはクエリに入れない', () => {
        const f = defaultProductivityFilter();
        expect(toQuery(f)).toBe('from=2025-10-01&to=2026-09-12');
        expect(toQuery({ ...f, assigneeId: 'u1', content: '足場' }, { granularity: 'day' }))
            .toBe('from=2025-10-01&to=2026-09-12&granularity=day&assigneeId=u1&content=%E8%B6%B3%E5%A0%B4');
    });
});
