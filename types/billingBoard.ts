/**
 * 請求判断ボード（GET /api/billing-board）の行データ型。
 *
 * 指定期間（from〜to, 既定=当月JST）に配置のある、かつ全額請求済みでない案件を、
 * 担当者が「請求する / まだ / 対象外」を判断するための一覧。金額はすべて税抜（円）。
 */
import type { BillingStatus } from '@/lib/billing/billingStatus';

/**
 * 案件ごとの請求判断。
 * - 'pending'  … 判断待ち
 * - 'hold'     … まだ（保留）
 * - 'excluded' … 対象外
 * - 'billed'   … 請求済み（手動で「請求済み」にした案件。実請求の有無に依らずボードの「請求済み」タブへ送る）
 *
 * 「請求する」は決定値ではなく、ボード上で請求対象に追加（クライアント保持）→請求書発行で表現する。
 */
export type BillingDecision = 'pending' | 'hold' | 'excluded' | 'billed';

/** 期間内の配置1件分の作業履歴。工事種別/職長は ID で返し、表示名は呼び出し側で解決する。 */
export interface BillingBoardWorkItem {
    /** 配置日（ISO 文字列）。 */
    date: string;
    /** 工事種別 ID（ConstructionType.id、レガシー文字列の場合あり・無ければ null）。 */
    constructionType: string | null;
    /** 職長 User ID（assignedEmployeeId・無ければ null）。 */
    foremanId: string | null;
    /** 人数。 */
    memberCount: number;
}

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
    /** 契約金額（足場工事金額・税抜・未設定 null）。見積金額の手入力＝上書き値として使う。 */
    contractAmount: number | null;
    /** 見積金額（請求待ちの基準額・税抜）。contractAmount(上書き) ?? 見積1件の額。複数見積で未設定なら null。 */
    estimateAmount: number | null;
    /** 見積が複数あり見積金額が未設定＝行で「見積を選択」が必要。 */
    needsEstimatePick: boolean;
    /** この案件ぶんの請求済み合計（税抜・全期間）。行の補助表示（請求済／残）に使う。 */
    invoicedAmount: number;
    /** この締め月（periodFrom〜periodTo）内に発行された請求書の、この案件ぶんの請求額（税抜）。「請求済み」タブの判定・表示に使う。 */
    monthlyInvoicedAmount: number;
    /** 'none'|'unbilled'|'partial'|'full'（案件トータル・自動判定）。行のバッジ表示用。タブ分類には monthlyInvoicedAmount を使う。 */
    billingStatus: BillingStatus;
    /** 案件レベルの手動上書き（ProjectMaster.billingStatusOverride）。null=自動判定。バッジは override 優先。 */
    billingStatusOverride: BillingStatus | null;
    /** 残額（見積金額−請求済、見積金額未設定なら null）。 */
    remainingAmount: number | null;
    /** 案件担当者の User ID 配列（createdBy 由来）。表示名は /api/users で解決。 */
    assigneeIds: string[];
    /** 期間内の最終作業日（ISO・無ければ null）。 */
    lastWorkDate: string | null;
    /** 期間内に登場した工事種別 ID（重複排除・初出順）。チップ表示用。 */
    constructionTypeIds: string[];
    /** 期間内の作業履歴（直近順・上限あり）。 */
    workHistory: BillingBoardWorkItem[];
    /** 期間内の作業件数（workHistory は上限で間引く場合があるため総数を別途返す）。 */
    workCount: number;
    /** 紐づく見積書の件数。 */
    estimateCount: number;
    /** approved の見積書が 1 件以上あるか。 */
    hasApprovedEstimate: boolean;
    /** 未処理（pending）の請求予定が既にあるか＝「請求予定あり」。 */
    hasPendingDraft: boolean;
    billingDecision: BillingDecision;
    /** 顧客の請求締め日（0=末締め）。締め分モードで顧客ごとに期間を出し分ける。 */
    customerClosingDay: number;
    /** この行の集計対象期間（締め分＝顧客の締め日ウィンドウ、任意範囲＝指定 from/to。YYYY-MM-DD）。 */
    periodFrom: string;
    periodTo: string;
}
