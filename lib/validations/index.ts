import { z } from 'zod';

// ============================================
// Common Schemas
// ============================================

export const emailSchema = z.string().email('有効なメールアドレスを入力してください');

export const passwordSchema = z
    .string()
    .min(8, 'パスワードは8文字以上で入力してください')
    .max(100, 'パスワードは100文字以内で入力してください')
    .regex(
        /^(?=.*[a-zA-Z])(?=.*\d)/,
        'パスワードは英字と数字を含む必要があります'
    );

export const phoneSchema = z
    .string()
    .regex(/^[\d\-+().\s]*$/, '有効な電話番号を入力してください')
    .optional()
    .nullable();

// ============================================
// User Schemas
// ============================================

export const userRoleSchema = z.enum(['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner']);

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
});

// ============================================
// Customer Schemas
// ============================================

export const contactPersonSchema = z.object({
    name: z.string().min(1, '担当者名は必須です'),
    position: z.string().optional(),
    phone: phoneSchema,
    email: z.string().email('有効なメールアドレスを入力してください').optional().nullable(),
});

export const createCustomerSchema = z.object({
    name: z
        .string()
        .min(1, '会社名は必須です')
        .max(200, '会社名は200文字以内で入力してください'),
    shortName: z.string().max(50, '略称は50文字以内で入力してください').optional().nullable(),
    contactPersons: z.array(contactPersonSchema).optional().nullable(),
    email: z.string().email('有効なメールアドレスを入力してください').optional().nullable(),
    phone: phoneSchema,
    fax: phoneSchema,
    address: z.string().max(500, '住所は500文字以内で入力してください').optional().nullable(),
    notes: z.string().max(2000, '備考は2000文字以内で入力してください').optional().nullable(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

// ============================================
// Project Master Schemas
// ============================================

// マスターデータで動的に管理されるため、任意の文字列を許可（レガシー値: assembly, demolition, other）
export const constructionTypeSchema = z.string().min(1);

export const createProjectMasterSchema = z.object({
    title: z
        .string()
        .min(1, '案件名は必須です')
        .max(200, '案件名は200文字以内で入力してください'),
    customerId: z.string().optional().nullable(),
    customerName: z.string().max(200).optional().nullable(),
    customerShortName: z.string().max(100).optional().nullable(),
    constructionType: constructionTypeSchema.optional(),
    constructionContent: z.string().optional().nullable(),
    // 住所情報
    postalCode: z.string().regex(/^\d{3}-?\d{4}$/, '有効な郵便番号を入力してください').optional().nullable(),
    prefecture: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    location: z.string().max(500).optional().nullable(),
    plusCode: z.string().optional().nullable(),
    // 工事情報
    area: z.number().optional().nullable(),
    areaRemarks: z.string().optional().nullable(),
    assemblyDate: z.string().optional().nullable(),
    demolitionDate: z.string().optional().nullable(),
    estimatedAssemblyWorkers: z.number().int().min(0).optional().nullable(),
    estimatedDemolitionWorkers: z.number().int().min(0).optional().nullable(),
    contractAmount: z.number().min(0).optional().nullable(),
    // 足場仕様
    scaffoldingSpec: z.unknown().optional().nullable(),
    description: z.string().optional().nullable(),
    // その他
    remarks: z.string().max(2000).optional().nullable(),
    createdBy: z.array(z.string()).optional(),
    status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

export const updateProjectMasterSchema = createProjectMasterSchema.partial();

// ============================================
// Assignment Schemas
// ============================================

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
});

export const updateAssignmentSchema = createAssignmentSchema.partial();

// ============================================
// Daily Report Schemas
// ============================================

export const workItemSchema = z.object({
    projectId: z.string().min(1, '案件IDは必須です'),
    projectTitle: z.string().optional(),
    workMinutes: z.number().int().min(0, '作業時間は0以上で入力してください'),
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

// ============================================
// Helper Functions
// ============================================

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

// Type exports
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CreateProjectMasterInput = z.infer<typeof createProjectMasterSchema>;
export type UpdateProjectMasterInput = z.infer<typeof updateProjectMasterSchema>;
export type CreateDailyReportInput = z.infer<typeof createDailyReportSchema>;
export type UpdateDailyReportInput = z.infer<typeof updateDailyReportSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
