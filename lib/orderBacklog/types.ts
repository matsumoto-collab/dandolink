/**
 * 受注明細書（信用保証協会様式）の型と既定値。
 *
 * 金額はすべて **円** で持ち、出力（Excel / PDF）に出すときだけ千円へ丸める。
 * 千円で持ち回すと集約（区分行）の合計が1件ずつの丸め誤差を拾ってしまうため。
 */

/** 「未受領金額」列の定義。提出済みシートは 6 回とも 'remaining' で書かれている。 */
export type UnreceivedMode = 'remaining' | 'unpaid';

/** 契約額の出し方。'inclusive' は税抜の基準額に消費税を乗せる。 */
export type TaxMode = 'inclusive' | 'exclusive';

/** 工事の種類。区分集約の見出しに使う。 */
export type WorkKind = 'temp' | 'new';

/** 現場の種類。区分集約の見出しに使う。 */
export type SiteKind = 'house' | 'other';

/** 区分集約の金額帯。'mid' = 50万〜個別行の閾値 / 'low' = 〜50万。 */
export type BucketSize = 'mid' | 'low';

/** 区分集約のキー（8種）。 */
export type BucketKey = `${WorkKind}_${SiteKind}_${BucketSize}`;

/** 入金予定。キーは 'YYYY-MM' か 'later'（＝基準月+8以降）、値は円。 */
export type ScheduleMap = Record<string, number>;

/** この金額以上（円）は個別行として出す。 */
export const DEFAULT_INDIVIDUAL_THRESHOLD = 1000000;

/** 'mid'（50万〜）と 'low'（〜50万）の境界（円）。499,999→low / 500,000→mid。 */
export const BUCKET_MID_MIN_AMOUNT = 500000;

/** 入金予定の列数（基準月 m 〜 m+7 の 8 列＋「m+8月以降」の 1 列）。 */
export const SCHEDULE_COLUMN_COUNT = 9;

/** 様式1ページに載る明細の枠数（行10〜61 を 2 行 1 枠で使う）。 */
export const ROWS_PER_PAGE = 26;

/** 組立月へ寄せる既定の割合（％）。残りが解体月。 */
export const DEFAULT_ASSEMBLY_SHARE = 60;

/** 明細の1案件ぶん（画面・API・出力で共通に使う入力形）。 */
export interface OrderBacklogLineInput {
    id?: string;
    /** 論理FK（案件を消しても提出済みの行は残す） */
    projectMasterId: string | null;
    customerName: string;
    projectName: string;
    workKind: WorkKind;
    siteKind: SiteKind;
    /** 契約額（円） */
    contractAmount: number;
    /** 着工の年月 'YYYY-MM' */
    startYm: string | null;
    /** 完成予定の年月 'YYYY-MM' */
    endYm: string | null;
    /** 出来高（0〜100） */
    progressRate: number;
    /** 既受領金額（円） */
    receivedAmount: number;
    /** 入金予定（円） */
    schedule: ScheduleMap;
    /** 候補から外した（出力に出さない・集約にも入れない） */
    excluded: boolean;
    /** 検索から手で足した行 */
    isManual: boolean;
    note?: string | null;
    sortOrder: number;
}

/** 提出1回分の設定（明細は別に持つ）。 */
export interface OrderBacklogReportInput {
    /** 基準日 'YYYY-MM-DD' */
    asOfDate: string;
    title?: string | null;
    /** 申込人。空欄＝様式に手書きする運用 */
    applicantName?: string | null;
    individualThreshold: number;
    unreceivedMode: UnreceivedMode;
    taxMode: TaxMode;
    notes?: string | null;
}
