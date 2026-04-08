import { z } from 'zod';

export const workItemSchema = z.object({
    projectId: z.string().min(1, '案件IDは必須です'),
    projectTitle: z.string().optional(),
    startTime: z.string().optional().nullable(),
    endTime: z.string().optional().nullable(),
    remarks: z.string().optional().nullable(),
});

export const createDailyReportSchema = z.object({
    date: z.string().or(z.date()),
    foremanId: z.string().min(1, '職長IDは必須です'),
    workItems: z.array(workItemSchema).min(1, '作業項目は1つ以上必要です'),
    morningLoadingMinutes: z.number().int().min(0).default(0),
    eveningLoadingMinutes: z.number().int().min(0).default(0),
    notes: z.string().max(2000).optional().nullable(),
});

export const updateDailyReportSchema = createDailyReportSchema.partial();

const dailyReportWorkItemApiSchema = z.object({
    assignmentId: z.string().min(1),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    breakMinutes: z.number().int().min(0).default(0),
    workerIds: z.array(z.string()).optional(),
});

export const createDailyReportApiSchema = z.object({
    foremanId: z.string().min(1, '職長IDは必須です'),
    date: z.string().min(1, '日付は必須です'),
    morningLoadingMinutes: z.number().int().min(0).default(0),
    eveningLoadingMinutes: z.number().int().min(0).default(0),
    earlyStartMinutes: z.number().int().min(0).default(0),
    overtimeMinutes: z.number().int().min(0).default(0),
    breakMinutes: z.number().int().min(0).default(0),
    notes: z.string().max(2000).nullable().optional(),
    workItems: z.array(dailyReportWorkItemApiSchema).optional(),
});

export type CreateDailyReportInput = z.infer<typeof createDailyReportSchema>;
export type UpdateDailyReportInput = z.infer<typeof updateDailyReportSchema>;
