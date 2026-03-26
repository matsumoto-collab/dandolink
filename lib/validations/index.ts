import { z } from 'zod';

// ============================================
// Common Schemas
// ============================================

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

// ============================================
// User Schemas
// ============================================

export const userRoleSchema = z.enum(['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner', 'support']);

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
    hourlyRate: z.number().min(0, '時給は0以上で入力してください').optional().nullable(),
});

export const createSupportUserSchema = z.object({
    displayName: z
        .string()
        .min(1, '表示名は必須です')
        .max(100, '表示名は100文字以内で入力してください'),
    role: z.literal('support'),
    hourlyRate: z.number().min(0, '時給は0以上で入力してください').optional().nullable(),
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
    hourlyRate: z.number().min(0, '時給は0以上で入力してください').optional().nullable(),
});

// ============================================
// Customer Schemas
// ============================================

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

// ============================================
// Project Master Schemas
// ============================================

// マスターデータで動的に管理されるため、任意の文字列を許可（レガシー値: assembly, demolition, other）
export const constructionTypeSchema = z.string().min(1);

export const createProjectMasterSchema = z.object({
    title: z
        .string()
        .max(200, '案件名は200文字以内で入力してください')
        .optional()
        .default(''),
    name: z.string().max(100, '名前は100文字以内で入力してください').optional().nullable(),
    honorific: z.string().max(20).optional().nullable(),
    constructionSuffixId: z.string().optional().nullable(),
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
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    // 工事情報
    area: z.number().optional().nullable(),
    areaRemarks: z.string().optional().nullable(),
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
    estimatedHours: z.number().min(0).max(24).optional(),
});

export const updateAssignmentSchema = createAssignmentSchema.partial();

// ============================================
// Daily Report Schemas
// ============================================

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

// ============================================
// Invoice Schemas
// ============================================

export const updateInvoiceSchema = z.object({
    projectMasterId: z.string().optional(),
    estimateId: z.string().nullable().optional(),
    invoiceNumber: z.string().max(50).optional(),
    title: z.string().max(200).optional(),
    items: z.array(z.unknown()).optional(),
    subtotal: z.number().optional(),
    tax: z.number().optional(),
    total: z.number().optional(),
    dueDate: z.string().optional(),
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
    paidDate: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
});

// ============================================
// Estimate Schemas
// ============================================

export const updateEstimateSchema = z.object({
    projectMasterId: z.string().nullable().optional(),
    customerId: z.string().nullable().optional(),
    estimateNumber: z.string().max(50).optional(),
    title: z.string().max(200).optional(),
    items: z.array(z.unknown()).optional(),
    subtotal: z.number().optional(),
    tax: z.number().optional(),
    total: z.number().optional(),
    validUntil: z.string().optional(),
    status: z.enum(['draft', 'sent', 'accepted', 'rejected']).optional(),
    notes: z.string().max(2000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
});

// ============================================
// Batch Assignment Schema
// ============================================

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

// ============================================
// Calendar Schemas
// ============================================

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

// ============================================
// Daily Report Schema (for API POST)
// ============================================

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
