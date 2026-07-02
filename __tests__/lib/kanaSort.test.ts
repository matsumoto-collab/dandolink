import { kanaSortKey, payeeNameSortValue } from '@/lib/kanaSort';

const jaSort = (arr: string[]) => [...arr].sort((a, b) => a.localeCompare(b, 'ja'));

describe('kanaSortKey', () => {
    it('「カ）」の法人格を無視して実名で並ぶ（サイトウがマツモトより上）', () => {
        const a = kanaSortKey('カ）マツモトコウギョウ');
        const b = kanaSortKey('カ）サイトウコウギョウ');
        expect(a).toBe('マツモトコウギョウ');
        expect(b).toBe('サイトウコウギョウ');
        expect(jaSort([a, b])).toEqual(['サイトウコウギョウ', 'マツモトコウギョウ']);
    });

    it('片方だけに「カ）」が付いていても実名で比較する', () => {
        const a = kanaSortKey('カ）マツモト');
        const b = kanaSortKey('サイトウ');
        // サイトウ(サ) が マツモト(マ) より前
        expect(a.localeCompare(b, 'ja')).toBeGreaterThan(0);
    });

    it('ひらがなとカタカナを同じキーに正規化する', () => {
        expect(kanaSortKey('まつもと')).toBe(kanaSortKey('マツモト'));
        expect(kanaSortKey('まつもと')).toBe('マツモト');
    });

    it('半角カナ・全角括弧を正規化する', () => {
        expect(kanaSortKey('ｶ）ﾏﾂﾓﾄ')).toBe('マツモト');
        expect(kanaSortKey('カ)サイトウ')).toBe('サイトウ');
    });

    it('㈱ / (株) / 株式会社 や末尾の（カ を除去する', () => {
        expect(kanaSortKey('㈱開成工業')).toBe('開成工業');
        expect(kanaSortKey('(株)開成工業')).toBe('開成工業');
        expect(kanaSortKey('株式会社サイトウ')).toBe('サイトウ');
        expect(kanaSortKey('マツモトコウギョウ（カ')).toBe('マツモトコウギョウ');
        expect(kanaSortKey('マツモト（カ）')).toBe('マツモト');
    });

    it('空・null・undefined は空文字を返す', () => {
        expect(kanaSortKey(null)).toBe('');
        expect(kanaSortKey(undefined)).toBe('');
        expect(kanaSortKey('')).toBe('');
    });
});

describe('payeeNameSortValue', () => {
    it('口座名義→フリガナ→振込先名 の順で最初に値のあるものを使う', () => {
        expect(payeeNameSortValue({ accountHolder: 'カ）マツモト', nameKana: 'サイトウ', payeeName: '田中' })).toBe('マツモト');
        expect(payeeNameSortValue({ accountHolder: null, nameKana: 'カ）サイトウ', payeeName: '田中' })).toBe('サイトウ');
        expect(payeeNameSortValue({ accountHolder: '', nameKana: null, payeeName: 'タナカ' })).toBe('タナカ');
        expect(payeeNameSortValue({ accountHolder: null, nameKana: null, payeeName: null })).toBe('');
    });
});
