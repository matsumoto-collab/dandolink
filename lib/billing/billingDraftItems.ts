/**
 * 請求予定（BillingDraft）の明細（InvoiceItem[] 相当）に関する小ユーティリティ。
 *
 * Phase 1: 明細合計（税別小計）の算出。
 * Phase 3 で「draft.items → Invoice 明細への展開」を別関数として追加予定。
 */

/**
 * 明細配列の金額合計（税別小計）。
 * 各要素の amount を数値化して合算する。値引き（マイナス amount）も許容。
 * amount が数値化できない要素は 0 とみなす。
 */
export function sumDraftItemAmounts(items: ReadonlyArray<unknown>): number {
    return items.reduce<number>((sum, it) => {
        const amount = Number((it as { amount?: unknown })?.amount);
        return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
}
