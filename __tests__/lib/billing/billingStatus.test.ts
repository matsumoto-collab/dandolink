/**
 * @jest-environment node
 */
import {
    computeInvoicedByProject,
    getBillingStatus,
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
