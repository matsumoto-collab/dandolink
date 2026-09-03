import { z } from 'zod';

/**
 * 受注明細書（信用保証協会様式）API の入力検証（仕様書 §4）。
 *
 * 金額はすべて **円の整数**。千円への丸めは出力（Excel / PDF）側でやるので、
 * ここで小数を通すと保存値と表示値がずれる。
 */

/** 基準日 'YYYY-MM-DD'。 */
const ymdSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '基準日は YYYY-MM-DD 形式で指定してください');

/** 着工・完成予定の年月 'YYYY-MM'。 */
const ymSchema = z.string().regex(/^\d{4}-\d{2}$/, '年月は YYYY-MM 形式で指定してください');

/** 金額（円・0 以上の整数）。 */
const yenSchema = z
    .number()
    .int('金額は整数で指定してください')
    .min(0, '金額は0以上で指定してください')
    .max(999_999_999_999, '金額が大きすぎます');

/** 入金予定（キーは 'YYYY-MM' か 'later'、値は円）。 */
const scheduleSchema = z
    .record(z.string().regex(/^(\d{4}-\d{2}|later)$/, '入金予定のキーが不正です'), yenSchema)
    .refine((v) => Object.keys(v).length <= 60, { message: '入金予定の項目が多すぎます' });

/** 明細1行。 */
export const orderBacklogLineSchema = z.object({
    projectMasterId: z.string().max(64).nullable().optional().default(null),
    customerName: z.string().max(200, '契約先は200文字以内で入力してください'),
    projectName: z.string().max(200, '工事名は200文字以内で入力してください'),
    workKind: z.enum(['temp', 'new']).default('temp'),
    siteKind: z.enum(['house', 'other']).default('other'),
    contractAmount: yenSchema.default(0),
    startYm: ymSchema.nullable().optional().default(null),
    endYm: ymSchema.nullable().optional().default(null),
    progressRate: z
        .number()
        .int('出来高は整数で指定してください')
        .min(0, '出来高は0〜100で指定してください')
        .max(100, '出来高は0〜100で指定してください')
        .default(0),
    receivedAmount: yenSchema.default(0),
    schedule: scheduleSchema.nullable().optional().default({}),
    excluded: z.boolean().default(false),
    isManual: z.boolean().default(false),
    note: z.string().max(500, '備考は500文字以内で入力してください').nullable().optional().default(null),
    sortOrder: z.number().int().min(0).max(100000).default(0),
});

/** 明細の上限（様式は26枠×ページなので、これを超えるのは操作ミス）。 */
const MAX_LINES = 500;

/** レポート本体（作成・全置換で共通）。 */
export const orderBacklogReportSchema = z.object({
    asOfDate: ymdSchema,
    title: z.string().max(200, 'タイトルは200文字以内で入力してください').nullable().optional().default(null),
    applicantName: z
        .string()
        .max(200, '申込人は200文字以内で入力してください')
        .nullable()
        .optional()
        .default(null),
    individualThreshold: z
        .number()
        .int('閾値は整数で指定してください')
        .min(0, '閾値は0以上で指定してください')
        .max(999_999_999_999, '閾値が大きすぎます')
        .default(1_000_000),
    unreceivedMode: z.enum(['remaining', 'unpaid']).default('remaining'),
    taxMode: z.enum(['inclusive', 'exclusive']).default('inclusive'),
    notes: z.string().max(2000, 'メモは2000文字以内で入力してください').nullable().optional().default(null),
    lines: z.array(orderBacklogLineSchema).max(MAX_LINES, `明細は${MAX_LINES}件までです`).default([]),
});

export type OrderBacklogReportPayload = z.infer<typeof orderBacklogReportSchema>;
export type OrderBacklogLinePayload = z.infer<typeof orderBacklogLineSchema>;

/** GET /candidates のクエリ。 */
export const orderBacklogCandidatesQuerySchema = z.object({
    asOf: ymdSchema,
    taxMode: z.enum(['inclusive', 'exclusive']).default('inclusive'),
    /** カンマ区切りの案件ID。指定するとフィルタ無視でその案件だけ計算する */
    projectMasterIds: z.array(z.string().max(64)).max(MAX_LINES).optional(),
});
