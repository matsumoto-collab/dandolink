/**
 * @jest-environment node
 */
import { billingDraftToInvoiceItem } from '@/lib/billing/draftToInvoiceItem';

describe('billingDraftToInvoiceItem', () => {
    const base = {
        id: 'bd-1',
        title: '○○邸 着手金',
        amount: '100000',
        taxRate: '0.10',
        projectId: 'pm-1',
        note: '初回' as string | null,
    };

    it('maps a 10% draft to a standard taxable item', () => {
        const item = billingDraftToInvoiceItem(base);
        expect(item).toEqual({
            id: 'bd-1',
            description: '○○邸 着手金',
            quantity: 1,
            unit: '式',
            unitPrice: 100000,
            amount: 100000,
            taxType: 'standard',
            notes: '初回',
            projectMasterId: 'pm-1',
        });
    });

    it('maps taxRate=0 to a non-taxable item (none)', () => {
        const item = billingDraftToInvoiceItem({ ...base, taxRate: '0' });
        expect(item.taxType).toBe('none');
    });

    it('treats taxRate as standard only when > 0 (number input)', () => {
        expect(billingDraftToInvoiceItem({ ...base, taxRate: 0.1 }).taxType).toBe('standard');
        expect(billingDraftToInvoiceItem({ ...base, taxRate: 0 }).taxType).toBe('none');
    });

    it('treats null amount as 0 (unitPrice/amount = 0)', () => {
        const item = billingDraftToInvoiceItem({ ...base, amount: null });
        expect(item.unitPrice).toBe(0);
        expect(item.amount).toBe(0);
    });

    it('falls back to 0 for non-finite amount', () => {
        const item = billingDraftToInvoiceItem({ ...base, amount: 'not-a-number' });
        expect(item.amount).toBe(0);
    });

    it('sets notes to undefined when note is null/undefined', () => {
        expect(billingDraftToInvoiceItem({ ...base, note: null }).notes).toBeUndefined();
        expect(billingDraftToInvoiceItem({ ...base, note: undefined }).notes).toBeUndefined();
    });

    it('never sets sectionTitle (heading falls back to project master name)', () => {
        const item = billingDraftToInvoiceItem(base);
        expect(item.sectionTitle).toBeUndefined();
        expect('sectionTitle' in item).toBe(false);
    });

    it('uses projectId as projectMasterId for grouping', () => {
        expect(billingDraftToInvoiceItem({ ...base, projectId: 'pm-99' }).projectMasterId).toBe('pm-99');
    });
});
