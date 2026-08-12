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

/** 判定の分母（基準額）がどこから来たか。 */
export type BillingBasisSource = 'picked' | 'single' | 'contract' | 'none';

/** resolveBillingBasis が受け取る見積の最小形状（税抜 subtotal）。 */
export interface EstimateForBillingBasis {
    id: string;
    subtotal: number | string | null | undefined;
}

export interface BillingBasisResolution {
    /** 判定の分母（税抜）。決められないときは null（＝'none' 表示）。 */
    amount: number | null;
    source: BillingBasisSource;
    /** 見積が複数あるのにどれを基準にするか未選択で、金額が決められない状態。 */
    needsEstimatePick: boolean;
}

/**
 * 請求ステータス判定の分母（基準額・税抜）を解決する。
 *
 * `ProjectMaster.contractAmount` はほぼ全案件で未入力のため、見積金額にフォールバックする。
 * 優先順は請求待ちボード（GET /api/billing-board）と同一で、そちらもこの関数を使う：
 *
 *   a. `billingEstimateIds`（基準にする見積として選んだID配列）が非空 → その見積の subtotal 合算（'picked'）。
 *      削除済みID・重複IDは無視し、合計が 0 以下なら分母にならないので b 以降へ。
 *   b. 見積がちょうど1件で subtotal > 0 → その subtotal（'single'）。※contractAmount より優先する。
 *      0円の下書き見積などは分母にせず c へ（0円を分母にすると常に「請求済」になってしまう）。
 *   c. それ以外 → contractAmount（'contract'。無ければ null＝'none'）。
 *      見積が複数あって contractAmount も無い場合は needsEstimatePick=true。
 *
 * 金額のスナップショットは持たず常に見積書の現在値から計算する＝見積を直せば判定も追従する。
 */
export function resolveBillingBasis(params: {
    contractAmount?: number | null;
    /** ProjectMaster.billingEstimateIds（Json。string[] を想定・それ以外は未選択扱い）。 */
    billingEstimateIds?: unknown;
    /** その案件に紐づく見積（全件）。 */
    estimates?: EstimateForBillingBasis[];
}): BillingBasisResolution {
    const contract = params.contractAmount ?? null;
    const estimates = params.estimates ?? [];

    // 同一IDが重複していても二重に合算しない
    const pickedIds = Array.isArray(params.billingEstimateIds)
        ? Array.from(
              new Set((params.billingEstimateIds as unknown[]).filter((v): v is string => typeof v === 'string')),
          )
        : [];

    if (pickedIds.length > 0) {
        let sum = 0;
        for (const id of pickedIds) {
            const e = estimates.find((x) => x.id === id);
            if (!e) continue; // 削除された見積は無視
            sum += toNum(e.subtotal);
        }
        // 合計0（0円の下書きだけを選んでいる等）は分母にできないのでフォールバックする
        if (sum > 0) return { amount: sum, source: 'picked', needsEstimatePick: false };
    }

    if (estimates.length === 1 && toNum(estimates[0].subtotal) > 0) {
        return { amount: toNum(estimates[0].subtotal), source: 'single', needsEstimatePick: false };
    }

    if (contract != null) return { amount: contract, source: 'contract', needsEstimatePick: false };

    return { amount: null, source: 'none', needsEstimatePick: estimates.length > 1 };
}
