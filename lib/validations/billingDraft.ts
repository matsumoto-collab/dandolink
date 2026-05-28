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
});

export const updateBillingDraftSchema = z.object({
    title: z.string().min(1, 'タイトルは必須です').max(200, 'タイトルは200文字以内で入力してください').optional(),
    amount: decimalString.nullable().optional(),
    taxRate: decimalString.optional(),
    note: z.string().max(2000, 'メモは2000文字以内で入力してください').nullable().optional(),
});

export const billingDraftListQuerySchema = z.object({
    status: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
    customerId: z.string().optional(),
    projectId: z.string().optional(),
    createdById: z.string().optional(),
    q: z.string().optional(),
    includeDeleted: z.enum(['0', '1']).optional().default('0'),
});

export type CreateBillingDraftInput = z.infer<typeof createBillingDraftSchema>;
export type UpdateBillingDraftInput = z.infer<typeof updateBillingDraftSchema>;
export type BillingDraftListQueryInput = z.infer<typeof billingDraftListQuerySchema>;
