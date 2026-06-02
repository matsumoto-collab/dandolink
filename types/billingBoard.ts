/**
 * 請求判断ボード（GET /api/billing-board）の行データ型。
 *
 * カレンダーに配置済み（assignment が 1 件以上）かつ全額請求済みでない案件を、
 * 担当者が「請求する / まだ / 対象外」を判断するための一覧。金額はすべて税抜（円）。
 */
import type { BillingStatus } from '@/lib/billing/billingStatus';

/** 案件ごとの請求判断（'請求する' は BillingDraft 作成で表現するため列には持たない）。 */
export type BillingDecision = 'pending' | 'hold' | 'excluded';

export interface BillingBoardRow {
    id: string;
    /** 正式名称（請求書見出しの既定）。 */
    title: string;
    /** 短縮名（一覧表示用、無ければ null）。 */
    name: string | null;
    customerId: string | null;
    customerName: string | null;
    /** 案件ステータス（'active' | 'completed'）。完了はヒント表示に使う。 */
    status: string;
    /** 契約金額（税抜・未設定 null）。 */
    contractAmount: number | null;
    /** この案件ぶんの請求済み合計（税抜）。 */
    invoicedAmount: number;
    /** 'none'|'unbilled'|'partial'（'full' はボードから除外済み）。 */
    billingStatus: BillingStatus;
    /** 残額（契約−請求済、契約未設定なら null）。 */
    remainingAmount: number | null;
    /** 案件担当者の User ID 配列（createdBy 由来）。表示名は /api/users で解決。 */
    assigneeIds: string[];
    /** 最終作業日（配置の最大日付、ISO 文字列・無ければ null）。 */
    lastWorkDate: string | null;
    /** 紐づく見積書の件数。 */
    estimateCount: number;
    /** approved の見積書が 1 件以上あるか。 */
    hasApprovedEstimate: boolean;
    /** 未処理（pending）の請求予定が既にあるか＝「請求予定あり」。 */
    hasPendingDraft: boolean;
    billingDecision: BillingDecision;
}
