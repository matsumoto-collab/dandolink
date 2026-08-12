/**
 * @jest-environment node
 */
import {
    computeInvoicedByProject,
    invoicedAmountForProject,
    getBillingStatus,
    resolveBillingBasis,
    type InvoiceForBillingSummary,
} from '@/lib/billing/billingStatus';

describe('computeInvoicedByProject', () => {
    it('sums item amounts (税抜) by projectMasterId', () => {
        const invoices: InvoiceForBillingSummary[] = [
            {
                status: 'draft',
                subtotal: 300000,
                projectMasterId: 'pm-1',
                items: [
                    { projectMasterId: 'pm-1', amount: 100000 },
                    { projectMasterId: 'pm-1', amount: 200000 },
                ],
            },
        ];
        expect(computeInvoicedByProject(invoices)).toEqual({ 'pm-1': 300000 });
    });

    it('splits a multi-project invoice across projects by item', () => {
        const invoices: InvoiceForBillingSummary[] = [
            {
                status: 'sent',
                subtotal: 500000,
                projectMasterId: 'pm-1',
                items: [
                    { projectMasterId: 'pm-1', amount: 100000 },
                    { projectMasterId: 'pm-2', amount: 400000 },
                ],
            },
        ];
        expect(computeInvoicedByProject(invoices)).toEqual({ 'pm-1': 100000, 'pm-2': 400000 });
    });

    it('accumulates across multiple invoices', () => {
        const invoices: InvoiceForBillingSummary[] = [
            { status: 'draft', subtotal: 100000, projectMasterId: 'pm-1', items: [{ projectMasterId: 'pm-1', amount: 100000 }] },
            { status: 'paid', subtotal: 50000, projectMasterId: 'pm-1', items: [{ projectMasterId: 'pm-1', amount: 50000 }] },
        ];
        expect(computeInvoicedByProject(invoices)).toEqual({ 'pm-1': 150000 });
    });

    it('excludes cancelled invoices', () => {
        const invoices: InvoiceForBillingSummary[] = [
            { status: 'cancelled', subtotal: 999999, projectMasterId: 'pm-1', items: [{ projectMasterId: 'pm-1', amount: 999999 }] },
            { status: 'sent', subtotal: 100000, projectMasterId: 'pm-1', items: [{ projectMasterId: 'pm-1', amount: 100000 }] },
        ];
        expect(computeInvoicedByProject(invoices)).toEqual({ 'pm-1': 100000 });
    });

    it('falls back to subtotal on top-level projectMasterId for untagged legacy invoices', () => {
        const invoices: InvoiceForBillingSummary[] = [
            {
                status: 'sent',
                subtotal: 250000,
                projectMasterId: 'pm-9',
                items: [{ amount: 250000 }], // projectMasterId なし（レガシー）
            },
        ];
        expect(computeInvoicedByProject(invoices)).toEqual({ 'pm-9': 250000 });
    });

    it('ignores untagged invoices with no top-level projectMasterId', () => {
        const invoices: InvoiceForBillingSummary[] = [
            { status: 'sent', subtotal: 100000, projectMasterId: null, items: [{ amount: 100000 }] },
        ];
        expect(computeInvoicedByProject(invoices)).toEqual({});
    });

    it('handles string amounts and empty input', () => {
        expect(computeInvoicedByProject([])).toEqual({});
        const invoices: InvoiceForBillingSummary[] = [
            { status: 'draft', subtotal: '100000', projectMasterId: 'pm-1', items: [{ projectMasterId: 'pm-1', amount: '100000' }] },
        ];
        expect(computeInvoicedByProject(invoices)).toEqual({ 'pm-1': 100000 });
    });
});

describe('invoicedAmountForProject', () => {
    it('returns this project portion from tagged items (not the whole invoice)', () => {
        const inv: InvoiceForBillingSummary = {
            status: 'sent',
            subtotal: 500000,
            projectMasterId: 'pm-1',
            items: [
                { projectMasterId: 'pm-1', amount: 100000 },
                { projectMasterId: 'pm-2', amount: 400000 },
            ],
        };
        expect(invoicedAmountForProject(inv, 'pm-1')).toBe(100000);
        expect(invoicedAmountForProject(inv, 'pm-2')).toBe(400000);
        expect(invoicedAmountForProject(inv, 'pm-x')).toBe(0);
    });

    it('falls back to subtotal for an untagged legacy invoice only on its top-level project', () => {
        const inv: InvoiceForBillingSummary = {
            status: 'sent', subtotal: 250000, projectMasterId: 'pm-9', items: [{ amount: 250000 }],
        };
        expect(invoicedAmountForProject(inv, 'pm-9')).toBe(250000);
        expect(invoicedAmountForProject(inv, 'pm-1')).toBe(0);
    });

    it('sums multiple tagged lines (incl. 値引きマイナス) and handles string amounts', () => {
        const inv: InvoiceForBillingSummary = {
            status: 'draft', subtotal: 0, projectMasterId: 'pm-1',
            items: [
                { projectMasterId: 'pm-1', amount: '126000' },
                { projectMasterId: 'pm-1', amount: -12000 },
                { projectMasterId: 'pm-2', amount: 5000 },
            ],
        };
        expect(invoicedAmountForProject(inv, 'pm-1')).toBe(114000); // 126000 - 12000
    });
});

