import { z } from 'zod';

/**
 * 安全書類（グリーンファイル）バリデーション。
 * 要件: docs/SAFETY_DOCUMENTS_REQUIREMENTS.md v1.2
 *
 * ⚠️ 法令上の禁止（要件§7.4）: 健康保険の記号・番号、基礎年金番号、マイナンバーの
 *    フィールドをこのスキーマに追加してはならない。全スキーマ .strict() なので、
 *    未知キーで送られてきた場合も 400 で弾かれる。雇用保険は下4桁のみ可。
 */

/** 空文字を null に正規化する任意文字列 */
const optionalString = (max: number) =>
    z.preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
        z.string().max(max).nullable().optional()
    );

/** 空文字/nullを許容する日付（date input の YYYY-MM-DD を想定） */
const optionalDate = z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.coerce.date().nullable().optional()
);

const optionalBoolean = z.boolean().nullable().optional();

/** 安全プロフィールの作成・更新（upsert）ボディ */
export const safetyProfileUpsertSchema = z
    .object({
        // ── 基本 ──
        furigana: optionalString(100),
        birthDate: optionalDate,
        gender: optionalString(10),
        jobType: optionalString(100),
        attributes: z.array(z.string().max(10)).max(30).optional(),
        hireDate: optionalDate,
        experienceYears: z.number().int().min(0).max(80).nullable().optional(),
        workerCategory: optionalString(50),
        // ── 連絡先 ──
        address: optionalString(300),
        tel: optionalString(50),
        familyContact: optionalString(200),
        familyTel: optionalString(50),
        // ── 健康 ──
        healthCheckDate: optionalDate,
        bloodPressure: optionalString(20),
        bloodType: optionalString(10),
        specialHealthCheckDate: optionalDate,
        specialHealthCheckType: optionalString(100),
        // ── 保険・建退共 ──
        healthInsurance: optionalString(50),
        pensionInsurance: optionalString(50),
        employmentInsurance: optionalString(50),
        employmentInsuranceLast4: z.preprocess(
            (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
            z
                .string()
                .regex(/^\d{4}$/, '雇用保険被保険者番号は下4桁のみ入力してください')
                .nullable()
                .optional()
        ),
        rosaiSpecialInsurance: optionalBoolean,
        kentaikyo: optionalBoolean,
        chutaikyo: optionalBoolean,
        kentaikyoTechou: optionalBoolean,
        // ── その他 ──
        ccusId: z.preprocess(
            (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
            z
                .string()
                .regex(/^\d{1,14}$/, 'CCUS技能者IDは数字（最大14桁）で入力してください')
                .nullable()
                .optional()
        ),
        notes: optionalString(1000),
    })
    .strict();

export type SafetyProfileUpsertInput = z.infer<typeof safetyProfileUpsertSchema>;

/** 資格・教育の追加ボディ（番号は修了証・免許証番号 — §7.4 の禁止対象ではない） */
export const qualificationCreateSchema = z
    .object({
        category: z.enum(['special_education', 'skill_training', 'license']),
        name: z.string().min(1, '資格・教育名は必須です').max(200),
        licenseNumber: optionalString(100),
        acquiredAt: optionalDate,
        expiresAt: optionalDate,
    })
    .strict();

export type QualificationCreateInput = z.infer<typeof qualificationCreateSchema>;

/** 名簿メンバー参照（スナップショットはサーバー側で生成するため参照のみ受ける） */
export const meiboMemberRefSchema = z
    .object({
        source: z.enum(['worker', 'user']),
        sourceId: z.string().min(1),
    })
    .strict();

export type MeiboMemberRef = z.infer<typeof meiboMemberRefSchema>;

/** 作業員名簿のヘッダー（書類単位の手入力項目） */
export const meiboHeaderSchema = z
    .object({
        primeContractor: z.string().max(200).default(''),
        primeSiteManager: z.string().max(100).default(''),
        siteName: z.string().max(200).default(''),
        tier: z.string().max(20).default(''),
        submitDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, '提出日は YYYY-MM-DD 形式で指定してください'),
        companyName: z.string().max(200).default(''),
        companyRepresentative: z.string().max(100).default(''),
        companyAddress: z.string().max(300).default(''),
    })
    .strict();

/** YYYY-MM-DD（空文字は null 扱い）の任意日付文字列 */
const optionalIsoDateString = z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で指定してください')
        .nullable()
);

/** 車両届の車両参照（運転者名は書類固有の入力） */
export const todokeVehicleRefSchema = z
    .object({
        vehicleId: z.string().min(1),
        driverName: z.string().max(100).default(''),
    })
    .strict();

/** 機械届の機械参照（取扱者名は書類固有の入力） */
export const todokeMachineRefSchema = z
    .object({
        machineId: z.string().min(1),
        operatorName: z.string().max(100).default(''),
    })
    .strict();

const documentBaseShape = {
    projectId: z.string().nullable().optional(),
    title: z.string().min(1, 'タイトルは必須です').max(200),
    header: meiboHeaderSchema,
} as const;

