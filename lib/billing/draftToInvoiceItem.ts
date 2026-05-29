import type { Prisma } from '@prisma/client';
import type { InvoiceItem } from '@/types/invoice';

/**
 * BillingDraft → InvoiceItem 変換（Phase 3・rev.9 / 工事種別なし版）。
 *
 * 設計根拠（invoice_plan.md §17.27.2）:
 * - `description` に請求予定のタイトル（「○○邸 着手金」等）を入れる。
 * - `projectMasterId` で案件ごとにグルーピングされ、請求書 PDF の見出しは
 *   案件マスタ名（`pm.title`）にフォールバックする（`buildInvoiceDisplayRows`、
 *   `components/pdf/InvoicePDF.tsx`）。よって **`sectionTitle` は設定しない**。
 *   ※ §12.4 旧案の `sectionTitle: ct.name`（工事種別名）は rev.9 で全廃（§14.7）。
 * - 税区分は既存 Invoice の 2 値モデルに正規化：`taxRate > 0` → `'standard'`（10%）/
 *   `=0` → `'none'`（非課税）。8% 軽減税率は扱わない（D-d 確定）。
 *
 * amount / taxRate は Prisma の Decimal（サーバー）・JSON 経由の string（クライアント）の
 * どちらでも受けられるよう緩く型付けし、`Number(...)` で安全に数値化する。
 */
type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export interface BillingDraftForInvoiceItem {
    id: string;
    title: string;
    amount: DecimalLike;
    taxRate: DecimalLike;
    projectId: string;
    note?: string | null;
}

/** Decimal / string / number / null を安全に number へ。非有限・null は 0。 */
function toNumber(value: DecimalLike): number {
    if (value == null) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export function billingDraftToInvoiceItem(draft: BillingDraftForInvoiceItem): InvoiceItem {
    const amount = toNumber(draft.amount);
    const taxRate = toNumber(draft.taxRate);

    return {
        id: draft.id,
        description: draft.title,
        quantity: 1,
        unit: '式',
        unitPrice: amount,
        amount,
        taxType: taxRate > 0 ? 'standard' : 'none',
        notes: draft.note ?? undefined,
        projectMasterId: draft.projectId,
        // sectionTitle は設定しない（見出しは案件マスタ名にフォールバック）
    };
}
