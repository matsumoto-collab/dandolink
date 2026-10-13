import { z } from 'zod';
import { ROAD_PERMIT_FORM_IDS, ROAD_PERMIT_STATUSES } from '@/types/roadPermit';
import { ROAD_PERMIT_CONTACTS_MAX } from '@/lib/roadPermit/contacts';

/**
 * 道路申請 API の入力検証（docs/指示書_道路申請_Phase1.md §5）。
 *
 * - 文字の欄は前後の空白を落としてから長さを見る（空は通す＝未入力）
 * - 日付は 'YYYY-MM-DD' か空。時刻は 'HH:mm' か空
 * - 知らないキーは落とす（z.object の既定）。欠けている欄は許さない（画面は常に全部送る。
 *   DB から読む側は lib/roadPermit/defaults.ts の normalize で埋める）
 */

const trimIfString = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

const text = (label: string, max: number) =>
    z.preprocess(trimIfString, z.string().max(max, `${label}は${max}文字以内で入力してください`));

const SHORT = 100;
const MEDIUM = 200;
const LONG = 500;

/** 'YYYY-MM-DD' かつ実在する日、または空 */
const ymdOrEmpty = (label: string) =>
    z.preprocess(
        trimIfString,
        z
            .string()
            .refine((s) => {
                if (s === '') return true;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
                const d = new Date(`${s}T00:00:00.000Z`);
                return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
            }, `${label}は YYYY-MM-DD 形式で指定してください`),
    );

/** 'HH:mm' または空 */
const hhmmOrEmpty = (label: string) =>
    z.preprocess(
        trimIfString,
        z.string().refine((s) => s === '' || /^([01]?\d|2[0-4]):[0-5]\d$/.test(s), `${label}は HH:mm 形式で指定してください`),
    );

const applicantSchema = z.object({
    postalCode: text('郵便番号', 20),
    address: text('住所', MEDIUM),
    companyName: text('会社名', SHORT),
    representativeTitle: text('代表者の肩書', 50),
    representativeName: text('代表者の氏名', SHORT),
    tel: text('電話', 30),
});

const contactSchema = z.object({
    name: text('担当者の氏名', SHORT),
    phone: text('担当者の連絡先', 30),
});

const siteManagerSchema = z.object({
    address: text('現場責任者の住所', MEDIUM),
    name: text('現場責任者の氏名', SHORT),
    phone: text('現場責任者の電話', 30),
});

const siteSchema = z.object({
    location: text('現場の場所', MEDIUM),
    projectName: text('案件名', MEDIUM),
});

const periodSchema = z.object({
    workFrom: ymdOrEmpty('工事期間（から）'),
    workTo: ymdOrEmpty('工事期間（まで）'),
    useFrom: ymdOrEmpty('占用期間（から）'),
    useTo: ymdOrEmpty('占用期間（まで）'),
    timeFrom: hhmmOrEmpty('時間（から）'),
    timeTo: hhmmOrEmpty('時間（まで）'),
    dayCount: z
        .number()
        .int('日数は整数で入力してください')
        .min(0, '日数は0以上で入力してください')
        .max(100_000, '日数が大きすぎます')
        .nullable(),
});

const roadSchema = z.object({
    routeName: text('路線名', MEDIUM),
    part: z.enum(['', 'roadway', 'sidewalk', 'other'], { message: '車道・歩道・その他のいずれかを選んでください' }),
    surface: z.enum(['', 'paved', 'gravel'], { message: '舗装道・砂利道のいずれかを選んでください' }),
    mapPage: text('住宅地図のページ', 50),
});

const occupancySchema = z.object({
    purpose: text('占用の目的', MEDIUM),
    name: text('占用物件の名称', SHORT),
    structure: text('占用物件の構造', SHORT),
    scaleNote: text('規模', SHORT),
    length: text('長さ', 30),
    width: text('幅', 30),
    quantity: text('数量', 30),
    areaApprox: z.preprocess(trimIfString, z.string().max(30, '面積は30文字以内で入力してください').nullable()),
    excavationLength: text('掘削の長さ', 30),
    excavationWidth: text('掘削の幅', 30),
    excavationArea: text('掘削面積', 30),
    constructionMethod: text('工事実施の方法', SHORT),
    restorationMethod: text('道路の復旧方法', MEDIUM),
});

