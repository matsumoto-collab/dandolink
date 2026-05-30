/**
 * 請求予定（BillingDraft）— Phase 1 UI 用のクライアントサイド型定義。
 *
 * API レスポンス（app/api/billing-drafts/route.ts, [id]/route.ts）の include 構造に整合：
 *   projectMaster: { id, title, name }
 *   customer:      { id, name }
 *   createdBy:     { id, displayName, username }
 *   invoice:       { id, invoiceNumber, status }?
 *
 * Decimal フィールド（amount, taxRate）は Prisma の Decimal が JSON 経由で string になる。
 * 数値として扱うときは Number(...) を使うこと。
 */

import type { InvoiceItem } from './invoice';

export type BillingDraftStatus = 'pending' | 'confirmed' | 'cancelled';

export interface BillingDraftProjectMaster {
    id: string;
    title: string;
    name: string | null;
}

export interface BillingDraftCustomer {
    id: string;
    name: string;
}

export interface BillingDraftCreatedBy {
    id: string;
    displayName: string;
    username: string;
}

export interface BillingDraftInvoice {
    id: string;
    invoiceNumber: string;
    status: string;
}

export interface BillingDraft {
    id: string;
    projectId: string;
    customerId: string;
    title: string;
    amount: string | number | null;
    taxRate: string | number;
    status: BillingDraftStatus;
    invoiceId: string | null;
    createdById: string;
    note: string | null;
    /** 明細（複数行）。API で JSON 文字列からパース済。空配列 = 旧・単一行モデル（title/amount を使用） */
    items: InvoiceItem[];
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;

    projectMaster: BillingDraftProjectMaster;
    customer: BillingDraftCustomer;
    createdBy: BillingDraftCreatedBy;
    invoice: BillingDraftInvoice | null;
}

/** POST /api/billing-drafts の body */
export interface CreateBillingDraftInput {
    projectId: string;
    customerId: string;
    title: string;
    amount?: string | null;
    taxRate?: string;
    note?: string | null;
    /** 明細（複数行）。指定時はサーバーが items に JSON 保存し amount を明細合計で上書き */
    items?: InvoiceItem[] | null;
}

/** PATCH /api/billing-drafts/[id] の body（pending のみ編集可） */
export interface UpdateBillingDraftInput {
    title?: string;
    amount?: string | null;
    taxRate?: string;
    note?: string | null;
    /** 明細（複数行）。指定時はサーバーが items に JSON 保存し amount を明細合計で上書き */
    items?: InvoiceItem[] | null;
}

/** GET /api/billing-drafts のクエリ */
export interface BillingDraftListParams {
    status?: BillingDraftStatus;
    customerId?: string;
    projectId?: string;
    createdById?: string;
    q?: string;
    includeDeleted?: boolean;
}

// ============================================
// Phase 2: 案件の請求コンテキスト（billing-context API）
// ============================================

/**
 * 案件の請求コンテキスト（GET /api/project-masters/[id]/billing-context のレスポンス）。
 * カレンダー右クリック / 案件詳細「請求予定を追加」ボタンから起動した
 * BillingDraftFormPanel 上部に表示する拡張情報。
 */
export interface ProjectContext {
    /** ProjectMaster.contractAmount（税抜円、未設定なら null） */
    contractAmount: number | null;
    /** この案件ぶんの請求済み合計（税抜）。Invoice 明細を projectMasterId で按分し合算、cancelled 除外。 */
    totalInvoicedAmount: number;
    /** 見積書一覧（approved 先頭 + createdAt desc、最大 3 件 + 全件数） */
    estimates: {
        items: ProjectContextEstimate[];
        totalCount: number;
    };
    /** 請求履歴（BillingDraft + Invoice 統合、createdAt desc、件数上限なし） */
    history: ProjectContextHistoryItem[];
}

export interface ProjectContextEstimate {
    id: string;
    estimateNumber: string;
    title: string;
    /** 'draft' | 'sent' | 'approved' | 'rejected' 等（DB 制約なし、自由文字列） */
    status: string;
    /** 見積金額（税別＝subtotal）。請求書 PDF は税込だが、ここでは税別で表示し残り計算に使う。 */
    subtotal: number;
    createdAt: string;
    createdByName: string | null;
}

export type ProjectContextHistoryItem =
    | {
          type: 'billing-draft';
          id: string;
          title: string;
          amount: number | null;
          status: BillingDraftStatus;
          createdAt: string;
      }
    | {
          type: 'invoice';
          id: string;
          invoiceNumber: string;
          title: string;
          /** Invoice の場合はこの案件ぶんの請求額（税抜・按分、null にならない） */
          amount: number;
          status: string;
          createdAt: string;
      };
