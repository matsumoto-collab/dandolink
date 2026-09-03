/**
 * @jest-environment node
 */
import {
    ORDER_BACKLOG_TAX_RATE,
    contractAmountFromBasis,
    receivedAmountForProject,
    type InvoiceWithPayments,
} from '@/lib/orderBacklog/candidates';

describe('contractAmountFromBasis（契約額の税込/税抜）', () => {
    it('税込は基準額（税抜）に消費税を乗せて四捨五入する', () => {
        expect(contractAmountFromBasis(1_000_000, 'inclusive')).toBe(1_100_000);
        // 端数（1円未満）は四捨五入
        expect(contractAmountFromBasis(123_455, 'inclusive')).toBe(Math.round(123_455 * (1 + ORDER_BACKLOG_TAX_RATE)));
    });

    it('税抜はそのまま（整数に丸めるだけ）', () => {
        expect(contractAmountFromBasis(1_000_000, 'exclusive')).toBe(1_000_000);
        expect(contractAmountFromBasis(999_999.6, 'exclusive')).toBe(1_000_000);
    });

    it('基準額が決められない案件は 0（画面で手入力する）', () => {
        expect(contractAmountFromBasis(null, 'inclusive')).toBe(0);
        expect(contractAmountFromBasis(null, 'exclusive')).toBe(0);
    });
});

describe('receivedAmountForProject（既受領の按分）', () => {
    const invoice = (over: Partial<InvoiceWithPayments>): InvoiceWithPayments => ({
        id: 'inv-1',
        status: 'sent',
        subtotal: 1_000_000,
        items: [{ projectMasterId: 'pm-1', amount: 1_000_000 }],
        projectMasterId: 'pm-1',
        payments: [],
        ...over,
    });

    it('単独請求は入金額（振込手数料込み）をそのまま計上する', () => {
        const invoices = [invoice({ payments: [{ amount: 1_099_450, fee: 550 }] })];
        expect(receivedAmountForProject(invoices, 'pm-1')).toBe(1_100_000);
    });

    it('まとめ請求は案件別の請求額の比で按分する', () => {
        const invoices = [
            invoice({
                subtotal: 1_000_000,
                items: [
                    { projectMasterId: 'pm-1', amount: 300_000 },
                    { projectMasterId: 'pm-2', amount: 700_000 },
                ],
                payments: [{ amount: 1_100_000, fee: 0 }],
            }),
        ];
        expect(receivedAmountForProject(invoices, 'pm-1')).toBe(330_000);
        expect(receivedAmountForProject(invoices, 'pm-2')).toBe(770_000);
    });

    it('取消（cancelled）の請求書の入金は数えない', () => {
        const invoices = [invoice({ status: 'cancelled', payments: [{ amount: 1_100_000, fee: 0 }] })];
        expect(receivedAmountForProject(invoices, 'pm-1')).toBe(0);
    });

    it('小計 0（按分できない）請求書は数えない', () => {
        const invoices = [invoice({ subtotal: 0, items: [], payments: [{ amount: 100_000, fee: 0 }] })];
        expect(receivedAmountForProject(invoices, 'pm-1')).toBe(0);
    });

    it('明細に案件タグが無い請求書は代表案件にだけ計上する（レガシー請求書）', () => {
        const invoices = [
            invoice({ items: [{ amount: 1_000_000 }], projectMasterId: 'pm-1', payments: [{ amount: 500_000, fee: 0 }] }),
        ];
        expect(receivedAmountForProject(invoices, 'pm-1')).toBe(500_000);
        expect(receivedAmountForProject(invoices, 'pm-2')).toBe(0);
    });

    it('入金が無ければ 0', () => {
        expect(receivedAmountForProject([invoice({})], 'pm-1')).toBe(0);
    });
});
