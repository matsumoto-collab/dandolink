import { z } from 'zod';

const decimalString = z.union([z.string(), z.number()]).transform((v) => {
    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed === '') return null;
        return trimmed;
    }
    return v.toString();
});

export const createBillingDraftSchema = z.object({
    projectId: z.string().min(1, '案件IDは必須です'),
    customerId: z.string().min(1, '顧客IDは必須です'),
    title: z.string().min(1, 'タイトルは必須です').max(200, 'タイトルは200文字以内で入力してください'),
    amount: decimalString.nullable().optional(),
    taxRate: decimalString.optional().default('0.10'),
    note: z.string().max(2000, 'メモは2000文字以内で入力してください').nullable().optional(),
    items: z.array(z.unknown()).optional().nullable(),
});

export const updateBillingDraftSchema = z.object({
    title: z.string().min(1, 'タイトルは必須です').max(200, 'タイトルは200文字以内で入力してください').optional(),
    amount: decimalString.nullable().optional(),
    taxRate: decimalString.optional(),
    note: z.string().max(2000, 'メモは2000文字以内で入力してください').nullable().optional(),
    items: z.array(z.unknown()).optional().nullable(),
});

export const billingDraftListQuerySchema = z.object({
    status: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
    customerId: z.string().optional(),
    projectId: z.string().optional(),
    createdById: z.string().optional(),
    q: z.string().optional(),
    includeDeleted: z.enum(['0', '1']).optional().default('0'),
});

/**
 * Phase 3: 請求予定（pending な BillingDraft 群）→ Invoice 発行の body。
 * POST /api/invoices/from-billing-drafts
 *
 * - billingDraftIds: 請求書化する BillingDraft の ID（同一顧客・全 pending・未削除であること）
 * - title: Invoice.title は必須（D-h: 初期空欄・手入力・未入力で発行不可）
 * - dueDate: 支払期限（省略時はサーバーで今日+30日）
 * - status: 発行 Invoice の初期ステータス（D-g: 既定 'draft'）
 * - items: プレビュー（InvoiceForm）で編集済みの明細。省略時はサーバーが draft から生成
 */
export const issueInvoiceFromDraftsSchema = z.object({
    billingDraftIds: z.array(z.string().min(1)).min(1, '請求予定を1件以上選択してください'),
    title: z.string().min(1, '請求書の件名は必須です').max(200, '件名は200文字以内で入力してください'),
    dueDate: z.string().optional(),
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional().default('draft'),
    notes: z.string().max(2000, 'メモは2000文字以内で入力してください').nullable().optional(),
    items: z.array(z.unknown()).optional(),
});

export type CreateBillingDraftInput = z.infer<typeof createBillingDraftSchema>;
export type UpdateBillingDraftInput = z.infer<typeof updateBillingDraftSchema>;
export type BillingDraftListQueryInput = z.infer<typeof billingDraftListQuerySchema>;
export type IssueInvoiceFromDraftsInput = z.infer<typeof issueInvoiceFromDraftsSchema>;
