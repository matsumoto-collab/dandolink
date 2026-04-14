import { z } from 'zod';

export const costMasterSchema = z.object({
    name: z.string().min(1, '名前は必須です').max(100),
    quantity: z.number().nullable().optional(),
    unit: z.string().max(50).nullable().optional(),
    unitPrice: z.number().nullable().optional(),
});

export const nameOnlySchema = z.object({
    name: z.string().min(1, '名前は必須です').max(100),
});

export const unitPriceCategorySchema = z.object({
    name: z.string().min(1, 'カテゴリ名は必須です').max(100),
    sortOrder: z.number().int().optional().default(0),
    quantity: z.number().nullable().optional(),
    unit: z.string().max(50).nullable().optional(),
});

export const unitPriceSpecificationSchema = z.object({
    unitPriceMasterId: z.string().min(1, '単価マスターIDは必須です'),
    name: z.string().min(1, '規格名は必須です').max(100),
    sortOrder: z.number().int().optional().default(0),
});

export const unitPriceTemplateSchema = z.object({
    name: z.string().min(1, 'テンプレート名は必須です').max(100),
    sortOrder: z.number().int().optional().default(0),
});

export const unitPriceMasterSchema = z.object({
    description: z.string().min(1, '説明は必須です').max(200),
    unit: z.string().min(1, '単位は必須です').max(50),
    unitPrice: z.number(),
    quantity: z.number().nullable().optional(),
    templates: z.unknown(),
    categoryId: z.string().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
});

export const companyInfoSchema = z.object({
    name: z.string().max(200),
    postalCode: z.string().max(20),
    address: z.string().max(500),
    tel: z.string().max(50),
    fax: z.string().max(50).nullable().optional(),
    email: z.string().email().or(z.literal('')).nullable().optional(),
    representativeTitle: z.string().max(100).nullable().optional(),
    representative: z.string().max(100),
    sealImage: z.string().nullable().optional(),
    logoImage: z.string().nullable().optional(),
    licenseNumber: z.string().max(100).nullable().optional(),
    registrationNumber: z.string().max(100).nullable().optional(),
    contactPerson: z.string().max(100).nullable().optional(),
    bankAccounts: z.unknown().nullable().optional(),
});

export const systemSettingsSchema = z.object({
    totalMembers: z.number().int().min(1, 'totalMembersは1以上の数値が必要です'),
});

export const scaffoldingSpecItemSchema = z.object({
    groupId: z.string().min(1, 'groupIdは必須です'),
    name: z.string().min(1, '名前は必須です').max(100),
    type: z.enum(['toggle', 'segment', 'text']),
    options: z.array(z.string()).nullable().optional(),
    hasText: z.boolean().optional(),
});

export const memberCountHistoryCreateSchema = z.object({
    startDate: z.string().min(1, '開始日は必須です'),
    count: z.number().int().min(1, 'countは1以上が必要です'),
});

export const memberCountHistoryUpdateSchema = z.object({
    id: z.string().min(1, 'IDは必須です'),
    startDate: z.string().min(1, '開始日は必須です'),
    count: z.number().int().min(1, 'countは1以上が必要です'),
});

export const memberCountHistoryDeleteSchema = z.object({
    id: z.string().min(1, 'IDは必須です'),
});

export const loadingListConfirmSchema = z.object({
    date: z.string().min(1, '日付は必須です'),
    vehicleId: z.string().min(1, '車両IDは必須です'),
    items: z.array(z.object({
        materialItemId: z.string().min(1),
        projectMasterId: z.string().min(1),
        quantity: z.number().int().min(1),
    })).min(1, '材料を1つ以上指定してください'),
});

export const loadingCheckSchema = z.object({
    date: z.string().min(1, '日付は必須です'),
    vehicleId: z.string().min(1, '車両IDは必須です'),
    materialItemId: z.string().min(1, '材料IDは必須です'),
    projectMasterId: z.string().min(1, '案件IDは必須です'),
    isChecked: z.boolean().optional().default(false),
});

export const materialRequisitionCreateSchema = z.object({
    projectMasterId: z.string().min(1, '現場は必須です'),
    date: z.string().min(1, '日付は必須です'),
    foremanId: z.string().min(1, '職長IDは必須です'),
    foremanName: z.string().optional().default(''),
    type: z.string().optional().default('出庫'),
    status: z.string().optional().default('draft'),
    vehicleInfo: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    items: z.array(z.object({
        materialItemId: z.string().min(1),
        quantity: z.number().min(0),
        vehicleLabel: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
    })).min(1, '材料を1つ以上入力してください'),
});

export const materialRequisitionUpdateSchema = z.object({
    status: z.string().optional(),
    notes: z.string().max(2000).nullable().optional(),
    vehicleInfo: z.string().nullable().optional(),
    items: z.array(z.object({
        materialItemId: z.string().min(1),
        quantity: z.number().min(0),
        vehicleLabel: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
    })).optional(),
});

export const projectMaterialsUpdateSchema = z.object({
    items: z.array(z.object({
        materialItemId: z.string().min(1),
        requiredQuantity: z.number().min(0),
        notes: z.string().nullable().optional(),
    })),
});
