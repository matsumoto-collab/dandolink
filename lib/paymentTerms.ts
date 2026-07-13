// 支払サイト（締め日・支払月・支払日）から支払日を計算する。
// Payee.closingDay / paymentMonthOffset / paymentDay を使い、請求書に支払期日が
// 書かれていない場合の支払日自動提案に使う（サーバー・クライアント共用の純関数）。

export interface PaymentTerms {
    closingDay: number | null; // 締め日（1-31。31=月末扱い）
    paymentMonthOffset: number | null; // 締め月から何ヶ月後に支払うか（0=当月, 1=翌月…）
    paymentDay: number | null; // 支払日（1-31。31=月末扱い）
}

// 3つ揃って初めてサイトとして成立する（型ガードで null を外す）
type CompleteTerms = { closingDay: number; paymentMonthOffset: number; paymentDay: number };
export const hasPaymentTerms = (t: Partial<PaymentTerms> | null | undefined): t is CompleteTerms =>
    t != null && t.closingDay != null && t.paymentMonthOffset != null && t.paymentDay != null;

// y年m月(1-12)の日数
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 発行日(YYYY-MM-DD)と支払サイトから支払日(YYYY-MM-DD)を計算する。
 * - 発行日が締め日以前 → その月の締め、締め日を過ぎていれば翌月の締めに乗る
 * - 支払日 = 締め月 + paymentMonthOffset ヶ月の paymentDay 日（月の日数を超える分は月末に丸める）
 * 例: 月末締め翌月末払い（31/1/31）で発行日 2026-07-05 → 2026-08-31
 * 入力が不正・サイト未設定なら null。
 */
export function suggestPaymentDateFromTerms(
    issueDate: string | null | undefined,
    terms: Partial<PaymentTerms> | null | undefined,
): string | null {
    if (!hasPaymentTerms(terms)) return null;
    if (!issueDate || !/^\d{4}-\d{2}-\d{2}/.test(issueDate)) return null;
    const y = Number(issueDate.slice(0, 4));
    const m = Number(issueDate.slice(5, 7));
    const d = Number(issueDate.slice(8, 10));
    if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;

    // 締め日（その月の日数に丸める）を過ぎていれば翌月の締めに乗る
    const closing = Math.min(terms.closingDay, daysInMonth(y, m));
    let months = y * 12 + (m - 1);
    if (d > closing) months += 1;

    months += terms.paymentMonthOffset;
    const py = Math.floor(months / 12);
    const pm = (months % 12) + 1;
    const pd = Math.min(terms.paymentDay, daysInMonth(py, pm));
    return `${py}-${pad(pm)}-${pad(pd)}`;
}
