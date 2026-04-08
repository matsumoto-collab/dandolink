import { z } from 'zod';

export const createAssignmentSchema = z.object({
    projectMasterId: z.string().min(1, '案件IDは必須です'),
    assignedEmployeeId: z.string().min(1, '職長IDは必須です'),
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
});

export const updateAssignmentSchema = createAssignmentSchema.partial();

const batchUpdateItemSchema = z.object({
    id: z.string().min(1),
    expectedUpdatedAt: z.string().optional(),
    data: z.object({
        assignedEmployeeId: z.string().optional(),
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
