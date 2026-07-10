import { findCandidates } from '@/lib/cardMatching';

const receipt = (totalAmount: number | string | null, issueDate: string | null, id = 'r') => ({
    id,
    totalAmount,
    issueDate,
});

describe('findCandidates', () => {
    const line = { amount: 12980, useDate: '2026-05-17T00:00:00.000Z' };

    it('matches exact amount within the ±3 day window (inclusive boundary)', () => {
        const inWindow = receipt(12980, '2026-05-20T00:00:00.000Z', 'edge'); // ちょうど+3日
        const outWindow = receipt(12980, '2026-05-21T00:00:00.000Z', 'out'); // +4日
        const { exact } = findCandidates(line, [inWindow, outWindow]);
        expect(exact.map((r) => r.id)).toEqual(['edge']);
    });

    it('excludes receipts with a different amount', () => {
        const { exact, amountOnly } = findCandidates(line, [receipt(12981, '2026-05-17T00:00:00.000Z')]);
        expect(exact).toEqual([]);
        expect(amountOnly).toEqual([]);
    });

    it('compares Decimal-as-string amounts numerically', () => {
        const r = receipt('12980.00', '2026-05-17T00:00:00.000Z');
        const lineStr = { amount: '12980', useDate: '2026-05-17T00:00:00.000Z' };
        expect(findCandidates(lineStr, [r]).exact).toHaveLength(1);
    });

    it('puts amount-matching receipts without a date into the weak amountOnly group', () => {
        const { exact, amountOnly } = findCandidates(line, [receipt(12980, null, 'nodate')]);
        expect(exact).toEqual([]);
        expect(amountOnly.map((r) => r.id)).toEqual(['nodate']);
    });

    it('skips receipts with a null amount', () => {
        const { exact, amountOnly } = findCandidates(line, [receipt(null, '2026-05-17T00:00:00.000Z')]);
        expect(exact).toEqual([]);
        expect(amountOnly).toEqual([]);
    });

    it('returns empty groups for refund (negative) lines', () => {
        const refund = { amount: -3000, useDate: '2026-05-17T00:00:00.000Z' };
        expect(findCandidates(refund, [receipt(-3000, '2026-05-17T00:00:00.000Z'), receipt(3000, '2026-05-17T00:00:00.000Z')])).toEqual({
            exact: [],
            amountOnly: [],
        });
    });

    it('respects a custom window size', () => {
        const r = receipt(12980, '2026-05-22T00:00:00.000Z'); // +5日
        expect(findCandidates(line, [r], 3).exact).toHaveLength(0);
        expect(findCandidates(line, [r], 5).exact).toHaveLength(1);
    });

    describe('foreign currency (USD) receipts', () => {
        // AMEX 実例: $29.39 @164.818 → ¥4,844
        const usdLine = { amount: 4844, useDate: '2026-05-20T00:00:00.000Z', foreignAmount: '29.39', currency: 'USD' };

        it('matches a USD receipt against the line foreignAmount + currency', () => {
            const r = { id: 'usd', totalAmount: '29.39', issueDate: '2026-05-21T00:00:00.000Z', currency: 'USD' };
            expect(findCandidates(usdLine, [r]).exact.map((x) => x.id)).toEqual(['usd']);
        });

        it('does not match a USD receipt to a domestic line without foreignAmount', () => {
            const r = { totalAmount: 12980, issueDate: '2026-05-17T00:00:00.000Z', currency: 'USD' };
            expect(findCandidates(line, [r])).toEqual({ exact: [], amountOnly: [] });
        });

        it('does not match across different foreign currencies', () => {
            const r = { totalAmount: 29.39, issueDate: '2026-05-20T00:00:00.000Z', currency: 'EUR' };
            expect(findCandidates(usdLine, [r]).exact).toHaveLength(0);
        });

        it('does not match a JPY receipt whose number equals the foreign amount', () => {
            const r = { totalAmount: 29.39, issueDate: '2026-05-20T00:00:00.000Z', currency: null };
            expect(findCandidates(usdLine, [r]).exact).toHaveLength(0);
        });

        it('still matches JPY receipts on the line JPY amount even when the line is a foreign transaction', () => {
            const r = { id: 'jpy', totalAmount: 4844, issueDate: '2026-05-20T00:00:00.000Z', currency: null };
            expect(findCandidates(usdLine, [r]).exact.map((x) => x.id)).toEqual(['jpy']);
        });

        it('treats JPY currency codes as yen', () => {
            const r = { id: 'jpy2', totalAmount: 4844, issueDate: '2026-05-20T00:00:00.000Z', currency: 'jpy' };
            expect(findCandidates(usdLine, [r]).exact.map((x) => x.id)).toEqual(['jpy2']);
        });

        it('puts dateless USD receipts into the weak amountOnly group', () => {
            const r = { id: 'nd', totalAmount: 29.39, issueDate: null, currency: 'USD' };
            expect(findCandidates(usdLine, [r]).amountOnly.map((x) => x.id)).toEqual(['nd']);
        });
    });
});
