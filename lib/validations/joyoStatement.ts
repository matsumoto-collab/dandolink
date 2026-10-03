import { z } from 'zod';
import { JOYO_LIMITS } from '@/lib/joyoStatement';

/**
 * 支払明細書（常用で来ている一人親方向け）API の入力検証（指示書 6章）。
 *
 * - 上限は JOYO_LIMITS（PDF の1ページ目に収まる大きさ）をそのまま使う。画面・PDF と同じ数字にするため
 * - 文字の項目は前後の空白を落としてから検証する（空白だけの品名・宛名を通さない）
 * - 画面から来た金額（amount・total・tax）は受け取らない（z.object は知らないキーを落とす）。
 *   金額はサーバーで lib/joyoStatement の recalcItems → computeJoyoTotals を通して出し直す
 */

/** 文字なら前後の空白を落とす（それ以外はそのまま次の検証へ渡す） */
const trimIfString = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

/** 前後の空白を落とし、空文字は null にする（任意の文字項目用） */
const trimToNull = (v: unknown) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    return t === '' ? null : t;
};

/** 'YYYY-MM-DD' かつ実在する日（2026-02-31 などを通さない） */
const ymdSchema = (label: string) =>
    z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}は YYYY-MM-DD 形式で指定してください`)
        .refine((ymd) => {
            const d = new Date(`${ymd}T00:00:00.000Z`);
            return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
        }, `${label}が正しい日付ではありません`);

const yearSchema = z
    .number()
    .int('年は整数で指定してください')
    .min(2020, '年は2020〜2100で指定してください')
    .max(2100, '年は2020〜2100で指定してください');

const monthSchema = z
    .number()
    .int('月は整数で指定してください')
    .min(1, '月は1〜12で指定してください')
    .max(12, '月は1〜12で指定してください');

/** GET /api/joyo-statements?year=&month=（クエリは文字なので数に直してから検証） */
export const joyoStatementsQuerySchema = z.object({
    year: z.coerce.number().pipe(yearSchema),
    month: z.coerce.number().pipe(monthSchema),
});

/** 日数（1か月ぶん。0〜31 の整数） */
const dayCountSchema = z
    .number()
    .int('日数は整数で指定してください')
    .min(0, '日数は0〜31で指定してください')
    .max(31, '日数は0〜31で指定してください');

/** 明細1行（amount は受け取らない） */
export const joyoStatementItemSchema = z.object({
    kind: z.enum(['full', 'holiday_work', 'night_shift', 'manual']),
    name: z.preprocess(
        trimIfString,
        z
            .string()
            .min(1, '品名を入力してください')
            .max(JOYO_LIMITS.nameLength, `品名は${JOYO_LIMITS.nameLength}文字以内で入力してください`),
    ),
    quantity: z
        .number()
        .min(0, `数量は0〜${JOYO_LIMITS.maxQuantity}で入力してください`)
        .max(JOYO_LIMITS.maxQuantity, `数量は0〜${JOYO_LIMITS.maxQuantity}で入力してください`),
    unit: z.preprocess(
        trimIfString,
        z.string().max(JOYO_LIMITS.unitLength, `単位は${JOYO_LIMITS.unitLength}文字以内で入力してください`),
    ),
    unitPrice: z
        .number()
        .int('単価は整数で入力してください')
        .min(-JOYO_LIMITS.maxUnitPrice, '単価が大きすぎます')
        .max(JOYO_LIMITS.maxUnitPrice, '単価が大きすぎます'),
    note: z.preprocess(
        trimIfString,
        z.string().max(JOYO_LIMITS.noteLength, `備考は${JOYO_LIMITS.noteLength}文字以内で入力してください`),
    ),
});

/** PUT /api/joyo-statements（下書き保存）と POST /api/joyo-statements/issue（保存して発行）の入力 */
export const joyoStatementSaveSchema = z.object({
    contractorId: z.string().min(1, '対象者を指定してください').max(64),
    year: yearSchema,
    month: monthSchema,
    issueDate: ymdSchema('発行日'),
    paymentDate: ymdSchema('支払日'),
    subject: z.preprocess(
        trimIfString,
        z.string().max(JOYO_LIMITS.subjectLength, `件名は${JOYO_LIMITS.subjectLength}文字以内で入力してください`),
    ),
    items: z
        .array(joyoStatementItemSchema)
        .min(1, '明細を1行以上入力してください')
        .max(JOYO_LIMITS.maxItems, `明細は${JOYO_LIMITS.maxItems}行までです`),
    includeAttendance: z.boolean(),
    notes: z.preprocess(
        trimToNull,
        z.string().max(2000, 'メモは2000文字以内で入力してください').nullable().optional(),
    ),
    /** 編集画面に出ていた日数（明細の attendanceCounts にこの値を入れる） */
    seenCounts: z.object({
        present: dayCountSchema,
        holidayWork: dayCountSchema,
        nightShift: dayCountSchema,
    }),
});

export type JoyoStatementSavePayload = z.infer<typeof joyoStatementSaveSchema>;

// ---------------------------------------------------------------------------
// 対象者（POST /api/joyo-statements/contractors・PATCH /api/joyo-statements/contractors/[id]）
// ---------------------------------------------------------------------------

const recipientNameSchema = z.preprocess(
    trimIfString,
    z
        .string()
        .min(1, '宛名を入力してください')
        .max(
            JOYO_LIMITS.recipientNameLength,
            `宛名は${JOYO_LIMITS.recipientNameLength}文字以内で入力してください`,
        ),
);

const honorificSchema = z.enum(['御中', '様'], { message: '敬称は「御中」か「様」を選んでください' });

/** 郵便番号: 頭の「〒」は落として保存する（PDF 側で「〒」を付けるため。付いたまま入れても二重にしない） */
const postalCodeSchema = z.preprocess(
    (v) => {
        if (typeof v !== 'string') return v;
        const t = v.trim().replace(/^〒\s*/, '').trim();
        return t === '' ? null : t;
    },
    z.string().max(10, '郵便番号は10文字以内で入力してください').nullable().optional(),
);

const addressSchema = z.preprocess(
    trimToNull,
    z
        .string()
        .max(JOYO_LIMITS.addressLength, `住所は${JOYO_LIMITS.addressLength}文字以内で入力してください`)
        .nullable()
        .optional(),
);

/** インボイスの登録番号: 全角は半角に直して（NFKC）から「T＋数字13桁」を検証。空は null（登録していない人） */
const registrationNumberSchema = z.preprocess(
    (v) => {
        if (typeof v !== 'string') return v;
        const t = v.normalize('NFKC').trim().toUpperCase();
        return t === '' ? null : t;
    },
    z
        .string()
        .regex(/^T\d{13}$/, '登録番号は「T」と数字13桁で入力してください')
        .nullable()
        .optional(),
);

const contractorUnitPriceSchema = z
    .number()
    .int('単価は整数で入力してください')
    .min(0, '単価は0以上で入力してください')
    .max(JOYO_LIMITS.maxUnitPrice, '単価が大きすぎます');

const payeeIdSchema = z.preprocess(trimToNull, z.string().max(64).nullable().optional());

const contractorNotesSchema = z.preprocess(
    trimToNull,
    z.string().max(500, 'メモは500文字以内で入力してください').nullable().optional(),
);

/** 対象者を足す（userId はあとから変えられない） */
export const joyoContractorCreateSchema = z.object({
    userId: z.string().min(1, '出勤簿の名前を選んでください').max(64),
    recipientName: recipientNameSchema,
    honorific: honorificSchema.default('御中'),
    postalCode: postalCodeSchema,
    address: addressSchema,
    registrationNumber: registrationNumberSchema,
    unitPrice: contractorUnitPriceSchema,
    payeeId: payeeIdSchema,
    notes: contractorNotesSchema,
});

/** 対象者を直す（送られてきた項目だけ変える。userId は受け取らない） */
export const joyoContractorUpdateSchema = z.object({
    recipientName: recipientNameSchema.optional(),
    honorific: honorificSchema.optional(),
    postalCode: postalCodeSchema,
    address: addressSchema,
    registrationNumber: registrationNumberSchema,
    unitPrice: contractorUnitPriceSchema.optional(),
    payeeId: payeeIdSchema,
    isActive: z.boolean().optional(),
    notes: contractorNotesSchema,
});

export type JoyoContractorCreatePayload = z.infer<typeof joyoContractorCreateSchema>;
export type JoyoContractorUpdatePayload = z.infer<typeof joyoContractorUpdateSchema>;

// ---------------------------------------------------------------------------
// 共通設定（PUT /api/joyo-statements/settings）
// ---------------------------------------------------------------------------

export const joyoSettingsSchema = z.object({
    title: z.preprocess(
        trimIfString,
        z
            .string()
            .min(1, '書類の名前を入力してください')
            .max(JOYO_LIMITS.titleLength, `書類の名前は${JOYO_LIMITS.titleLength}文字以内で入力してください`),
    ),
    /** 改行は LF にそろえ、前後の空白・空行は落とす。PDF に出せるのは footerLines 行まで */
    footerNote: z.preprocess(
        (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : v),
        z
            .string()
            .max(JOYO_LIMITS.footerLength, `注意書きは${JOYO_LIMITS.footerLength}文字以内で入力してください`)
            .refine(
                (s) => s === '' || s.split('\n').length <= JOYO_LIMITS.footerLines,
                `注意書きは${JOYO_LIMITS.footerLines}行までです`,
            ),
    ),
});

export type JoyoSettingsPayload = z.infer<typeof joyoSettingsSchema>;
