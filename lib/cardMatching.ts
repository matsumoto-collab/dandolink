// クレカ明細行とレシート受け箱の照合候補を計算する純関数（クライアント側で使用・単体テスト対象）。
// Prisma Decimal は JSON で文字列になることがあるため、金額は必ず Number() を通して比較する。

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MatchableLine {
    amount: number | string;
    useDate: string | Date;
}

export interface MatchableReceipt {
    totalAmount: number | string | null;
    issueDate: string | Date | null;
}

export interface MatchCandidates<R> {
    /** 金額完全一致 + 日付が ±windowDays 以内（強い候補） */
    exact: R[];
    /** 金額完全一致だが日付が読み取れていないレシート（弱い候補・第2グループ表示） */
    amountOnly: R[];
}

/**
 * 明細行に対する照合候補を未紐付けレシートから探す。
 * - 金額は完全一致のみ（カード明細の円金額とレシートの税込合計）
 * - 日付は UTC ms 差で ±windowDays 以内（両者とも UTC 0時保存のため日単位で比較できる）
 * - 日付があるが範囲外のレシートは候補に含めない
 * - 返金行（amount <= 0）・金額不明の行は照合対象外（空を返す）
 */
export function findCandidates<R extends MatchableReceipt>(
    line: MatchableLine,
    receipts: R[],
    windowDays = 3
): MatchCandidates<R> {
    const amt = Number(line.amount);
    if (!Number.isFinite(amt) || amt <= 0) return { exact: [], amountOnly: [] };
    const t = new Date(line.useDate).getTime();

    const exact: R[] = [];
    const amountOnly: R[] = [];
    for (const r of receipts) {
        if (r.totalAmount == null || Number(r.totalAmount) !== amt) continue;
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