describe('getBillingStatus', () => {
    it("returns 'none' when contractAmount is null/undefined", () => {
        expect(getBillingStatus(null, 0)).toBe('none');
        expect(getBillingStatus(undefined, 100000)).toBe('none');
    });

    it("returns 'unbilled' when invoiced is 0 or less", () => {
        expect(getBillingStatus(1000000, 0)).toBe('unbilled');
        expect(getBillingStatus(1000000, -5)).toBe('unbilled');
    });

    it("returns 'partial' when 0 < invoiced < contract", () => {
        expect(getBillingStatus(1000000, 1)).toBe('partial');
        expect(getBillingStatus(1000000, 999999)).toBe('partial');
    });

    it("returns 'full' when invoiced equals or exceeds contract", () => {
        expect(getBillingStatus(1000000, 1000000)).toBe('full');
        expect(getBillingStatus(1000000, 1200000)).toBe('full'); // 超過も full（§14.5）
    });

    it('handles a zero contract amount', () => {
        expect(getBillingStatus(0, 0)).toBe('unbilled');
        expect(getBillingStatus(0, 100)).toBe('full');
    });
});

describe('resolveBillingBasis', () => {
    const e = (id: string, subtotal: number) => ({ id, subtotal });

    it('sums the picked estimates (billingEstimateIds) with priority over contractAmount', () => {
        expect(
            resolveBillingBasis({
                contractAmount: 1000000,
                billingEstimateIds: ['e1', 'e3'],
                estimates: [e('e1', 300000), e('e2', 999999), e('e3', 200000)],
            }),
        ).toEqual({ amount: 500000, source: 'picked', needsEstimatePick: false });
    });

    it('ignores picked ids that no longer exist', () => {
        expect(
            resolveBillingBasis({
                billingEstimateIds: ['e1', 'deleted'],
                estimates: [e('e1', 300000)],
            }),
        ).toEqual({ amount: 300000, source: 'picked', needsEstimatePick: false });
    });

    it('falls back when every picked id is gone', () => {
        expect(
            resolveBillingBasis({
                contractAmount: 800000,
                billingEstimateIds: ['gone'],
                estimates: [e('e1', 100000), e('e2', 200000)],
            }),
        ).toEqual({ amount: 800000, source: 'contract', needsEstimatePick: false });
    });

    it('uses the only estimate when nothing is picked (単一見積は契約金額より優先)', () => {
        expect(
            resolveBillingBasis({ contractAmount: 1000000, estimates: [e('e1', 450000)] }),
        ).toEqual({ amount: 450000, source: 'single', needsEstimatePick: false });
    });

    it('uses contractAmount when there is no estimate', () => {
        expect(resolveBillingBasis({ contractAmount: 700000, estimates: [] })).toEqual({
            amount: 700000,
            source: 'contract',
            needsEstimatePick: false,
        });
    });

    it("returns null ('none') when neither contractAmount nor estimates exist", () => {
        expect(resolveBillingBasis({})).toEqual({ amount: null, source: 'none', needsEstimatePick: false });
    });

    it('flags needsEstimatePick when 複数見積で未選択・契約金額も無い', () => {
        expect(resolveBillingBasis({ estimates: [e('e1', 100000), e('e2', 200000)] })).toEqual({
            amount: null,
            source: 'none',
            needsEstimatePick: true,
        });
    });

    it('treats a non-array billingEstimateIds as 未選択', () => {
        expect(
            resolveBillingBasis({ billingEstimateIds: 'e1' as unknown, estimates: [e('e1', 100000)] }),
        ).toEqual({ amount: 100000, source: 'single', needsEstimatePick: false });
    });

    it('coerces string subtotals (Prisma Decimal 由来)', () => {
        expect(resolveBillingBasis({ estimates: [{ id: 'e1', subtotal: '250000' }] })).toEqual({
            amount: 250000,
            source: 'single',
            needsEstimatePick: false,
        });
    });

    it('ignores a 0円 single estimate and falls back to contractAmount（0円下書きで「済」にならない）', () => {
        const basis = resolveBillingBasis({ contractAmount: 1000000, estimates: [e('e1', 0)] });
        expect(basis).toEqual({ amount: 1000000, source: 'contract', needsEstimatePick: false });
        expect(getBillingStatus(basis.amount, 300000)).toBe('partial');
    });

    it("returns 'none' when the only estimate is 0円 and there is no contractAmount", () => {
        expect(resolveBillingBasis({ estimates: [e('e1', 0)] })).toEqual({
            amount: null,
            source: 'none',
            needsEstimatePick: false,
        });
    });

    it('ignores picked estimates whose total is 0（0円見積だけを選んだ場合）', () => {
        expect(
            resolveBillingBasis({
                contractAmount: 500000,
                billingEstimateIds: ['e1'],
                estimates: [e('e1', 0), e('e2', 300000)],
            }),
        ).toEqual({ amount: 500000, source: 'contract', needsEstimatePick: false });
    });

    it('dedupes duplicated ids in billingEstimateIds（二重合算しない）', () => {
        expect(
            resolveBillingBasis({
                billingEstimateIds: ['e1', 'e1', 'e2'],
                estimates: [e('e1', 300000), e('e2', 200000)],
            }),
        ).toEqual({ amount: 500000, source: 'picked', needsEstimatePick: false });
    });

    it('drives getBillingStatus with the estimate-based denominator', () => {
        const basis = resolveBillingBasis({ estimates: [e('e1', 500000)] });
        expect(getBillingStatus(basis.amount, 0)).toBe('unbilled');
        expect(getBillingStatus(basis.amount, 200000)).toBe('partial');
        expect(getBillingStatus(basis.amount, 500000)).toBe('full');
    });
});
