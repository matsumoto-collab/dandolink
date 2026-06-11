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

/** 資格・教育の追加ボディ */
export const qualificationCreateSchema = z
    .object({
        category: z.enum(['special_education', 'skill_training', 'license']),
        name: z.string().min(1, '資格・教育名は必須です').max(200),
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

/** 安全書類の新規作成ボディ。data（スナップショット）はサーバーが生成する */
export const safetyDocumentCreateSchema = z
    .object({
        type: z.literal('sagyoin_meibo'),
        projectId: z.string().nullable().optional(),
        title: z.string().min(1, 'タイトルは必須です').max(200),
        header: meiboHeaderSchema,
        members: z.array(meiboMemberRefSchema).max(200),
    })
    .strict();

export type SafetyDocumentCreateInput = z.infer<typeof safetyDocumentCreateSchema>;

/**
 * 安全書類の更新ボディ。
 * members を与えると既存スナップショットと突き合わせ、既存メンバーは据え置き・
 * 新規メンバーのみ現在のマスター値でスナップショット化する（FR-4-2 の決定性維持）。
 */
export const safetyDocumentUpdateSchema = z
    .object({
        projectId: z.string().nullable().optional(),
        title: z.string().min(1).max(200).optional(),
        header: meiboHeaderSchema.optional(),
        members: z.array(meiboMemberRefSchema).max(200).optional(),
    })
    .strict();

export type SafetyDocumentUpdateInput = z.infer<typeof safetyDocumentUpdateSchema>;

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
