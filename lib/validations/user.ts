import { z } from 'zod';
import { emailSchema, passwordSchema } from './common';

export const userRoleSchema = z.enum(['admin', 'manager', 'accountant', 'foreman1', 'foreman2', 'worker', 'partner', 'partner_member', 'support']);

export const partnerTaxModeSchema = z.enum(['exclusive', 'inclusive']);

const partnerMemberCompanyIdRefinement = {
    check: (data: { role?: string; companyId?: string | null }) =>
        data.role !== 'partner_member' || !!data.companyId,
    message: 'partner_memberロール選択時はcompanyIdが必須です',
    path: ['companyId'] as const,
};

export const createUserSchema = z.object({
    username: z
        .string()
        .min(3, 'ユーザー名は3文字以上で入力してください')
        .max(50, 'ユーザー名は50文字以内で入力してください')
        .regex(/^[a-zA-Z0-9_]+$/, 'ユーザー名は英数字とアンダースコアのみ使用できます'),
    email: emailSchema,
    displayName: z
        .string()
        .min(1, '表示名は必須です')
        .max(100, '表示名は100文字以内で入力してください'),
    password: passwordSchema,
    role: userRoleSchema,
    assignedProjects: z.array(z.string()).optional(),
    dailyRate: z.number().min(0, '日給は0以上で入力してください').optional().nullable(),
    companyId: z.string().optional().nullable(),
    isLoginEnabled: z.boolean().optional(),
    partnerTaxMode: partnerTaxModeSchema.optional(),
    canAccessCashbook: z.boolean().optional(),
    tentativeConfirmLeadDays: z.number().int().min(0).max(90).optional(),
}).refine(partnerMemberCompanyIdRefinement.check, {
    message: partnerMemberCompanyIdRefinement.message,
    path: [...partnerMemberCompanyIdRefinement.path],
});

export const createSupportUserSchema = z.object({
    displayName: z
        .string()
        .min(1, '表示名は必須です')
        .max(100, '表示名は100文字以内で入力してください'),
    role: z.literal('support'),
    dailyRate: z.number().min(0, '日給は0以上で入力してください').optional().nullable(),
});

export const updateUserSchema = z.object({
    email: emailSchema.optional(),
    displayName: z
        .string()
        .min(1, '表示名は必須です')
        .max(100, '表示名は100文字以内で入力してください')
        .optional(),
    password: passwordSchema.optional(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
    assignedProjects: z.array(z.string()).optional(),
    dailyRate: z.number().min(0, '日給は0以上で入力してください').optional().nullable(),
    companyId: z.string().optional().nullable(),
    isLoginEnabled: z.boolean().optional(),
    partnerTaxMode: partnerTaxModeSchema.optional(),
    canAccessCashbook: z.boolean().optional(),
    tentativeConfirmLeadDays: z.number().int().min(0).max(90).optional(),
}).refine(partnerMemberCompanyIdRefinement.check, {
    message: partnerMemberCompanyIdRefinement.message,
    path: [...partnerMemberCompanyIdRefinement.path],
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