const policeSchema = z.object({
    applicationDate: ymdOrEmpty('申請日（警察）'),
    stationName: text('宛先の警察署名', SHORT),
    purpose: text('道路使用の目的', MEDIUM),
    section: text('場所又は区間', MEDIUM),
    method: text('方法又は形態', LONG),
    attachments: text('添付書類（警察）', MEDIUM),
    conditionText: text('条件欄の文言', MEDIUM),
});

const matsuyamaSchema = z.object({
    applicationDate: ymdOrEmpty('申請日（松山市）'),
    mayorName: text('宛名（市長名）', SHORT),
    kind: z.enum(['permit', 'consult'], { message: '許可申請・協議のいずれかを選んでください' }),
    newOrChange: z.enum(['new', 'change'], { message: '新規・変更のいずれかを選んでください' }),
    article: z.enum(['32', '35'], { message: '第32条・第35条のいずれかを選んでください' }),
    previousPermitNo: text('従前の許可番号', SHORT),
    previousPermitDate: ymdOrEmpty('従前の許可年月日'),
    attachments: text('添付書類（松山市）', LONG),
});

export const roadPermitValuesSchema = z.object({
    applicant: applicantSchema,
    contact: contactSchema,
    siteManager: siteManagerSchema,
    site: siteSchema,
    period: periodSchema,
    road: roadSchema,
    occupancy: occupancySchema,
    police: policeSchema,
    matsuyama: matsuyamaSchema,
});

const documentEntrySchema = z.object({
    formId: z.enum(ROAD_PERMIT_FORM_IDS as unknown as [string, ...string[]], { message: '未知の様式です' }),
    enabled: z.boolean(),
    submittedDate: ymdOrEmpty('提出日'),
    permittedDate: ymdOrEmpty('許可日'),
    permitNo: text('許可番号', SHORT),
    expiryDate: ymdOrEmpty('許可期限'),
    attachmentChecks: z
        .array(z.object({ label: text('添付書類', MEDIUM), done: z.boolean() }))
        .max(50, '添付書類のチェックが多すぎます'),
});

export const roadPermitDocumentsSchema = z.object({
    forms: z.array(documentEntrySchema).max(20, '様式が多すぎます'),
});

/** POST /api/road-permits */
export const roadPermitCreateSchema = z.object({
    projectMasterId: z.string().min(1, '案件を選んでください').max(64),
    fromId: z.preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
        z.string().max(64).optional(),
    ),
});

// ---------------------------------------------------------------------------
// 図面（Phase 2・RoadPermit.drawing）
// 形の細かい正規化はサーバーの normalizeRoadPermitDrawing に任せ、ここでは
// 「壊れていないか」と「大きすぎないか」だけを見る（図形は最大 5,000 個・点は 1 図形 2,000 個まで）
// ---------------------------------------------------------------------------

const MM = z.number().finite();
const pointSchema = z.object({ x: MM, y: MM });
const pointsSchema = z.array(pointSchema).max(2000, '1 つの図形の点が多すぎます');
const styleSchema = z
    .object({
        lineType: z.enum(['solid', 'dashed', 'dashdot', 'dotted']).optional(),
        width: z.enum(['thin', 'normal', 'thick']).optional(),
        color: z.string().max(9).optional(),
    })
    .optional();
const entityBase = { id: z.string().max(64).optional(), layer: z.number().int().min(0).max(6).optional(), style: styleSchema };
const textHeight = z.number().finite().min(0.5).max(100).optional();

