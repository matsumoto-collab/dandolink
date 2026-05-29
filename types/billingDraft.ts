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
