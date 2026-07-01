import { computePaymentSummary, paymentStatusLabel } from '@/lib/invoicePayments';

describe('computePaymentSummary（入金サマリ・パターンA＝未収の見える化）', () => {
    it('入金記録なし・status未指定 → 未入金で残額は請求額全額', () => {
        const s = computePaymentSummary(100000, []);
        expect(s.paymentStatus).toBe('unpaid');
        expect(s.remaining).toBe(100000);
        expect(s.paidAmount).toBe(0);
        expect(s.feeAmount).toBe(0);
        expect(s.settledAmount).toBe(0);
        expect(s.paymentCount).toBe(0);
        expect(s.legacyPaid).toBe(false);
    });

    it('入金記録なし・status=paid → 旧データ後方互換で入金済（残額0・legacyPaid=true）', () => {
        const s = computePaymentSummary(100000, [], 'paid');
        expect(s.paymentStatus).toBe('paid');
        expect(s.remaining).toBe(0);
        expect(s.legacyPaid).toBe(true);
        expect(s.paymentCount).toBe(0);
    });

    it('入金記録なし・status=sent → 未入金（legacyPaidにはしない）', () => {
        const s = computePaymentSummary(100000, [], 'sent');
        expect(s.paymentStatus).toBe('unpaid');
        expect(s.remaining).toBe(100000);
        expect(s.legacyPaid).toBe(false);
    });

    it('全額入金 → 入金済・残額0', () => {
        const s = computePaymentSummary(100000, [{ amount: 100000, fee: 0 }]);
        expect(s.paymentStatus).toBe('paid');
        expect(s.remaining).toBe(0);
        expect(s.paidAmount).toBe(100000);
        expect(s.paymentCount).toBe(1);
    });

    it('一部入金 → 一部入金・残額はそのぶん減る', () => {
        const s = computePaymentSummary(100000, [{ amount: 40000, fee: 0 }]);
        expect(s.paymentStatus).toBe('partial');
        expect(s.settledAmount).toBe(40000);
        expect(s.remaining).toBe(60000);
    });

    it('分割入金の合計で完済 → 入金済', () => {
        const s = computePaymentSummary(100000, [
            { amount: 40000, fee: 0 },
            { amount: 60000, fee: 0 },
        ]);
        expect(s.paymentStatus).toBe('paid');
        expect(s.remaining).toBe(0);
        expect(s.paidAmount).toBe(100000);
        expect(s.paymentCount).toBe(2);
    });

    it('振込手数料が当社負担 → 手数料分も残額へ充当（入金99,670＋手数料330で完済）', () => {
        const s = computePaymentSummary(100000, [{ amount: 99670, fee: 330 }]);
        expect(s.paidAmount).toBe(99670);
        expect(s.feeAmount).toBe(330);
        expect(s.settledAmount).toBe(100000);
        expect(s.remaining).toBe(0);
        expect(s.paymentStatus).toBe('paid');
    });

    it('過入金 → 残額は0にクランプ・入金済', () => {
        const s = computePaymentSummary(100000, [{ amount: 120000, fee: 0 }]);
        expect(s.remaining).toBe(0);
        expect(s.paymentStatus).toBe('paid');
        expect(s.paidAmount).toBe(120000);
    });

    it('手数料のみの相殺登録（入金0・手数料あり）→ 一部入金として残額に充当', () => {
        const s = computePaymentSummary(100000, [{ amount: 0, fee: 330 }]);
        expect(s.settledAmount).toBe(330);
        expect(s.remaining).toBe(99670);
        expect(s.paymentStatus).toBe('partial');
    });

    it('小数金額でも破綻せず残額を算出する', () => {
        const s = computePaymentSummary(100000.5, [{ amount: 100000.25, fee: 0.25 }]);
        expect(s.settledAmount).toBeCloseTo(100000.5, 2);
        expect(s.remaining).toBeCloseTo(0, 2);
        expect(s.paymentStatus).toBe('paid');
    });

    it('不正値（NaN）を渡してもクラッシュせず数値を返す', () => {
        const s = computePaymentSummary(Number('x'), [{ amount: Number('y'), fee: Number('z') }]);
        expect(Number.isNaN(s.remaining)).toBe(false);
        expect(Number.isNaN(s.paidAmount)).toBe(false);
        expect(Number.isNaN(s.settledAmount)).toBe(false);
    });
});

describe('paymentStatusLabel', () => {
    it('各ステータスの日本語ラベル', () => {
        expect(paymentStatusLabel('paid')).toBe('入金済');
        expect(paymentStatusLabel('partial')).toBe('一部入金');
        expect(paymentStatusLabel('unpaid')).toBe('未入金');
    });
});
