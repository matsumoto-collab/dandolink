/**
 * 見積明細（EstimateItem）→ 請求明細（InvoiceItem）への変換ユーティリティ。
 *
 * 経緯: もともと components/BillingDraft/BillingDraftFormPanel.tsx 内のモジュールローカル関数だったが、
 * 請求判断ボード（請求する → 見積から請求予定を自動生成）でも同じ変換が必要になったため共通化した。
 * 請求で使わない原価・カテゴリ情報は落とし、カテゴリ行は子明細に展開する。
 */
import type { InvoiceItem } from '@/types/invoice';
import type { EstimateItem } from '@/types/estimate';

let itemSeq = 0;

/** 請求明細用の一意 ID を生成（クライアント表示・dirty 判定の安定キー）。 */
export function newBillingItemId(): string {
    itemSeq += 1;
    return `bd-item-${Date.now().toString(36)}-${itemSeq}`;
}

/** 見積明細 1 行 → 請求明細 1 行（原価・カテゴリは落とす）。 */
export function estimateItemToBilling(it: EstimateItem): InvoiceItem {
    return {
        id: newBillingItemId(),
        description: it.description,
        specification: it.specification,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        amount: it.amount,
        taxType: it.taxType,
        notes: it.notes,
    };
}

/** 見積明細配列 → 請求明細配列へ平坦化（カテゴリ行は children を展開）。 */
export function flattenEstimateItems(items: EstimateItem[]): InvoiceItem[] {
    const out: InvoiceItem[] = [];
    for (const it of items) {
        if (it.isCategory) {
            for (const child of it.children ?? []) out.push(estimateItemToBilling(child));
        } else {
            out.push(estimateItemToBilling(it));
        }
    }
    return out;
}
