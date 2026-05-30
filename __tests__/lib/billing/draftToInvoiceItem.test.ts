/**
 * @jest-environment node
 */
import { billingDraftToInvoiceItem, billingDraftToInvoiceItems } from '@/lib/billing/draftToInvoiceItem';

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

describe('billingDraftToInvoiceItems (複数明細)', () => {
    it('expands items and tags each with projectMasterId + sectionTitle(=見出し)', () => {
        const result = billingDraftToInvoiceItems({
            id: 'bd-2',
            title: '宮崎様邸 仮設工事',
            amount: '135000',
            taxRate: '0.10',
            projectId: 'pm-1',
            note: null,
            items: [
                { id: 'i1', description: '外部足場組立・解体', quantity: 210, unit: '㎡', unitPrice: 600, amount: 126000, taxType: 'standard' },
                { id: 'i2', description: '値引き', quantity: -1, unit: '', unitPrice: 12000, amount: -12000, taxType: 'standard' },
            ],
        });
        expect(result).toHaveLength(2);
        expect(result.every((it) => it.projectMasterId === 'pm-1')).toBe(true);
        expect(result.every((it) => it.sectionTitle === '宮崎様邸 仮設工事')).toBe(true);
        expect(result[1].amount).toBe(-12000); // 値引きはマイナスのまま展開
    });

    it('falls back to a single 一式 line when items is empty (旧モデル・見出しは未設定)', () => {
        const result = billingDraftToInvoiceItems({
            id: 'bd-3',
            title: '○○邸 着手金',
            amount: '100000',
            taxRate: '0.10',
            projectId: 'pm-9',
            note: null,
            items: [],
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ description: '○○邸 着手金', quantity: 1, unit: '式', amount: 100000, projectMasterId: 'pm-9' });
        expect(result[0].sectionTitle).toBeUndefined();
    });

    it('falls back to a single line when items is undefined', () => {
        const result = billingDraftToInvoiceItems({
            id: 'bd-4', title: 'x', amount: '5000', taxRate: '0', projectId: 'pm-1', note: null,
        });
        expect(result).toHaveLength(1);
        expect(result[0].taxType).toBe('none');
    });
});
