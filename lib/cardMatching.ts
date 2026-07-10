// クレカ明細行とレシート受け箱の照合候補を計算する純関数（クライアント側で使用・単体テスト対象）。
// Prisma Decimal は JSON で文字列になることがあるため、金額は必ず Number() を通して比較する。
// 小数（ドル等の外貨額）の同値判定は浮動小数の誤差を避けるためセント単位（×100の整数）で行う。

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MatchableLine {
    amount: number | string; // 円金額
    useDate: string | Date;
    foreignAmount?: number | string | null; // 海外利用時の外貨金額
    currency?: string | null; // 外貨の通貨コード（USD 等）
}

export interface MatchableReceipt {
    totalAmount: number | string | null;
    issueDate: string | Date | null;
    currency?: string | null; // null=円。'USD' 等ならその通貨の値
}

export interface MatchCandidates<R> {
    /** 金額完全一致 + 日付が ±windowDays 以内（強い候補） */
    exact: R[];
    /** 金額完全一致だが日付が読み取れていないレシート（弱い候補・第2グループ表示） */
    amountOnly: R[];
}

const cents = (v: number) => Math.round(v * 100);
const normCur = (v: string | null | undefined) => {
    const t = (v ?? '').toString().trim().toUpperCase();
    return t === '' || t === 'JPY' ? null : t;
};

/**
 * 明細行に対する照合候補を未紐付けレシートから探す。
 * - 円レシート（currency=null）は明細行の円金額（amount）と完全一致
 * - 外貨レシート（currency='USD' 等）は明細行の外貨金額（foreignAmount）＋通貨コードの一致で突き合わせる
 *   （換算レートが乗る円金額はレシート側からは予測できないため）
 * - 日付は UTC ms 差で ±windowDays 以内（両者とも UTC 0時保存のため日単位で比較できる）
 * - 日付があるが範囲外のレシートは候補に含めない
 * - 返金行（amount <= 0）・金額不明の行は照合対象外（空を返す）
 */
export function findCandidates<R extends MatchableReceipt>(
    line: MatchableLine,
    receipts: R[],
    windowDays = 3
): MatchCandidates<R> {
    const jpy = Number(line.amount);
    if (!Number.isFinite(jpy) || jpy <= 0) return { exact: [], amountOnly: [] };
    const fx = line.foreignAmount == null || line.foreignAmount === '' ? null : Number(line.foreignAmount);
    const lineCur = normCur(line.currency);
    const t = new Date(line.useDate).getTime();

    const exact: R[] = [];
    const amountOnly: R[] = [];
    for (const r of receipts) {
        if (r.totalAmount == null) continue;
        const rAmt = Number(r.totalAmount);
        if (!Number.isFinite(rAmt)) continue;
        const rCur = normCur(r.currency);
        const matched =
            rCur === null
                ? cents(rAmt) === cents(jpy)
                : fx != null && fx > 0 && rCur === lineCur && cents(rAmt) === cents(fx);
        if (!matched) continue;

        if (r.issueDate == null) {
            amountOnly.push(r);
            continue;
        }
        const rt = new Date(r.issueDate).getTime();
        if (Number.isFinite(t) && Number.isFinite(rt) && Math.abs(rt - t) <= windowDays * DAY_MS) {
            exact.push(r);
        }
    }
    return { exact, amountOnly };
}
