import { z } from 'zod';

export const costMasterSchema = z.object({
    name: z.string().min(1, '名前は必須です').max(100),
    quantity: z.number().nullable().optional(),
    unit: z.string().max(50).nullable().optional(),
    unitPrice: z.number().nullable().optional(),
});

// 仕入請求書の費目マスタ。costBucket で原価エンジンの集計先を指定する。
export const expenseCategorySchema = z.object({
    name: z.string().min(1, '費目名は必須です').max(100),
    costBucket: z.enum(['material', 'other', 'loading']).optional().default('other'),
    sortOrder: z.number().int().optional().default(0),
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
    // C15（C8 の対称穴）/ D1 訂正:
    //   PATCH の status は実在の有効状態集合のみ許可する。
    //   出庫伝票の状態は draft（下書き）/ confirmed（確定）/ loaded
    //   （積込完了）の 3 値。status 集合の唯一の正は
    //   types/material.ts:33,63 と MaterialRequisitionPage.tsx の
    //   STATUS_LABELS（draft / confirmed / loaded）であり、ここで独自に
    //   再導出しない。返却伝票は type='返却' で表現され status 集合は
    //   出庫と共通（draft / confirmed / loaded）。
    //   旧 z.enum(['draft','loaded']) は正規 confirmed を脱落させ、
    //   「確定」操作（PATCH {status:'confirmed'}）を全て 400 で弾き、
    //   どの伝票も confirmed に到達不能 →「積込完了」ボタンが永久に
    //   描画されず Phase3 の在庫減算ワークフローが正規 UI から到達
    //   不能になっていた（D1 ブロッカー）。3 値へ訂正する。
    //   z.string() のままだと PATCH {status:'archived'} 等の任意文字列を
    //   そのまま MaterialRequisition.status へ書き込めてしまい、
    //   在庫連動の遷移判定（enteringLoaded/leavingLoaded）を素通りした
    //   不正状態を作れる（C8 の POST 側強制と非対称な穴）。
    //   許可外は 400 で拒否する。正規 draft↔confirmed↔loaded 遷移は不変。
    status: z.enum(['draft', 'confirmed', 'loaded']).optional(),
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

// 返却（現場 → 倉庫の入庫）。専用エンドポイント POST /api/materials/returns 用。
// type='返却' の MaterialRequisition を loaded で作成し在庫を加算する。
// quantity はサーバ側で当該案件の貸出中（出庫−返却−紛失）を上限にクランプする。
export const materialReturnSchema = z.object({
    projectMasterId: z.string().min(1, '現場は必須です'),
    date: z.string().min(1).optional(),
    note: z.string().max(2000).nullable().optional(),
    items: z.array(z.object({
        materialItemId: z.string().min(1),
        quantity: z.number().int().min(0),
    })).min(1, '返却する材料がありません'),
});

// 未回収（紛失・破損）償却。専用エンドポイント POST /api/materials/write-off 用。
// type='紛失' の MaterialRequisition を loaded で作成し貸出中から除外する
// （倉庫在庫は出庫時に減算済みのため触らない）。admin / manager のみ。
export const materialWriteOffSchema = z.object({
    projectMasterId: z.string().min(1, '現場は必須です'),
    date: z.string().min(1).optional(),
    note: z.string().max(2000).nullable().optional(),
    items: z.array(z.object({
        materialItemId: z.string().min(1),
        quantity: z.number().int().min(1),
    })).min(1, '償却する材料がありません'),
});
