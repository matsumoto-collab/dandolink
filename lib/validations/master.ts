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
    totalMembers: z.number().int().min(1, 'totalMembersは1以上の数値が必要です').optional(),
    subcontractorRevenueRate: z.number().int().min(0).max(100).optional(),
    subcontractorAssemblyRate: z.number().int().min(0).max(100).optional(),
    subcontractorDemolitionRate: z.number().int().min(0).max(100).optional(),
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
    // C8（#1 解消 / 在庫リワーク不変条件）:
    //   伝票の新規作成は常に draft でなければならない。
    //   loaded への遷移（= 在庫減算 + InventoryTransaction 発行）は
    //   [id] PATCH / loading-list/confirm の「ヘルパ経由」経路のみで起こせる
    //   という不変条件をバリデーション層で構造的に強制する。
    //   これを許すと任意の認証ユーザーが POST {status:'loaded'} で
    //   台帳・在庫減算ゼロの loaded 伝票を作れてしまう（#1 C6 POST 迂回）。
    //   draft 以外（'loaded' 等）が渡された場合は 400 で拒否する
    //   （optional のときのみ 'draft' を補完）。
    status: z.literal('draft').optional().default('draft'),
    vehicleInfo: z.string().nullable().optional(),
    // notes は構造化 JSON（memo / sheets / freeForm）も格納するため上限を拡大
    notes: z.string().max(8000).nullable().optional(),
    items: z.array(z.object({
        materialItemId: z.string().min(1),
        quantity: z.number().min(0),
        vehicleLabel: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
    })).min(1, '材料を1つ以上入力してください'),
});

export const materialRequisitionUpdateSchema = z.object({
    // C15（C8 の対称穴）:
    //   PATCH の status は実在の有効状態集合のみ許可する。
    //   出庫伝票の状態は draft（下書き）/ loaded（積込完了）の 2 値のみ
    //   （schema default='draft'、loading-list/confirm が 'loaded' を発行、
    //   route.ts の遷移判定も draft↔loaded のみを扱う。返却伝票は
    //   type='返却' で表現され status 集合は出庫と共通の draft/loaded）。
    //   z.string() のままだと PATCH {status:'archived'} 等の任意文字列を
    //   そのまま MaterialRequisition.status へ書き込めてしまい、
    //   在庫連動の遷移判定（enteringLoaded/leavingLoaded）を素通りした
    //   不正状態を作れる（C8 の POST 側強制と非対称な穴）。
    //   許可外は 400 で拒否する。正規 draft↔loaded 遷移は不変。
    status: z.enum(['draft', 'loaded']).optional(),
    // notes は構造化 JSON（memo / sheets / freeForm）も格納するため上限を拡大
    notes: z.string().max(8000).nullable().optional(),
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
