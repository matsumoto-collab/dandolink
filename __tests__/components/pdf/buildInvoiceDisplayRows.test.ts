/**
 * 明細見出し（sectionTitle ローカル上書き）の中核ロジック検証。
 * 依頼の動作確認5ケースに対応する。
 */

// InvoicePDF は @react-pdf/renderer に依存するため、import 副作用を無効化する
jest.mock('@react-pdf/renderer', () => ({
    Document: () => null,
    Page: () => null,
    Text: () => null,
    View: () => null,
    StyleSheet: { create: (s: unknown) => s },
    Font: { register: jest.fn() },
    Image: () => null,
}));

import { buildInvoiceDisplayRows } from '@/components/pdf/InvoicePDF';
import type { InvoiceItem } from '@/types/invoice';

function item(partial: Partial<InvoiceItem>): InvoiceItem {
    return {
        id: partial.id ?? Math.random().toString(36).slice(2),
        description: partial.description ?? '項目',
        specification: '',
        quantity: 1,
        unit: '式',
        unitPrice: 1000,
        amount: 1000,
        taxType: 'standard',
        notes: '',
        ...partial,
    } as InvoiceItem;
}

const headerTitles = (rows: ReturnType<typeof buildInvoiceDisplayRows>) =>
    rows.filter(r => r.type === 'header').map(r => (r as { title: string }).title);

describe('buildInvoiceDisplayRows', () => {
    // ケース5: 既存（機能追加前）の請求書 = sectionTitle 無し → 従来どおり案件名見出し
    it('既存挙動: sectionTitle 無し・案件あり → 案件マスタ名で見出し（表示崩れなし）', () => {
        const items = [
            item({ description: '足場', projectMasterId: 'pm1' }),
            item({ description: '養生', projectMasterId: 'pm1' }),
        ];
        const rows = buildInvoiceDisplayRows(items, [{ id: 'pm1', title: 'A様邸 仮設工事' }]);
        expect(headerTitles(rows)).toEqual(['【A様邸 仮設工事】']);
        expect(rows.filter(r => r.type === 'item')).toHaveLength(2);
    });

    // ケース5(legacy): 案件マスタ情報なし・sectionTitle 無し → 見出しなし（従来の else 分岐と同一）
    it('既存挙動: projectMasters 無し・sectionTitle 無し → 見出し行なし', () => {
        const items = [item({ description: 'X' }), item({ description: 'Y' })];
        const rows = buildInvoiceDisplayRows(items, []);
        expect(headerTitles(rows)).toEqual([]);
        expect(rows.filter(r => r.type === 'item')).toHaveLength(2);
    });

    // ケース2: 案件あり + sectionTitle で上書き → 上書き名が見出しに（案件マスタ名は使わない）
    it('案件あり + sectionTitle 上書き → 上書き値を見出しに使う', () => {
        const items = [
            item({ description: '足場', projectMasterId: 'pm1', sectionTitle: '○月分 請求' }),
            item({ description: '養生', projectMasterId: 'pm1', sectionTitle: '○月分 請求' }),
        ];
        const rows = buildInvoiceDisplayRows(items, [{ id: 'pm1', title: 'A様邸 仮設工事' }]);
        expect(headerTitles(rows)).toEqual(['【○月分 請求】']);
    });

    // ケース1: 案件なし + sectionTitle → 案件なしでも見出しが出る
    it('案件なし + sectionTitle → 見出しが表示される', () => {
        const items = [
            item({ description: '材料費', sectionTitle: '雑工事一式' }),
            item({ description: '運搬費', sectionTitle: '雑工事一式' }),
        ];
        const rows = buildInvoiceDisplayRows(items, []);
        expect(headerTitles(rows)).toEqual(['【雑工事一式】']);
        expect(rows.filter(r => r.type === 'item')).toHaveLength(2);
    });

    // ケース4: 同じ案件を使う別請求書に上書きの影響が出ない（=入力 items にしか依存しない純粋関数）
    it('上書きは渡された items にのみ依存し、他へ波及しない', () => {
        const base = [item({ description: '足場', projectMasterId: 'pm1' })];
        const overridden = [item({ description: '足場', projectMasterId: 'pm1', sectionTitle: '特別名称' })];
        expect(headerTitles(buildInvoiceDisplayRows(base, [{ id: 'pm1', title: 'マスタ名' }]))).toEqual(['【マスタ名】']);
        expect(headerTitles(buildInvoiceDisplayRows(overridden, [{ id: 'pm1', title: 'マスタ名' }]))).toEqual(['【特別名称】']);
    });

    it('空文字の sectionTitle は上書き扱いせず案件マスタ名へフォールバック', () => {
        const items = [item({ description: '足場', projectMasterId: 'pm1', sectionTitle: '   ' })];
        const rows = buildInvoiceDisplayRows(items, [{ id: 'pm1', title: 'マスタ名' }]);
        expect(headerTitles(rows)).toEqual(['【マスタ名】']);
    });

    it('複数案件: 各グループの見出し＋通し番号が維持される', () => {
        const items = [
            item({ description: 'a', projectMasterId: 'pm1' }),
            item({ description: 'b', projectMasterId: 'pm2', sectionTitle: 'PM2上書き' }),
        ];
        const rows = buildInvoiceDisplayRows(items, [
            { id: 'pm1', title: '案件1' },
            { id: 'pm2', title: '案件2' },
        ]);
        expect(headerTitles(rows)).toEqual(['【案件1】', '【PM2上書き】']);
        const itemRows = rows.filter(r => r.type === 'item') as Array<{ index: number }>;
        expect(itemRows.map(r => r.index)).toEqual([1, 2]);
    });
});
