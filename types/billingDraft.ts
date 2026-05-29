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
}

/** PATCH /api/billing-drafts/[id] の body（pending のみ編集可） */
export interface UpdateBillingDraftInput {
    title?: string;
    amount?: string | null;
    taxRate?: string;
    note?: string | null;
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
    /** 過去の請求済み合計（Invoice.total の和、cancelled は除外） */
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
    total: number;
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
          /** Invoice の場合は常に total（number、null にならない） */
          amount: number;
          status: string;
          createdAt: string;
      };
