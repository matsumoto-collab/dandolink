/**
 * 道路申請（道路使用許可・道路占用許可の申請書）の API ↔ 画面 ↔ PDF の型。
 *
 * 設計書: docs/道路申請_設計書.md（§5.1 のまとまり A〜F）／指示書: docs/指示書_道路申請_Phase1.md（§7）
 *
 * - 入力値 `RoadPermitValues` は RoadPermit.values（JSON）にそのまま入る。
 *   DB から読むときは lib/roadPermit/defaults.ts の normalizeRoadPermitValues を必ず通す
 *   （あとで欄が増えても、古い行に欠けている欄が空文字で埋まる）。
 * - 日付はすべて 'YYYY-MM-DD'（空文字 = 未入力）。時刻は 'HH:mm'。
 * - 様式（どの書類を出すか）は lib/roadPermit/forms/ のカタログ。ここでは id だけ持つ。
 */

import type { RoadPermitDrawing } from './roadPermitDrawing';

// ---------------------------------------------------------------------------
// 状態・様式の id
// ---------------------------------------------------------------------------

export type RoadPermitStatus = 'draft' | 'submitted' | 'permitted' | 'completed' | 'canceled';

export const ROAD_PERMIT_STATUSES: readonly RoadPermitStatus[] = [
    'draft',
    'submitted',
    'permitted',
    'completed',
    'canceled',
] as const;

export const ROAD_PERMIT_STATUS_LABELS: Record<RoadPermitStatus, string> = {
    draft: '下書き',
    submitted: '提出済み',
    permitted: '許可済み',
    completed: '完了',
    canceled: '取りやめ',
};

/**
 * 様式の id（lib/roadPermit/forms/ のカタログと対）。
 * - police-road-use           … 道路使用許可申請書（警察・別記様式第六）
 * - matsuyama-occupancy-apply … 道路占用 許可申請書／協議書（松山市・提出用）
 * - matsuyama-occupancy-reply … 道路占用 許可書／回答書（松山市・受け取り用）
 */
export type RoadPermitFormId = 'police-road-use' | 'matsuyama-occupancy-apply' | 'matsuyama-occupancy-reply';

export const ROAD_PERMIT_FORM_IDS: readonly RoadPermitFormId[] = [
    'police-road-use',
    'matsuyama-occupancy-apply',
    'matsuyama-occupancy-reply',
] as const;

// ---------------------------------------------------------------------------
// 入力値（values）
// ---------------------------------------------------------------------------

/** 車道／歩道／その他（松山市の「占用の場所」で ○ で囲む） */
export type RoadPart = '' | 'roadway' | 'sidewalk' | 'other';
/** 舗装道／砂利道 */
export type RoadSurface = '' | 'paved' | 'gravel';
/** 松山市: 許可申請 か 協議 か */
export type MatsuyamaKind = 'permit' | 'consult';
/** 松山市: 新規 か 変更 か */
export type MatsuyamaNewOrChange = 'new' | 'change';
/** 松山市: 道路法 第32条 か 第35条 か */
export type MatsuyamaArticle = '32' | '35';

/** A. 申請者（初期値は自社情報。申請ごとに上書きできる） */
export interface RoadPermitApplicant {
    postalCode: string;
    address: string;
    companyName: string;
    /** 代表者の肩書（例: 代表取締役） */
    representativeTitle: string;
    /** 代表者の氏名 */
    representativeName: string;
    tel: string;
}

/** 担当者（松山市の様式の「担当者・連絡先」。初期値は前回の申請） */
export interface RoadPermitContact {
    name: string;
    phone: string;
}

/** 現場責任者（警察の様式。初期値は前回の申請） */
export interface RoadPermitSiteManager {
    address: string;
    name: string;
    phone: string;
}

/** B. 現場（初期値は案件） */
export interface RoadPermitSite {
    /** 場所（地番まで）。警察の「場所又は区間」・松山市の「占用の場所」の初期値 */
    location: string;
    /** 案件名（表示用。様式には出さない） */
    projectName: string;
}

/** C. 期間・時間帯 */
export interface RoadPermitPeriod {
    /** 工事の期間（松山市） */
    workFrom: string;
    workTo: string;
    /** 占用（使用）の期間（松山市の「占用の期間」・警察の「期間」） */
    useFrom: string;
    useTo: string;
    /** 時間帯（警察の「期間」の「○時から○時まで」）。'HH:mm' */
    timeFrom: string;
    timeTo: string;
    /** 日数。null = 自動（初日と末日を含めて数える）。手で上書きしたら数が入る */
    dayCount: number | null;
}

/** D. 道路 */
export interface RoadPermitRoad {
    /** 路線名（例: 南北66号線） */
    routeName: string;
    part: RoadPart;
    surface: RoadSurface;
    /** 住宅地図のページ（「P.（　）」の中） */
    mapPage: string;
}

/** E. 占用物件（松山市） */
export interface RoadPermitOccupancy {
    /** 占用の目的（例: 建物改修工事に伴う足場設置） */
    purpose: string;
    /** 名称（例: 足場） */
    name: string;
    /** 構造（例: 鋼製足場） */
    structure: string;
    /** 規模の欄の文言（例: 別紙記入）。長さ×幅を書くときは空にして length / width を入れる */
    scaleNote: string;
    /** 規模の 長さ（m）・幅（m）。文字で持つ（小数の桁をそのまま出すため） */
    length: string;
    width: string;
    /** 数量（㎡）。文字で持つ（例: 0.9486） */
    quantity: string;
    /** 「約○㎡」の数。null = 自動（数量を切り上げ）。手で直したら文字が入る */
    areaApprox: string | null;
    /** 掘削面積（長さ・幅・面積）。通常は空 */
    excavationLength: string;
    excavationWidth: string;
    excavationArea: string;
    /** 工事実施の方法（例: 請負） */
    constructionMethod: string;
    /** 道路の復旧方法（通常は空） */
    restorationMethod: string;
}

