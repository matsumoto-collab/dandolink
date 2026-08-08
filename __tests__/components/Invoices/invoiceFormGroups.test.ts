import { buildInitialGroups } from '@/components/Invoices/InvoiceForm';
import { InvoiceItem, InvoiceInput } from '@/types/invoice';

/**
 * 請求書編集フォームの明細グループ復元ロジック。
 * 案件に紐付かない手入力明細が代表案件へ吸収されないことを担保する。
 */
const item = (over: Partial<InvoiceItem> & { id: string }): InvoiceItem => ({
    description: '足場',
    quantity: 1,
    unitPrice: 1000,
    amount: 1000,
    taxType: 'standard',
    ...over,
});

const input = (over: Partial<InvoiceInput>): Partial<InvoiceInput> => over;

describe('buildInitialGroups', () => {
    it('案件付き明細と案件なし明細が混在する請求書: 案件なしは手入力セクションに復元される', () => {
        const result = buildInitialGroups(
            input({
                projectId: 'pm1',
                projectMasterIds: ['pm1'],
                items: [
                    item({ id: 'a', projectMasterId: 'pm1' }),
                    item({ id: 'b', projectMasterId: 'pm1' }),
                    item({ id: 'c', sectionTitle: '北福隆文様邸 仮設工事' }),
                ],
            }),
        );

        // 案件グループには案件付き明細だけ
        expect(result.itemsByProject['pm1'].map(i => i.id)).toEqual(['a', 'b']);
        // 手入力セクションが作られ、案件なし明細が入る
        expect(result.manualKeys).toEqual(['_none']);
        expect(result.itemsByProject['_none'].map(i => i.id)).toEqual(['c']);
        expect(result.itemsByProject['_none'][0].projectMasterId).toBe('_none');
        expect(result.sectionTitles['_none']).toBe('北福隆文様邸 仮設工事');
        // 案件グループの見出しは汚染されない
        expect(result.sectionTitles['pm1']).toBeUndefined();
    });

    it('案件なし明細が複数の見出しを持つ場合はセクションが分かれる', () => {
        const result = buildInitialGroups(
            input({
                projectId: 'pm1',
                items: [
                    item({ id: 'a', projectMasterId: 'pm1' }),
                    item({ id: 'b', sectionTitle: '仮設工事' }),
                    item({ id: 'c', sectionTitle: '追加工事' }),
                    item({ id: 'd', sectionTitle: '仮設工事' }),
                ],
            }),
        );

        expect(result.manualKeys).toEqual(['_none', '_none-1']);
        expect(result.itemsByProject['_none'].map(i => i.id)).toEqual(['b', 'd']);
        expect(result.itemsByProject['_none-1'].map(i => i.id)).toEqual(['c']);
        expect(result.sectionTitles['_none']).toBe('仮設工事');
        expect(result.sectionTitles['_none-1']).toBe('追加工事');
        expect(result.itemsByProject['pm1'].map(i => i.id)).toEqual(['a']);
    });

    it('レガシー請求書（全明細に案件IDなし）は従来どおり代表案件グループへ復元される', () => {
        const result = buildInitialGroups(
            input({
                projectId: 'pm1',
                items: [
                    item({ id: 'a' }),
                    item({ id: 'b', sectionTitle: '見出し' }),
                ],
            }),
        );

        expect(result.itemsByProject['pm1'].map(i => i.id)).toEqual(['a', 'b']);
        expect(result.manualKeys).toEqual([]);
        expect(result.sectionTitles['pm1']).toBe('見出し');
    });

    it('案件も明細も無い新規は手入力セクションを1つ用意する', () => {
        const result = buildInitialGroups(input({}));
        expect(result.manualKeys).toEqual(['_none']);
        expect(result.itemsByProject).toEqual({});
    });

    it('代表案件が未設定なら案件なし明細は常に手入力セクション', () => {
        const result = buildInitialGroups(
            input({ items: [item({ id: 'a', sectionTitle: 'その他' })] }),
        );
        expect(result.manualKeys).toEqual(['_none']);
        expect(result.itemsByProject['_none'].map(i => i.id)).toEqual(['a']);
    });
});
