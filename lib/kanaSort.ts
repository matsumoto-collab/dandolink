// 名義・氏名を「あいうえお順」に並べるための比較キーを作るユーティリティ。
// 「カ）」「(株)」「株式会社」などの法人格表記を無視し、ひらがな/カタカナ・全角/半角の差を吸収する。
// 例: 「カ）マツモトコウギョウ」→「マツモトコウギョウ」、「カ）サイトウコウギョウ」→「サイトウコウギョウ」
//   → localeCompare('ja') で サ < マ となり、サイトウが上に来る。

// 前後に付く法人格表記（漢字フル）
const CORP_WORDS =
    '(?:株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|社会福祉法人|特定非営利活動法人)';
// 括弧付きの法人格略号の中身（NFKC後: ㈱→(株)、㈲→(有) などになる）
const CORP_PAREN = '(?:株|有|名|資|同|医|福|社|財)';

const CORP_WORD_HEAD = new RegExp(`^${CORP_WORDS}`);
const CORP_WORD_TAIL = new RegExp(`${CORP_WORDS}$`);
const CORP_PAREN_HEAD = new RegExp(`^\\(${CORP_PAREN}\\)`); // 先頭 (株)(有) 等
const CORP_PAREN_TAIL = new RegExp(`\\(${CORP_PAREN}\\)$`); // 末尾 (株)(有) 等
const KANA_PAREN_HEAD = /^\(?[ァ-ヶ]{1,4}\)/; // 先頭 カ) (カ) ユ) 等（銀行振込名義の略号）
const KANA_PAREN_TAIL = /\([ァ-ヶ]{1,4}\)?$/; // 末尾 (カ (カ) 等

/**
 * あいうえお順の比較に使う正規化キーを返す。
 * - NFKC で半角カナ→全角・全角括弧→半角・㈱→(株) などを吸収
 * - ひらがな→カタカナに寄せて同じ読みを同列にする
 * - 空白と、前後の法人格表記（カ）/(株)/株式会社 等）を除去
 */
export const kanaSortKey = (raw?: string | null): string => {
    if (!raw) return '';
    let s = raw.normalize('NFKC');
    // ひらがな→カタカナ
    s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    // 空白除去
    s = s.replace(/[\s　]/g, '');
    // 法人格表記を前後から除去
    s = s
        .replace(CORP_WORD_HEAD, '')
        .replace(CORP_WORD_TAIL, '')
        .replace(CORP_PAREN_HEAD, '')
        .replace(CORP_PAREN_TAIL, '')
        .replace(KANA_PAREN_HEAD, '')
        .replace(KANA_PAREN_TAIL, '');
    return s;
};

/**
 * 支払予定などの「名義」ソート値。
 * 口座名義(カナ) → フリガナ → 振込先名 の順で、最初に値のあるものを採用する。
 */
export const payeeNameSortValue = (p: {
    accountHolder?: string | null;
    nameKana?: string | null;
    payeeName?: string | null;
}): string => kanaSortKey(p.accountHolder) || kanaSortKey(p.nameKana) || kanaSortKey(p.payeeName);
