import { z } from 'zod';

// 日付文字列（YYYY-MM-DD or ISO形式）を受け付ける
const dateString = z
    .string()
    .min(1, '日付は必須です')
    .refine((v) => !isNaN(Date.parse(v)), { message: '有効な日付形式で入力してください' });

const optionalDateString = z
    .string()
    .refine((v) => v === '' || !isNaN(Date.parse(v)), { message: '有効な日付形式で入力してください' })
    .optional()
    .nullable();

export const createPaymentScheduleSchema = z.object({
    paymentDate: dateString,
    paymentType: z.enum(['transfer', 'payment_slip']),
    payeeId: z.string().uuid('振込先IDが不正です').optional().nullable(),
    payeeName: z
        .string()
        .min(1, '振込先名は必須です')
        .max(200, '振込先名は200文字以内で入力してください'),
    amount: z
        .number({ message: '金額を数値で入力してください' })
        .nonnegative('金額は0以上で入力してください'),
    feeFlag: z.boolean().optional().default(false),
    dueDate: optionalDateString,
    bankName: z.string().max(100).optional().nullable(),
    branchName: z.string().max(100).optional().nullable(),
    accountType: z.enum(['普通', '当座']).optional().nullable(),
    accountNumber: z.string().max(20).optional().nullable(),
    accountHolder: z.string().max(200).optional().nullable(),
    isPaid: z.boolean().optional().default(false),
    notes: z.string().max(2000, '備考は2000文字以内で入力してください').optional().nullable(),
    sortOrder: z.number().int().optional().default(0),
});

export const updatePaymentScheduleSchema = createPaymentScheduleSchema.partial();

export type CreatePaymentScheduleInput = z.infer<typeof createPaymentScheduleSchema>;
export type UpdatePaymentScheduleInput = z.infer<typeof updatePaymentScheduleSchema>;
