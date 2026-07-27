import { z } from 'zod';

// ========== Invoice ==========

export const createInvoiceSchema = z.object({
    projectMasterId: z.string().optional(),
    projectId: z.string().optional(),
    projectMasterIds: z.array(z.string()).optional(),
    customerId: z.string().nullable().optional(),
    estimateId: z.string().nullable().optional(),
    invoiceNumber: z.string().max(50).optional(),
    title: z.string().min(1, 'タイトルは必須です').max(200),
    items: z.array(z.unknown()).optional().default([]),
    subtotal: z.number().min(0, '小計は0以上で入力してください').optional().default(0),
    tax: z.number().min(0, '税額は0以上で入力してください').optional().default(0),
    total: z.number().min(0, '合計は0以上で入力してください').optional().default(0),
    dueDate: z.string().optional(),
    status: z.enum(['draft', 'confirmed', 'sent', 'paid', 'overdue', 'cancelled']).optional().default('draft'),
    paidDate: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    createdAt: z.string().optional(),
});

export const updateInvoiceSchema = z.object({
    projectMasterId: z.string().optional(),
    estimateId: z.string().nullable().optional(),
    invoiceNumber: z.string().max(50).optional(),
    title: z.string().max(200).optional(),
    items: z.array(z.unknown()).optional(),
    subtotal: z.number().optional(),
    tax: z.number().optional(),
    total: z.number().optional(),
    dueDate: z.string().optional(),
    status: z.enum(['draft', 'confirmed', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
    paidDate: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    createdAt: z.string().optional(),
});

// ========== Estimate ==========

export const createEstimateSchema = z.object({
    projectMasterId: z.string().nullable().optional(),
    customerId: z.string().nullable().optional(),
    estimateNumber: z.string().max(50).optional(),
    title: z.string().min(1, 'タイトルは必須です').max(200),
    items: z.array(z.unknown()).optional().default([]),
    subtotal: z.number().min(0, '小計は0以上で入力してください').optional().default(0),
    tax: z.number().min(0, '税額は0以上で入力してください').optional().default(0),
    total: z.number().min(0, '合計は0以上で入力してください').optional().default(0),
    validUntil: z.string().optional(),
    status: z.enum(['draft', 'sent', 'approved', 'rejected']).optional().default('draft'),
    notes: z.string().max(2000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    costTotal: z.number().int().nullable().optional(),
    constructionPeriod: z.string().max(200).nullable().optional(),
    createdAt: z.string().optional(), // 見積日（PDFに出る日付）
});

export const updateEstimateSchema = z.object({
    projectMasterId: z.string().nullable().optional(),
    customerId: z.string().nullable().optional(),
    estimateNumber: z.string().max(50).optional(),
    title: z.string().max(200).optional(),
    items: z.array(z.unknown()).optional(),
    subtotal: z.number().optional(),
    tax: z.number().optional(),
    total: z.number().optional(),
    validUntil: z.string().optional(),
    status: z.enum(['draft', 'sent', 'approved', 'rejected']).optional(),
    notes: z.string().max(2000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    costTotal: z.number().int().nullable().optional(),
    constructionPeriod: z.string().max(200).nullable().optional(),
    createdAt: z.string().optional(), // 見積日（PDFに出る日付）
});

// ========== InvoicePayment（入金記録） ==========

export const createInvoicePaymentSchema = z
    .object({
        paidDate: z.string().min(1, '入金日は必須です'),
        amount: z.number().min(0, '入金額は0以上で入力してください').optional().default(0),
        fee: z.number().min(0, '手数料は0以上で入力してください').optional().default(0),
        method: z.string().max(50).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
    })
    // 入金額と手数料が両方0の登録は無意味なので弾く（手数料のみの相殺登録は許可）。
    .refine((d) => (d.amount ?? 0) + (d.fee ?? 0) > 0, {
        message: '入金額または手数料のいずれかを入力してください',
        path: ['amount'],
    });
