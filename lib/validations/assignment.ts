import { z } from 'zod';

/**
 * 職長ID。'unassigned'（旧・職長未割当のセンチネル値）は登録不可。
 * 許すと職長行が無いためカレンダーに描画されず、作業履歴で「不明」と表示される
 * 消せない孤児配置になる（2026-06-11 kei報告の再発防止）。
 */
const foremanIdSchema = z
    .string()
    .min(1, '職長IDは必須です')
    .refine((v) => v !== 'unassigned', '職長が選択されていません');

export const createAssignmentSchema = z.object({
    projectMasterId: z.string().min(1, '案件IDは必須です'),
    assignedEmployeeId: foremanIdSchema,
    date: z.string().min(1, '日付は必須です'),
    memberCount: z.number().int().min(0).optional(),
    workers: z.array(z.string()).optional(),
    vehicles: z.array(z.string()).optional(),
    meetingTime: z.string().optional().nullable(),
    sortOrder: z.number().int().optional(),
    remarks: z.string().max(1000).optional().nullable(),
    isDispatchConfirmed: z.boolean().optional(),
    confirmedWorkerIds: z.array(z.string()).optional(),
    confirmedVehicleIds: z.array(z.string()).optional(),
    estimatedHours: z.number().min(0).max(24).optional(),
    // 日付の確度。'tentative' = 先方未確定の仮押さえ（isDispatchConfirmed とは別概念）
    dateStatus: z.enum(['confirmed', 'tentative']).optional(),
    // 仮予定の「この日までに先方へ確認する」目安日
    confirmDueDate: z.string().nullable().optional(),
});

export const updateAssignmentSchema = createAssignmentSchema.partial();

const batchUpdateItemSchema = z.object({
    id: z.string().min(1),
    expectedUpdatedAt: z.string().optional(),
    data: z.object({
        assignedEmployeeId: foremanIdSchema.optional(),
        date: z.string().optional(),
        sortOrder: z.number().int().optional(),
        memberCount: z.number().int().min(0).optional(),
        workers: z.array(z.string()).optional(),
        vehicles: z.array(z.string()).optional(),
        meetingTime: z.string().nullable().optional(),
        remarks: z.string().max(1000).nullable().optional(),
        isDispatchConfirmed: z.boolean().optional(),
        confirmedWorkerIds: z.array(z.string()).optional(),
        confirmedVehicleIds: z.array(z.string()).optional(),
        estimatedHours: z.number().min(0).max(24).optional(),
    }),
});

export const batchUpdateAssignmentsSchema = z.object({
    updates: z.array(batchUpdateItemSchema).min(1).max(200),
});

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
