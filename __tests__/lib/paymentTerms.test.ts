import { suggestPaymentDateFromTerms, hasPaymentTerms } from '@/lib/paymentTerms';

describe('suggestPaymentDateFromTerms', () => {
    const eomNextEom = { closingDay: 31, paymentMonthOffset: 1, paymentDay: 31 }; // 月末締め翌月末払い
    const d20Next10 = { closingDay: 20, paymentMonthOffset: 1, paymentDay: 10 }; // 20日締め翌月10日払い

    it('月末締め翌月末払い', () => {
        expect(suggestPaymentDateFromTerms('2026-07-05', eomNextEom)).toBe('2026-08-31');
    });

    it('締め日を過ぎた発行日は翌月の締めに乗る', () => {
        expect(suggestPaymentDateFromTerms('2026-07-21', d20Next10)).toBe('2026-09-10');
    });

    it('締め日当日は当月締め', () => {
        expect(suggestPaymentDateFromTerms('2026-07-20', d20Next10)).toBe('2026-08-10');
    });

    it('支払日31は月末に丸める（2月・うるう年でない）', () => {
        expect(suggestPaymentDateFromTerms('2026-01-15', eomNextEom)).toBe('2026-02-28');
    });

    it('年またぎ', () => {
        expect(suggestPaymentDateFromTerms('2026-12-05', eomNextEom)).toBe('2027-01-31');
    });

    it('当月払い（offset 0）', () => {
        expect(suggestPaymentDateFromTerms('2026-07-05', { closingDay: 10, paymentMonthOffset: 0, paymentDay: 25 })).toBe('2026-07-25');
    });

    it('サイト未設定・発行日なしは null', () => {
        expect(suggestPaymentDateFromTerms('2026-07-05', { closingDay: 31, paymentMonthOffset: null, paymentDay: 31 })).toBeNull();
        expect(suggestPaymentDateFromTerms(null, eomNextEom)).toBeNull();
        expect(suggestPaymentDateFromTerms('', eomNextEom)).toBeNull();
        expect(suggestPaymentDateFromTerms('2026-07-05', null)).toBeNull();
    });
});

describe('hasPaymentTerms', () => {
    it('3つ揃って true（0 も有効値）', () => {
        expect(hasPaymentTerms({ closingDay: 31, paymentMonthOffset: 0, paymentDay: 31 })).toBe(true);
        expect(hasPaymentTerms({ closingDay: 31, paymentMonthOffset: null, paymentDay: 31 })).toBe(false);
        expect(hasPaymentTerms(null)).toBe(false);
    });
});