export const roadPermitDrawingEntitySchema = z.discriminatedUnion('kind', [
    z.object({ ...entityBase, kind: z.literal('line'), a: pointSchema, b: pointSchema }),
    z.object({ ...entityBase, kind: z.literal('polyline'), points: pointsSchema, closed: z.boolean().optional() }),
    z.object({ ...entityBase, kind: z.literal('circle'), center: pointSchema, r: MM }),
    z.object({ ...entityBase, kind: z.literal('arc'), center: pointSchema, r: MM, startDeg: MM, endDeg: MM }),
    z.object({
        ...entityBase,
        kind: z.literal('text'),
        at: pointSchema,
        text: z.string().max(500),
        heightPaperMm: textHeight,
        rotationDeg: MM.optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
    }),
    z.object({
        ...entityBase,
        kind: z.literal('dimension'),
        a: pointSchema,
        b: pointSchema,
        offsetMm: MM.optional(),
        mode: z.enum(['aligned', 'horizontal', 'vertical']).optional(),
        textOverride: z.string().max(100).nullable().optional(),
        heightPaperMm: textHeight,
    }),
    z.object({ ...entityBase, kind: z.literal('leader'), points: pointsSchema, text: z.string().max(500), heightPaperMm: textHeight }),
    z.object({
        ...entityBase,
        kind: z.literal('hatch'),
        points: pointsSchema,
        pattern: z.enum(['diagonal', 'cross', 'solid']).optional(),
        spacingPaperMm: z.number().finite().min(0.2).max(100).optional(),
    }),
    z.object({
        ...entityBase,
        kind: z.literal('symbol'),
        symbolId: z.string().max(64),
        at: pointSchema,
        rotationDeg: MM.optional(),
        mirrored: z.boolean().optional(),
    }),
]);

export const roadPermitDrawingSchema = z.object({
    version: z.literal(1),
    paper: z.object({ size: z.enum(['A4', 'A3']), orientation: z.enum(['landscape', 'portrait']) }),
    scale: z.number().int(),
    origin: pointSchema,
    layers: z
        .array(
            z.object({
                id: z.number().int().min(0).max(6),
                name: z.string().max(50).optional(),
                visible: z.boolean().optional(),
                locked: z.boolean().optional(),
                printable: z.boolean().optional(),
            }),
        )
        .max(7)
        .optional(),
    currentLayer: z.number().int().min(0).max(6).optional(),
    entities: z.array(roadPermitDrawingEntitySchema).max(5000, '図形が多すぎます（5,000 個まで）'),
    titleBlock: z
        .object({
            drawingName: z.string().max(100).optional(),
            location: z.string().max(200).optional(),
            routeName: z.string().max(200).optional(),
            period: z.string().max(100).optional(),
            author: z.string().max(100).optional(),
        })
        .optional(),
    showTitleBlock: z.boolean().optional(),
    showNorthArrow: z.boolean().optional(),
    showScaleBar: z.boolean().optional(),
});

/** PUT /api/road-permits/[id] */
export const roadPermitUpdateSchema = z.object({
    title: z.preprocess(
        trimIfString,
        z.string().min(1, '名前を入力してください').max(MEDIUM, `名前は${MEDIUM}文字以内で入力してください`),
    ),
    status: z.enum(ROAD_PERMIT_STATUSES as unknown as [string, ...string[]], { message: '状態が正しくありません' }),
    values: roadPermitValuesSchema,
    documents: roadPermitDocumentsSchema,
    /** 図面（Phase 2）。省略＝変えない／null＝消す */
    drawing: roadPermitDrawingSchema.nullable().optional(),
});

/** GET /api/road-permits?status=&projectMasterId= */
export const roadPermitsQuerySchema = z.object({
    status: z.preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
        z.enum(ROAD_PERMIT_STATUSES as unknown as [string, ...string[]], { message: '状態が正しくありません' }).optional(),
    ),
    projectMasterId: z.preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
        z.string().max(64).optional(),
    ),
});

// ---------------------------------------------------------------------------
// 設定（担当者の候補・RoadPermitSetting.contacts）
// ---------------------------------------------------------------------------

/** PUT /api/road-permits/settings  { contacts: [{ name, phone }] }。名前は必須・電話は空でもよい */
export const roadPermitSettingsSchema = z.object({
    contacts: z
        .array(
            z.object({
                name: z.preprocess(
                    trimIfString,
                    z
                        .string()
                        .min(1, '担当者の候補の名前を入れてください')
                        .max(SHORT, `担当者の候補の名前は${SHORT}文字以内で入力してください`),
                ),
                phone: text('担当者の候補の電話', 30),
            }),
        )
        .max(ROAD_PERMIT_CONTACTS_MAX, `担当者の候補は${ROAD_PERMIT_CONTACTS_MAX}人までです`),
});

export type RoadPermitCreateInput = z.infer<typeof roadPermitCreateSchema>;
export type RoadPermitSettingsInput = z.infer<typeof roadPermitSettingsSchema>;
export type RoadPermitUpdateInput = z.infer<typeof roadPermitUpdateSchema>;
export type RoadPermitsQueryInput = z.infer<typeof roadPermitsQuerySchema>;