/** 安全書類の新規作成ボディ。data（スナップショット）はサーバーが生成する */
export const safetyDocumentCreateSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('sagyoin_meibo'),
            ...documentBaseShape,
            members: z.array(meiboMemberRefSchema).max(200),
        })
        .strict(),
    z
        .object({
            type: z.literal('vehicle_todoke'),
            ...documentBaseShape,
            periodFrom: optionalIsoDateString,
            periodTo: optionalIsoDateString,
            vehicles: z.array(todokeVehicleRefSchema).max(100),
        })
        .strict(),
    z
        .object({
            type: z.literal('kikai_todoke'),
            ...documentBaseShape,
            periodFrom: optionalIsoDateString,
            periodTo: optionalIsoDateString,
            machines: z.array(todokeMachineRefSchema).max(100),
        })
        .strict(),
    z
        .object({
            type: z.literal('crane_todoke'),
            ...documentBaseShape,
            periodFrom: optionalIsoDateString,
            periodTo: optionalIsoDateString,
            machines: z.array(todokeMachineRefSchema).max(100),
        })
        .strict(),
]);

export type SafetyDocumentCreateInput = z.infer<typeof safetyDocumentCreateSchema>;

const documentUpdateBaseShape = {
    projectId: z.string().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    header: meiboHeaderSchema.optional(),
} as const;

/**
 * 安全書類の更新ボディ（type は既存書類と一致必須）。
 * 対象リストを与えると既存スナップショットと突き合わせ、既存対象は据え置き・
 * 新規対象のみ現在のマスター値でスナップショット化する（FR-4-2 の決定性維持）。
 * 車両届の driverName / 機械届の operatorName は書類固有入力のため常に送信値を採用する。
 */
export const safetyDocumentUpdateSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('sagyoin_meibo'),
            ...documentUpdateBaseShape,
            members: z.array(meiboMemberRefSchema).max(200).optional(),
        })
        .strict(),
    z
        .object({
            type: z.literal('vehicle_todoke'),
            ...documentUpdateBaseShape,
            periodFrom: optionalIsoDateString.optional(),
            periodTo: optionalIsoDateString.optional(),
            vehicles: z.array(todokeVehicleRefSchema).max(100).optional(),
        })
        .strict(),
    z
        .object({
            type: z.literal('kikai_todoke'),
            ...documentUpdateBaseShape,
            periodFrom: optionalIsoDateString.optional(),
            periodTo: optionalIsoDateString.optional(),
            machines: z.array(todokeMachineRefSchema).max(100).optional(),
        })
        .strict(),
    z
        .object({
            type: z.literal('crane_todoke'),
            ...documentUpdateBaseShape,
            periodFrom: optionalIsoDateString.optional(),
            periodTo: optionalIsoDateString.optional(),
            machines: z.array(todokeMachineRefSchema).max(100).optional(),
        })
        .strict(),
]);

export type SafetyDocumentUpdateInput = z.infer<typeof safetyDocumentUpdateSchema>;

// ============================================
// Phase 2: 車両安全プロフィール・機械マスター
// ============================================

export const vehicleSafetyProfileUpsertSchema = z
    .object({
        vehicleType: optionalString(100),
        registrationNumber: optionalString(50),
        usage: optionalString(20),
        inspectionExpiry: optionalDate,
        jibaisekiCompany: optionalString(100),
        jibaisekiExpiry: optionalDate,
        insuranceCompany: optionalString(100),
        insuranceExpiry: optionalDate,
        insurancePersonal: optionalString(50),
        insuranceObjective: optionalString(50),
        insurancePassenger: optionalString(50),
        defaultDriverName: optionalString(100),
        notes: optionalString(1000),
    })
    .strict();

export type VehicleSafetyProfileUpsertInput = z.infer<typeof vehicleSafetyProfileUpsertSchema>;

export const machineSchema = z
    .object({
        name: z.string().min(1, '機械名は必須です').max(100),
        category: z.enum(['general', 'crane']),
        model: optionalString(100),
        serialNumber: optionalString(100),
        maker: optionalString(100),
        capacity: optionalString(100),
        ownerName: optionalString(100),
        defaultOperatorName: optionalString(100),
        inspectionDate: optionalDate,
        inspectionExpiry: optionalDate,
        certificateNumber: optionalString(100),
        notes: optionalString(1000),
        isActive: z.boolean().optional(),
    })
    .strict();

export const machineUpdateSchema = machineSchema.partial();

export type MachineInput = z.infer<typeof machineSchema>;

/** Excelインポート行（クライアントで列マッピング済みの構造化データ。ファイルは受けない） */
export const safetyImportRowSchema = z
    .object({
        name: z.string().min(1, '氏名は必須です').max(100),
        /** create-worker: Worker を新規作成して紐付け / update: 既存対象のプロフィールを更新 */
        action: z.enum(['create-worker', 'update']),
        targetSource: z.enum(['worker', 'user']).optional(),
        targetId: z.string().optional(),
        profile: safetyProfileUpsertSchema,
    })
    .strict()
    .refine((r) => r.action === 'create-worker' || (!!r.targetSource && !!r.targetId), {
        message: 'action=update には targetSource / targetId が必要です',
    });

export const safetyImportSchema = z
    .object({
        rows: z.array(safetyImportRowSchema).min(1, '取込対象がありません').max(500),
    })
    .strict();

export type SafetyImportInput = z.infer<typeof safetyImportSchema>;
