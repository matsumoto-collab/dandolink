import { z } from 'zod';

export const emailSchema = z.string().email('有効なメールアドレスを入力してください');

export const passwordSchema = z
    .string()
    .min(12, 'パスワードは12文字以上で入力してください')
    .max(100, 'パスワードは100文字以内で入力してください')
    .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
        'パスワードは大文字・小文字・数字・記号をそれぞれ1文字以上含む必要があります'
    );

export const phoneSchema = z
    .string()
    .regex(/^[\d\-+().\s]*$/, '有効な電話番号を入力してください')
    .optional()
    .nullable();

/**
 * Validate data and return parsed result or error response
 */
export function validateRequest<T>(
    schema: z.ZodSchema<T>,
    data: unknown
): { success: true; data: T } | { success: false; error: string; details?: z.ZodIssue[] } {
    const result = schema.safeParse(data);

    if (!result.success) {
        const issues = result.error.issues;
        const firstError = issues[0];
        return {
            success: false,
            error: firstError?.message || 'バリデーションエラー',
            details: issues,
        };
    }

    return { success: true, data: result.data };
}
