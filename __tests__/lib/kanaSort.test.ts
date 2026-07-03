import { kanaSortKey, payeeNameSortValue } from '@/lib/kanaSort';

const jaSort = (arr: string[]) => [...arr].sort((a, b) => kanaSortKey(a).localeCompare(kanaSortKey(b), 'ja'));

describe('kanaSortKey', () => {
    it('「カ）アームズ」はカ行に並ぶ（法人格を除去せず、書かれた文字どおりに比較）', () => {
        // ア行の会社より後・サ行の会社より前＝カ行の位置
        expect(jaSort(['カ）アームズ', 'イロハコウギョウ', 'サトウケンセツ'])).toEqual([
            'イロハコウギョウ',
            'カ）アームズ',
            'サトウケンセツ',
        ]);
    });

    it('「ユ）エスケーアール」はヤ行に並ぶ', () => {
        expect(jaSort(['ヨシダグミ', 'ユ）エスケーアール', 'ヤマダケンセツ'])).toEqual([
            'ヤマダケンセツ',
            'ユ）エスケーアール',
            'ヨシダグミ',
        ]);
    });

    it('カ）同士は実名部分で決まる（アームズ < アルファシード）', () => {
        expect(jaSort(['カ）アルファシード', 'カ）アームズ'])).toEqual(['カ）アームズ', 'カ）アルファシード']);
    });

    it('カ）マツモトとカ）サイトウは共通接頭辞が相殺されサイトウが上（当初要望の維持）', () => {
        expect(jaSort(['カ）マツモトコウギョウ', 'カ）サイトウコウギョウ'])).toEqual([
            'カ）サイトウコウギョウ',
            'カ）マツモトコウギョウ',
        ]);
    });

    it('ひらがなとカタカナを同じキーに正規化する', () => {
        expect(kanaSortKey('まつもと')).toBe(kanaSortKey('マツモト'));
        expect(kanaSortKey('まつもと')).toBe('マツモト');
    });

    it('半角カナ・全角括弧を正規化する（同じ名義は同じキーになる）', () => {
        expect(kanaSortKey('ｶ）ﾏﾂﾓﾄ')).toBe(kanaSortKey('カ）マツモト'));
        expect(kanaSortKey('カ)サイトウ')).toBe(kanaSortKey('カ）サイトウ'));
    });

    it('空白は無視する', () => {
        expect(kanaSortKey('カ） マツモト')).toBe(kanaSortKey('カ）マツモト'));
    });

    it('空・null・undefined は空文字を返す', () => {
        expect(kanaSortKey(null)).toBe('');
        expect(kanaSortKey(undefined)).toBe('');
        expect(kanaSortKey('')).toBe('');
    });
});

describe('payeeNameSortValue', () => {
    it('口座名義→フリガナ→振込先名 の順で最初に値のあるものを使う', () => {
        // 全角「）」はNFKC正規化で半角「)」になる
        expect(payeeNameSortValue({ accountHolder: 'カ）マツモト', nameKana: 'サイトウ', payeeName: '田中' })).toBe('カ)マツモト');
        expect(payeeNameSortValue({ accountHolder: null, nameKana: 'カ）サイトウ', payeeName: '田中' })).toBe('カ)サイトウ');
        expect(payeeNameSortValue({ accountHolder: '', nameKana: null, payeeName: 'タナカ' })).toBe('タナカ');
        expect(payeeNameSortValue({ accountHolder: null, nameKana: null, payeeName: null })).toBe('');
    });
});
