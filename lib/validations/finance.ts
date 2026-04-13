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
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional().default('draft'),
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
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
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
    status: z.enum(['draft', 'sent', 'accepted', 'rejected']).optional().default('draft'),
    notes: z.string().max(2000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    costTotal: z.number().int().nullable().optional(),
    constructionPeriod: z.string().max(200).nullable().optional(),
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
    status: z.enum(['draft', 'sent', 'accepted', 'rejected']).optional(),
    notes: z.string().max(2000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    costTotal: z.number().int().nullable().optional(),
    constructionPeriod: z.string().max(200).nullable().optional(),
});
