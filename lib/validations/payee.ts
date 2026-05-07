import { z } from 'zod';

export const createPayeeSchema = z.object({
    name: z
        .string()
        .min(1, '振込先名は必須です')
        .max(200, '振込先名は200文字以内で入力してください'),
    nameKana: z.string().max(200, 'フリガナは200文字以内で入力してください').optional().nullable(),
    alias: z.string().max(100, '略称は100文字以内で入力してください').optional().nullable(),
    feeBearer: z.enum(['us', 'them']).optional().default('them'),
    bankName: z.string().max(100, '銀行名は100文字以内で入力してください').optional().nullable(),
    branchName: z.string().max(100, '支店名は100文字以内で入力してください').optional().nullable(),
    accountType: z.enum(['普通', '当座']).optional().nullable(),
    accountNumber: z.string().max(20, '口座番号は20文字以内で入力してください').optional().nullable(),
    accountHolder: z.string().max(200, '口座名義は200文字以内で入力してください').optional().nullable(),
    notes: z.string().max(2000, '備考は2000文字以内で入力してください').optional().nullable(),
    isActive: z.boolean().optional().default(true),
});

export const updatePayeeSchema = createPayeeSchema.partial();

export type CreatePayeeInput = z.infer<typeof createPayeeSchema>;
export type UpdatePayeeInput = z.infer<typeof updatePayeeSchema>;
