import { sortCashbookEntries, cashbookDisplayDate, cashbookSortKey } from '@/lib/cashbookSort';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('cashbookSort', () => {
    it('cashbookDisplayDate prefers settledAt over date', () => {
        expect(cashbookDisplayDate({ date: d('2026-07-20'), settledAt: d('2026-07-02') })).toBe(d('2026-07-02').getTime());
        expect(cashbookDisplayDate({ date: d('2026-07-20'), settledAt: null })).toBe(d('2026-07-20').getTime());
        // API レスポンス（文字列）でも同じ結果になる
        expect(cashbookDisplayDate({ date: '2026-07-20T00:00:00.000Z', settledAt: '2026-07-02T00:00:00.000Z' })).toBe(d('2026-07-02').getTime());
    });

    it('cashbookSortKey falls back to seq when sortOrder is null', () => {
        expect(cashbookSortKey({ sortOrder: null, seq: 7 })).toBe(7);
        expect(cashbookSortKey({ sortOrder: 2.5, seq: 7 })).toBe(2.5);
        expect(cashbookSortKey({ sortOrder: '2.5', seq: 7 })).toBe(2.5); // Prisma Decimal/JSON 文字列
    });

    it('sorts by display date, then sortOrder/seq, then seq', () => {
        const rows = [
            { id: 'c', date: d('2026-07-10'), settledAt: null, sortOrder: null, seq: 3 },
            // 取引日は 7/20 だが清算日 7/1 → 先頭
            { id: 'a', date: d('2026-07-20'), settledAt: d('2026-07-01'), sortOrder: null, seq: 5 },
            // c と同じ 7/10。sortOrder 2.5 < seq3 → c より前
            { id: 'b', date: d('2026-07-10'), settledAt: null, sortOrder: 2.5, seq: 4 },
            { id: 'd', date: d('2026-07-05'), settledAt: null, sortOrder: null, seq: 1 },
        ];
        expect(sortCashbookEntries(rows).map((r) => r.id)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('breaks sortKey ties by seq and does not mutate the input array', () => {
        const rows = [
            { id: 'y', date: d('2026-07-10'), settledAt: null, sortOrder: 2, seq: 9 },
            { id: 'x', date: d('2026-07-10'), settledAt: null, sortOrder: 2, seq: 8 },
        ];
        const sorted = sortCashbookEntries(rows);
        expect(sorted.map((r) => r.id)).toEqual(['x', 'y']);
        expect(rows.map((r) => r.id)).toEqual(['y', 'x']); // 元配列は不変
    });
});
