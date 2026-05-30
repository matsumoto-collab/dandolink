/**
 * 案件一覧「請求」列の 3 段階表示（Phase 4、§14.2 / §14.5）用ロジック。
 *
 * 重要（税抜で比較する理由）:
 * - `ProjectMaster.contractAmount` は **税抜**（types/calendar.ts:152）。
 * - 請求済み合計は Invoice 明細（items）の `amount`（**税抜**・行単位）を `projectMasterId` で
 *   合算する（§14.2）。請求書全体の `Invoice.total`（税込）を使うと税分ずれて閾値判定が誤るため使わない。
 * - 複数案件まとめ請求でも明細の `projectMasterId` で正しく按分される
 *   （billing-context API の totalInvoicedAmount は inv.total を案件ごとに重複加算する粗い集計で、
 *   こちらは明細按分なので別物）。
 */

export type BillingStatus = 'none' | 'unbilled' | 'partial' | 'full';

/** computeInvoicedByProject が受け取る最小 Invoice 形状（クライアント store / DB どちらでも可）。 */
export interface InvoiceForBillingSummary {
    status: string;
    /** 税抜小計（レガシー無タグ明細のフォールバック用） */
    subtotal: number | string;
    items: Array<{ projectMasterId?: string | null; amount?: number | string | null }>;
    /** 代表案件（top-level）。明細に projectMasterId タグが無い場合のフォールバック先 */
    projectMasterId?: string | null;
}

function toNum(v: unknown): number {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * 発行済み Invoice 群から、案件ごとの「請求済み合計（税抜）」を集計する。
 *
 * - cancelled の Invoice は除外（§14.5）
 * - 明細（items）の `projectMasterId` 単位で `amount`（税抜）を合算（§14.2）
 * - 明細に `projectMasterId` タグが 1 つも無いレガシー Invoice は、代表案件（`projectMasterId`）に
 *   `subtotal`（税抜）を加算するフォールバック（本番に無タグ Invoice が 1 件存在）
 *
 * @returns `{ [projectMasterId]: 税抜合計 }`。請求のない案件はキーに現れない（呼び出し側で `?? 0`）。
 */
export function computeInvoicedByProject(
    invoices: InvoiceForBillingSummary[],
): Record<string, number> {
    const map: Record<string, number> = {};
    for (const inv of invoices) {
        if (inv.status === 'cancelled') continue;
        const items = inv.items ?? [];
        const tagged = items.filter((it) => it.projectMasterId);
        if (tagged.length > 0) {
            for (const it of tagged) {
                const pid = it.projectMasterId as string;
                map[pid] = (map[pid] ?? 0) + toNum(it.amount);
            }
        } else if (inv.projectMasterId) {
            // レガシー無タグ Invoice：代表案件に税抜小計を加算
            map[inv.projectMasterId] = (map[inv.projectMasterId] ?? 0) + toNum(inv.subtotal);
        }
    }
    return map;
}

/**
 * 1 つの Invoice について、指定案件ぶんの請求額（税抜）を返す。
 *
 * - 明細（items）に `projectMasterId` タグがあれば、その案件に一致する明細 `amount`（税抜）の合計
 * - タグが 1 つも無いレガシー Invoice は、代表案件（`projectMasterId`）に一致するときだけ `subtotal` を計上
 *
 * 請求書全体の `total`（税込・全案件）ではなく **この案件ぶけ** を返すのが要点
 * （複数案件まとめ請求でも案件単位で正しく按分される）。cancelled 判定は呼び出し側で行う。
 */
export function invoicedAmountForProject(
    inv: InvoiceForBillingSummary,
    projectMasterId: string,
): number {
    const items = inv.items ?? [];
    const hasTags = items.some((it) => it.projectMasterId);
    if (hasTags) {
        return items
            .filter((it) => it.projectMasterId === projectMasterId)
            .reduce((sum, it) => sum + toNum(it.amount), 0);
    }
    return inv.projectMasterId === projectMasterId ? toNum(inv.subtotal) : 0;
}

/**
 * 契約金額（税抜）と請求済み合計（税抜）から請求ステータスを判定する（§14.2 / §14.5）。
 *
 * - `contractAmount` 未設定（null/undefined）→ `'none'`（「—」表示）
 * - 請求済み 0 以下 → `'unbilled'`（未請求）
 * - 請求済み ≧ 契約 → `'full'`（全額請求済、超過も full）
 * - それ以外（0 < 請求済み < 契約）→ `'partial'`（一部請求済）
 */
export function getBillingStatus(
    contractAmount: number | null | undefined,
    invoicedAmount: number,
): BillingStatus {
    if (contractAmount == null) return 'none';
    if (invoicedAmount <= 0) return 'unbilled';
    if (invoicedAmount >= contractAmount) return 'full';
    return 'partial';
}