/** F. 警察（道路使用許可申請書） */
export interface RoadPermitPoliceFields {
    /** 申請日。空なら「令和　年　月　日」と空けて印刷 */
    applicationDate: string;
    /** 宛先の警察署名（「殿」は付けない。例: 松山東警察署長） */
    stationName: string;
    /** 道路使用の目的 */
    purpose: string;
    /** 場所又は区間（初期値は現場の場所） */
    section: string;
    /** 方法又は形態 */
    method: string;
    /** 添付書類の欄の文言 */
    attachments: string;
    /** 許可証の「条件」欄に印字する文言（今の様式は「別紙の通り」） */
    conditionText: string;
}

/** 松山市（道路占用 許可申請書／協議書・許可書／回答書） */
export interface RoadPermitMatsuyamaFields {
    /** 申請日。空なら「令和　年　月　日」と空けて印刷 */
    applicationDate: string;
    /** 宛名（道路管理者。例: 松山市長　野志　克仁） */
    mayorName: string;
    kind: MatsuyamaKind;
    newOrChange: MatsuyamaNewOrChange;
    article: MatsuyamaArticle;
    /** 変更のときの従前の許可番号・年月日 */
    previousPermitNo: string;
    previousPermitDate: string;
    /** 添付書類の欄の文言 */
    attachments: string;
}

export interface RoadPermitValues {
    applicant: RoadPermitApplicant;
    contact: RoadPermitContact;
    siteManager: RoadPermitSiteManager;
    site: RoadPermitSite;
    period: RoadPermitPeriod;
    road: RoadPermitRoad;
    occupancy: RoadPermitOccupancy;
    police: RoadPermitPoliceFields;
    matsuyama: RoadPermitMatsuyamaFields;
}

// ---------------------------------------------------------------------------
// 様式ごとの記録（documents）
// ---------------------------------------------------------------------------

export interface RoadPermitAttachmentCheck {
    label: string;
    done: boolean;
}

export interface RoadPermitDocumentEntry {
    formId: RoadPermitFormId;
    /** この様式を出す（PDF に入れる）か */
    enabled: boolean;
    /** 提出日・許可日・許可番号・許可期限（'YYYY-MM-DD'。空 = 未入力） */
    submittedDate: string;
    permittedDate: string;
    permitNo: string;
    expiryDate: string;
    /** 添付書類のチェックリスト（初期値は様式カタログの文言から） */
    attachmentChecks: RoadPermitAttachmentCheck[];
}

export interface RoadPermitDocuments {
    forms: RoadPermitDocumentEntry[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** 自社情報から取り出す既定値（GET 一覧で一緒に返す） */
export interface RoadPermitCompanyDefaults {
    postalCode: string;
    address: string;
    name: string;
    representativeTitle: string;
    representative: string;
    tel: string;
    contactPerson: string;
}

/** 案件から取り出す既定値の元（サーバーで ProjectMaster から作る） */
export interface RoadPermitProjectSource {
    id: string;
    title: string;
    location: string | null;
    prefecture: string | null;
    city: string | null;
    /** 'YYYY-MM-DD'（JST）か null */
    scheduledStartDate: string | null;
    scheduledEndDate: string | null;
}

export interface RoadPermitDto {
    id: string;
    projectMasterId: string | null;
    /** 案件名（案件が消えていれば null） */
    projectTitle: string | null;
    title: string;
    status: RoadPermitStatus;
    values: RoadPermitValues;
    documents: RoadPermitDocuments;
    /** 図面（Phase 2）。まだ描いていなければ null */
    drawing: RoadPermitDrawing | null;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: string;
    updatedAt: string;
}

/** 一覧の 1 行 */
export interface RoadPermitListItem {
    id: string;
    projectMasterId: string | null;
    projectTitle: string | null;
    title: string;
    status: RoadPermitStatus;
    /** 申請先（出す様式から。例: ['松山東署', '松山市']） */
    authorities: string[];
    /** 占用（使用）期間 */
    useFrom: string;
    useTo: string;
    /** 許可期限（出す様式のうち、いちばん遅い日。無ければ null） */
    expiryDate: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface RoadPermitsListResponse {
    permits: RoadPermitListItem[];
    company: RoadPermitCompanyDefaults | null;
    /** 前回の申請（いちばん新しく作ったもの）の入力値。無ければ null */
    previous: RoadPermitValues | null;
}

/** POST /api/road-permits */
export interface RoadPermitCreatePayload {
    projectMasterId: string;
    /** コピー元の申請の id（「この申請をコピーして作る」） */
    fromId?: string;
}

/** PUT /api/road-permits/[id] */
export interface RoadPermitUpdatePayload {
    title: string;
    status: RoadPermitStatus;
    values: RoadPermitValues;
    documents: RoadPermitDocuments;
    /** 図面。省略＝変えない／null＝消す */
    drawing?: RoadPermitDrawing | null;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** PDF を作るときの入力（utils/roadPermitPdf.tsx）。formIds の順に 1 つの PDF へ入れ、最後に図面（includeDrawing のとき） */
export interface RoadPermitPdfInput {
    values: RoadPermitValues;
    formIds: RoadPermitFormId[];
    /** 図面（Phase 2）。無ければ省略 */
    drawing?: RoadPermitDrawing | null;
    /** 図面のページを最後に入れるか（図形が 1 つも無ければ入れない） */
    includeDrawing?: boolean;
}
