import { z } from 'zod';
import { phoneSchema } from './common';

export const contactPersonSchema = z.object({
    name: z.string().min(1, '担当者名は必須です'),
    position: z.string().optional(),
    phone: phoneSchema,
    email: z.string().email('有効なメールアドレスを入力してください').or(z.literal('')).optional().nullable(),
});

export const createCustomerSchema = z.object({
    name: z
        .string()
        .min(1, '会社名は必須です')
        .max(200, '会社名は200文字以内で入力してください'),
    shortName: z.string().max(50, '略称は50文字以内で入力してください').optional().nullable(),
    honorific: z.enum(['御中', '様']).optional().default('御中'),
    contactPersons: z.array(contactPersonSchema).optional().nullable(),
    email: z.string().email('有効なメールアドレスを入力してください').or(z.literal('')).optional().nullable(),
    phone: phoneSchema,
    fax: phoneSchema,
    postalCode: z.string().max(10, '郵便番号は10文字以内で入力してください').optional().nullable(),
    address: z.string().max(500, '住所は500文字以内で入力してください').optional().nullable(),
    notes: z.string().max(2000, '備考は2000文字以内で入力してください').optional().nullable(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
