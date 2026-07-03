// 名義・氏名を「あいうえお順」に並べるための比較キーを作るユーティリティ。
// 名義は書かれた文字どおりに比較する（「カ）」「ユ）」等の法人格も名前の一部として扱う）。
//   例: 「カ）アームズ」は カ行（カ）アルファシード等と並ぶ）、「ユ）エスケーアール」は ヤ行。
//   「カ）マツモトコウギョウ」と「カ）サイトウコウギョウ」は共通の「カ）」が相殺され、
//   実名部分の比較（サ < マ）でサイトウが上に来る。
// ひらがな/カタカナ・全角/半角の表記ゆれだけを吸収する。

/**
 * あいうえお順の比較に使う正規化キーを返す。
 * - NFKC で半角カナ→全角・全角括弧→半角などを吸収
 * - ひらがな→カタカナに寄せて同じ読みを同列にする
 * - 空白を除去
 * 法人格（カ）/(株)/株式会社 等）は除去しない＝見たままの並び。比較は localeCompare('ja')。
 */
export const kanaSortKey = (raw?: string | null): string => {
    if (!raw) return '';
    let s = raw.normalize('NFKC');
    // ひらがな→カタカナ
    s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    // 空白除去
    s = s.replace(/[\s　]/g, '');
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
