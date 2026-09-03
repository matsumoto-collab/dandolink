/**
 * @jest-environment node
 */
import {
    ORDER_BACKLOG_TAX_RATE,
    candidateExclusionReason,
    contractAmountFromBasis,
    receivedAmountForProject,
    type CandidateExclusionInput,
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

describe('candidateExclusionReason（候補から外す理由）', () => {
    const ASOF = '2026-09-04';
    const asg = (date: string, constructionType: string | null = null) => ({ date, constructionType });
    // 既定＝載せる案件（組立済み・解体は先の予定・見積あり・未請求・未入金）
    const base = (): CandidateExclusionInput => ({
        status: 'active',
        billingDecision: 'pending',
        basisAmount: 1000000,
        invoicedAmount: 0,
        contractAmount: 1100000,
        receivedAmount: 0,
        assignments: [asg('2026-08-20', '組立'), asg('2026-10-10', '解体')],
        asOf: ASOF,
    });

    it('受注済みで工事もお金も終わっていない案件は載せる', () => {
        expect(candidateExclusionReason(base())).toBeNull();
        // まだ着工していなくても、配置（予定）があれば受注残として載せる
        expect(candidateExclusionReason({ ...base(), assignments: [asg('2026-10-01', '組立'), asg('2026-11-01', '解体')] })).toBeNull();
        // 組立だけ済んで解体が未定でも載せる（足場が立ったまま）
        expect(candidateExclusionReason({ ...base(), assignments: [asg('2026-08-20', '組立')] })).toBeNull();
        // 一部入金でも載せる
        expect(candidateExclusionReason({ ...base(), receivedAmount: 500000 })).toBeNull();
    });

    it('配置が無い（見積だけの未着手案件）は載せない', () => {
        expect(candidateExclusionReason({ ...base(), assignments: [] })).toBe('no_assignment');
    });

    it('中止・完了ステータスは載せない', () => {
        expect(candidateExclusionReason({ ...base(), status: 'cancelled' })).toBe('status');
        expect(candidateExclusionReason({ ...base(), status: 'completed' })).toBe('status');
    });

    it('請求対象外の判断が付いた案件は載せない', () => {
        expect(candidateExclusionReason({ ...base(), billingDecision: 'excluded' })).toBe('billing_excluded');
        expect(candidateExclusionReason({ ...base(), billingDecision: 'hold' })).toBeNull();
        expect(candidateExclusionReason({ ...base(), billingDecision: null })).toBeNull();
    });

    it('全額請求済み・入金済みは載せない', () => {
        expect(candidateExclusionReason({ ...base(), invoicedAmount: 1000000 })).toBe('billed_full');
        expect(candidateExclusionReason({ ...base(), invoicedAmount: 999999 })).toBeNull();
        expect(candidateExclusionReason({ ...base(), receivedAmount: 1100000 })).toBe('fully_paid');
        // 契約額が 0 のときは入金済み判定をしない（0 ≧ 0 で全部弾かないように）
        expect(candidateExclusionReason({ ...base(), basisAmount: 0, contractAmount: 0, invoicedAmount: 1 })).toBe('billed_full');
    });

    it('工事が終わっている（解体済みで先の予定なし）は載せない', () => {
        expect(candidateExclusionReason({ ...base(), assignments: [asg('2026-07-01', '組立'), asg('2026-08-20', '解体')] })).toBe('work_finished');
        expect(candidateExclusionReason({ ...base(), assignments: [asg('2026-08-20', null)] })).toBe('work_finished');
    });

    it('契約額が決められない案件は載せない（終わった案件より後に判定＝件数に混ぜない）', () => {
        expect(candidateExclusionReason({ ...base(), basisAmount: null, contractAmount: 0 })).toBe('no_amount');
        expect(candidateExclusionReason({
            ...base(),
            basisAmount: null,
            contractAmount: 0,
            assignments: [asg('2026-07-01', '組立'), asg('2026-08-20', '解体')],
        })).toBe('work_finished');
    });
});
