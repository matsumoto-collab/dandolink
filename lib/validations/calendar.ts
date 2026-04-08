import { z } from 'zod';

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付キーはYYYY-MM-DD形式で入力してください');

export const cellRemarkSchema = z.object({
    foremanId: z.string().min(1, '職長IDは必須です'),
    dateKey: dateKeySchema,
    text: z.string().max(500, '備考は500文字以内で入力してください').optional().nullable(),
});

export const calendarRemarkSchema = z.object({
    dateKey: dateKeySchema,
    text: z.string().max(500, '備考は500文字以内で入力してください').optional().nullable(),
});

export const vacationSchema = z.object({
    dateKey: dateKeySchema,
    employeeIds: z.array(z.string().min(1, '無効な従業員IDです')).optional().default([]),
    remarks: z.string().max(500).optional().nullable(),
});

export const memberAdjustmentSchema = z.object({
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付キーはYYYY-MM-DD形式で入力してください'),
    adjustment: z.number().int(),
});

export const displayedForemanIdsSchema = z.object({
    displayedForemanIds: z.array(z.string()).optional().default([]),
});
