/**
 * 道路申請の入力値（values）・様式の記録（documents）の既定値の組み立てと、DB から読んだ JSON の正規化。
 * 純粋関数だけ（DB は読まない）。サーバーからも画面からも使う。
 *
 * 自動入力の決まり（docs/指示書_道路申請_Phase1.md §7）
 * - 申請者 … 自社情報（申請ごとに上書きできる。自社情報の値は初期値として入れるだけ）
 * - 担当者 … 前回の申請（前回が空なら候補の 1 人目・無ければ空）※候補は RoadPermitSetting.contacts
 * - 現場責任者（警察） … 氏名・電話は前回の申請（前回が空なら担当者と同じ）。住所は前回の申請（前回が空なら自社情報の住所）
 *   （docs/指示書_道路申請_担当者の選択と住所.md §3.4。既にある申請は開いても変えない＝既定値は新しく作るときだけ）
 * - 現場 … 案件の location（無ければ prefecture＋city）・title
 * - 期間 … 案件の scheduledStartDate / scheduledEndDate。時間は 9:00〜17:00
 * - 道路 … 空
 * - 占用物件 … 目的「建物改修工事に伴う足場設置」・名称「足場」・構造「鋼製足場」・方法「請負」（前回があれば前回）
 * - 警察 … 宛先「松山東警察署長」・添付書類「位置図・現地写真・平面図（保安図）」・条件欄「別紙の通り」（前回があれば前回）
 * - 松山市 … 宛名「松山市長　野志　克仁」・許可申請・新規・第32条・添付書類の文言（前回があれば前回）
 */
import type {
    RoadPermitApplicant,
    RoadPermitCompanyDefaults,
    RoadPermitContact,
    RoadPermitContactPreset,
    RoadPermitDocumentEntry,
    RoadPermitDocuments,
    RoadPermitFormId,
    RoadPermitMatsuyamaFields,
    RoadPermitOccupancy,
    RoadPermitPeriod,
    RoadPermitPoliceFields,
    RoadPermitProjectSource,
    RoadPermitRoad,
    RoadPermitSite,
    RoadPermitSiteManager,
    RoadPermitStatus,
    RoadPermitValues,
    RoadPart,
    RoadSurface,
    MatsuyamaArticle,
    MatsuyamaKind,
    MatsuyamaNewOrChange,
} from '@/types/roadPermit';
import { ROAD_PERMIT_FORM_IDS, ROAD_PERMIT_STATUSES } from '@/types/roadPermit';
import { ROAD_PERMIT_FORMS, getRoadPermitForm, isRoadPermitFormId, sortFormIds } from './forms';
import { isContactBlank } from './contacts';

// ---------------------------------------------------------------------------
// 既定の文言
// ---------------------------------------------------------------------------

export const ROAD_PERMIT_TEXT_DEFAULTS = {
    occupancyPurpose: '建物改修工事に伴う足場設置',
    occupancyName: '足場',
    occupancyStructure: '鋼製足場',
    occupancyScaleNote: '別紙記入',
    constructionMethod: '請負',
    policeStation: getRoadPermitForm('police-road-use').defaultRecipient,
    policeAttachments: getRoadPermitForm('police-road-use').defaultAttachments,
    policeCondition: '別紙の通り',
    matsuyamaMayor: getRoadPermitForm('matsuyama-occupancy-apply').defaultRecipient,
    matsuyamaAttachments: getRoadPermitForm('matsuyama-occupancy-apply').defaultAttachments,
    timeFrom: '09:00',
    timeTo: '17:00',
} as const;

// ---------------------------------------------------------------------------
// 空の値
// ---------------------------------------------------------------------------

export function emptyApplicant(): RoadPermitApplicant {
    return { postalCode: '', address: '', companyName: '', representativeTitle: '', representativeName: '', tel: '' };
}
export function emptyContact(): RoadPermitContact {
    return { name: '', phone: '' };
}
export function emptySiteManager(): RoadPermitSiteManager {
    return { address: '', name: '', phone: '' };
}
export function emptySite(): RoadPermitSite {
    return { location: '', projectName: '' };
}
export function emptyPeriod(): RoadPermitPeriod {
    return { workFrom: '', workTo: '', useFrom: '', useTo: '', timeFrom: '', timeTo: '', dayCount: null };
}
export function emptyRoad(): RoadPermitRoad {
    return { routeName: '', part: '', surface: '', mapPage: '' };
}
export function emptyOccupancy(): RoadPermitOccupancy {
    return {
        purpose: '',
        name: '',
        structure: '',
        scaleNote: '',
        length: '',
        width: '',
        quantity: '',
        areaApprox: null,
        excavationLength: '',
        excavationWidth: '',
        excavationArea: '',
        constructionMethod: '',
        restorationMethod: '',
    };
}
export function emptyPolice(): RoadPermitPoliceFields {
    return { applicationDate: '', stationName: '', purpose: '', section: '', method: '', attachments: '', conditionText: '' };
}
export function emptyMatsuyama(): RoadPermitMatsuyamaFields {
    return {
        applicationDate: '',
        mayorName: '',
        kind: 'permit',
        newOrChange: 'new',
        article: '32',
        previousPermitNo: '',
        previousPermitDate: '',
        attachments: '',
    };
}

export function emptyRoadPermitValues(): RoadPermitValues {
    return {
        applicant: emptyApplicant(),
        contact: emptyContact(),
        siteManager: emptySiteManager(),
        site: emptySite(),
        period: emptyPeriod(),
        road: emptyRoad(),
        occupancy: emptyOccupancy(),
        police: emptyPolice(),
        matsuyama: emptyMatsuyama(),
    };
}

// ---------------------------------------------------------------------------
// 既定値の組み立て
// ---------------------------------------------------------------------------

/** 案件の現場の場所: location（無ければ 都道府県＋市区町村） */
export function projectLocationOf(project: RoadPermitProjectSource | null): string {
    if (!project) return '';
    const loc = (project.location ?? '').trim();
    if (loc) return loc;
    return `${(project.prefecture ?? '').trim()}${(project.city ?? '').trim()}`;
}

function applicantFromCompany(company: RoadPermitCompanyDefaults | null): RoadPermitApplicant {
    if (!company) return emptyApplicant();
    return {
        postalCode: company.postalCode,
        address: company.address,
        companyName: company.name,
        representativeTitle: company.representativeTitle,
        representativeName: company.representative,
        tel: company.tel,
    };
}

function siteFromProject(project: RoadPermitProjectSource | null): RoadPermitSite {
    return { location: projectLocationOf(project), projectName: project?.title ?? '' };
}

function periodFromProject(project: RoadPermitProjectSource | null): RoadPermitPeriod {
    const from = project?.scheduledStartDate ?? '';
    const to = project?.scheduledEndDate ?? '';
    return {
        workFrom: from,
        workTo: to,
        useFrom: from,
        useTo: to,
        timeFrom: ROAD_PERMIT_TEXT_DEFAULTS.timeFrom,
        timeTo: ROAD_PERMIT_TEXT_DEFAULTS.timeTo,
        dayCount: null,
    };
}

/** 前回の値があればそれ、無ければ既定 */
const pick = (previous: string | undefined, fallback: string): string => (previous && previous.trim() ? previous : fallback);

export interface BuildDefaultValuesInput {
    company: RoadPermitCompanyDefaults | null;
    project: RoadPermitProjectSource | null;
    /** 前回の申請の入力値（いちばん新しく作ったもの）。無ければ null */
    previous: RoadPermitValues | null;
    /** 担当者の候補（RoadPermitSetting.contacts・並び順）。無ければ省略 */
    contacts?: readonly RoadPermitContactPreset[];
}

/** 新しく作るときの入力値 */
export function buildDefaultRoadPermitValues(input: BuildDefaultValuesInput): RoadPermitValues {
    const { company, project, previous } = input;
    const contacts = input.contacts ?? [];
    const prev = previous ? normalizeRoadPermitValues(previous) : null;
    const location = projectLocationOf(project);

    // 担当者: 前回の申請（氏名・電話とも空なら無いものとみなす）→ 候補の 1 人目 → 空
    const prevContact = prev && !isContactBlank(prev.contact) ? prev.contact : null;
    const contact: RoadPermitContact = prevContact
        ? { name: prevContact.name, phone: prevContact.phone }
        : contacts.length > 0
          ? { name: contacts[0].name, phone: contacts[0].phone }
          : emptyContact();

    // 現場責任者: 氏名・電話は前回（空なら担当者と同じ）。住所は前回（空なら自社情報の住所）
    const prevManager = prev?.siteManager ?? null;
    const managerPerson =
        prevManager && !isContactBlank(prevManager)
            ? { name: prevManager.name, phone: prevManager.phone }
            : { name: contact.name, phone: contact.phone };
    const siteManager: RoadPermitSiteManager = {
        address: pick(prevManager?.address, company?.address ?? ''),
        ...managerPerson,
    };

    const occupancy: RoadPermitOccupancy = {
        ...emptyOccupancy(),
        purpose: pick(prev?.occupancy.purpose, ROAD_PERMIT_TEXT_DEFAULTS.occupancyPurpose),
        name: pick(prev?.occupancy.name, ROAD_PERMIT_TEXT_DEFAULTS.occupancyName),
        structure: pick(prev?.occupancy.structure, ROAD_PERMIT_TEXT_DEFAULTS.occupancyStructure),
        scaleNote: prev ? prev.occupancy.scaleNote : ROAD_PERMIT_TEXT_DEFAULTS.occupancyScaleNote,
        constructionMethod: pick(prev?.occupancy.constructionMethod, ROAD_PERMIT_TEXT_DEFAULTS.constructionMethod),
        restorationMethod: prev?.occupancy.restorationMethod ?? '',
    };

    const police: RoadPermitPoliceFields = {
        applicationDate: '',
        stationName: pick(prev?.police.stationName, ROAD_PERMIT_TEXT_DEFAULTS.policeStation),
        purpose: prev?.police.purpose ?? '',
        section: location,
        method: prev?.police.method ?? '',
        attachments: pick(prev?.police.attachments, ROAD_PERMIT_TEXT_DEFAULTS.policeAttachments),
        conditionText: prev ? prev.police.conditionText : ROAD_PERMIT_TEXT_DEFAULTS.policeCondition,
    };

    const matsuyama: RoadPermitMatsuyamaFields = {
        ...emptyMatsuyama(),
        mayorName: pick(prev?.matsuyama.mayorName, ROAD_PERMIT_TEXT_DEFAULTS.matsuyamaMayor),
        attachments: pick(prev?.matsuyama.attachments, ROAD_PERMIT_TEXT_DEFAULTS.matsuyamaAttachments),
    };

    return {
        applicant: applicantFromCompany(company),
        contact,
        siteManager,
        site: siteFromProject(project),
        period: periodFromProject(project),
        road: emptyRoad(),
        occupancy,
        police,
        matsuyama,
    };
}

export interface BuildCopiedValuesInput {
    /** コピー元の申請の入力値 */
    source: RoadPermitValues;
    /** 新しい申請の案件 */
    project: RoadPermitProjectSource | null;
    /** コピー元と同じ案件か（同じなら現場・期間もそのまま写す。違えば案件から入れ直す） */
    sameProject: boolean;
}

/**
 * 「この申請をコピーして作る」の入力値。
 * コピー元の入力値をそのまま写し、案件が違うときは 現場・期間・警察の「場所又は区間」だけ案件から入れ直す。
 * 申請日（警察・松山市）は空に戻す。
 */
export function buildCopiedRoadPermitValues(input: BuildCopiedValuesInput): RoadPermitValues {
    const src = normalizeRoadPermitValues(input.source);
    const out: RoadPermitValues = {
        ...src,
        police: { ...src.police, applicationDate: '' },
        matsuyama: { ...src.matsuyama, applicationDate: '' },
    };
    if (!input.sameProject) {
        out.site = siteFromProject(input.project);
        out.period = periodFromProject(input.project);
        out.police = { ...out.police, section: projectLocationOf(input.project) };
    }
    return out;
}

/** 新しく作るときの名前（案件名） */
export function buildDefaultRoadPermitTitle(project: RoadPermitProjectSource | null): string {
    return project?.title?.trim() || '道路申請';
}

// ---------------------------------------------------------------------------
// 様式の記録（documents）
// ---------------------------------------------------------------------------

export function emptyDocumentEntry(formId: RoadPermitFormId, enabled: boolean): RoadPermitDocumentEntry {
    const def = getRoadPermitForm(formId);
    return {
        formId,
        enabled,
        submittedDate: '',
        permittedDate: '',
        permitNo: '',
        expiryDate: '',
        attachmentChecks: def.attachmentChecklist.map((label) => ({ label, done: false })),
    };
}

/** 新しく作るときの documents（カタログの全様式。enabledIds に無い様式は出さない扱い） */
export function buildDefaultRoadPermitDocuments(
    enabledIds: readonly RoadPermitFormId[] = ROAD_PERMIT_FORM_IDS,
): RoadPermitDocuments {
    const enabled = new Set(enabledIds);
    return { forms: ROAD_PERMIT_FORMS.map((f) => emptyDocumentEntry(f.id, enabled.has(f.id))) };
}

/** 「コピーして作る」の documents: 出す様式の選択だけ写し、提出日・許可日・許可番号・許可期限・チェックは空に戻す */
export function buildCopiedRoadPermitDocuments(source: RoadPermitDocuments): RoadPermitDocuments {
    const src = normalizeRoadPermitDocuments(source);
    return buildDefaultRoadPermitDocuments(enabledFormIdsOf(src));
}

/** 出す様式の id（カタログ順） */
export function enabledFormIdsOf(documents: RoadPermitDocuments): RoadPermitFormId[] {
    return sortFormIds(documents.forms.filter((f) => f.enabled).map((f) => f.formId));
}

/** 出す様式のうち、いちばん遅い許可期限（無ければ null） */
export function latestExpiryOf(documents: RoadPermitDocuments): string | null {
    let latest: string | null = null;
    for (const f of documents.forms) {
        if (!f.enabled || !f.expiryDate) continue;
        if (latest === null || f.expiryDate > latest) latest = f.expiryDate;
    }
    return latest;
}

// ---------------------------------------------------------------------------
// 正規化（DB の JSON → 型どおりの値。欠けている欄は空で埋める）
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : str(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const ROAD_PARTS: readonly RoadPart[] = ['', 'roadway', 'sidewalk', 'other'];
const ROAD_SURFACES: readonly RoadSurface[] = ['', 'paved', 'gravel'];
const KINDS: readonly MatsuyamaKind[] = ['permit', 'consult'];
const NEW_OR_CHANGE: readonly MatsuyamaNewOrChange[] = ['new', 'change'];
const ARTICLES: readonly MatsuyamaArticle[] = ['32', '35'];

export function normalizeRoadPermitValues(raw: unknown): RoadPermitValues {
    const r = obj(raw);
    const applicant = obj(r.applicant);
    const contact = obj(r.contact);
    const siteManager = obj(r.siteManager);
    const site = obj(r.site);
    const period = obj(r.period);
    const road = obj(r.road);
    const occupancy = obj(r.occupancy);
    const police = obj(r.police);
    const matsuyama = obj(r.matsuyama);
    const dayCountRaw = period.dayCount;
    const dayCount =
        typeof dayCountRaw === 'number' && Number.isFinite(dayCountRaw) && dayCountRaw >= 0 ? Math.trunc(dayCountRaw) : null;
    return {
        applicant: {
            postalCode: str(applicant.postalCode),
            address: str(applicant.address),
            companyName: str(applicant.companyName),
            representativeTitle: str(applicant.representativeTitle),
            representativeName: str(applicant.representativeName),
            tel: str(applicant.tel),
        },
        contact: { name: str(contact.name), phone: str(contact.phone) },
        siteManager: { address: str(siteManager.address), name: str(siteManager.name), phone: str(siteManager.phone) },
        site: { location: str(site.location), projectName: str(site.projectName) },
        period: {
            workFrom: str(period.workFrom),
            workTo: str(period.workTo),
            useFrom: str(period.useFrom),
            useTo: str(period.useTo),
            timeFrom: str(period.timeFrom),
            timeTo: str(period.timeTo),
            dayCount,
        },
        road: {
            routeName: str(road.routeName),
            part: oneOf(road.part, ROAD_PARTS, ''),
            surface: oneOf(road.surface, ROAD_SURFACES, ''),
            mapPage: str(road.mapPage),
        },
        occupancy: {
            purpose: str(occupancy.purpose),
            name: str(occupancy.name),
            structure: str(occupancy.structure),
            scaleNote: str(occupancy.scaleNote),
            length: str(occupancy.length),
            width: str(occupancy.width),
            quantity: str(occupancy.quantity),
            areaApprox: strOrNull(occupancy.areaApprox),
            excavationLength: str(occupancy.excavationLength),
            excavationWidth: str(occupancy.excavationWidth),
            excavationArea: str(occupancy.excavationArea),
            constructionMethod: str(occupancy.constructionMethod),
            restorationMethod: str(occupancy.restorationMethod),
        },
        police: {
            applicationDate: str(police.applicationDate),
            stationName: str(police.stationName),
            purpose: str(police.purpose),
            section: str(police.section),
            method: str(police.method),
            attachments: str(police.attachments),
            conditionText: str(police.conditionText),
        },
        matsuyama: {
            applicationDate: str(matsuyama.applicationDate),
            mayorName: str(matsuyama.mayorName),
            kind: oneOf(matsuyama.kind, KINDS, 'permit'),
            newOrChange: oneOf(matsuyama.newOrChange, NEW_OR_CHANGE, 'new'),
            article: oneOf(matsuyama.article, ARTICLES, '32'),
            previousPermitNo: str(matsuyama.previousPermitNo),
            previousPermitDate: str(matsuyama.previousPermitDate),
            attachments: str(matsuyama.attachments),
        },
    };
}

/**
 * documents の正規化。カタログの全様式を並び順どおりに並べ、DB に無い様式は「出さない」で足す。
 * 未知の様式 id は落とす。添付書類のチェックは、ラベルが同じものだけ引き継ぐ（カタログの文言が変わっても壊れない）。
 */
export function normalizeRoadPermitDocuments(raw: unknown): RoadPermitDocuments {
    const r = obj(raw);
    const list = Array.isArray(r.forms) ? r.forms : [];
    const byId = new Map<RoadPermitFormId, Record<string, unknown>>();
    for (const item of list) {
        const o = obj(item);
        if (isRoadPermitFormId(o.formId) && !byId.has(o.formId)) byId.set(o.formId, o);
    }
    const forms: RoadPermitDocumentEntry[] = ROAD_PERMIT_FORMS.map((def) => {
        const o = byId.get(def.id);
        if (!o) return emptyDocumentEntry(def.id, false);
        const checks = Array.isArray(o.attachmentChecks) ? o.attachmentChecks : [];
        const done = new Map<string, boolean>();
        for (const c of checks) {
            const co = obj(c);
            if (typeof co.label === 'string') done.set(co.label, co.done === true);
        }
        return {
            formId: def.id,
            enabled: o.enabled === true,
            submittedDate: str(o.submittedDate),
            permittedDate: str(o.permittedDate),
            permitNo: str(o.permitNo),
            expiryDate: str(o.expiryDate),
            attachmentChecks: def.attachmentChecklist.map((label) => ({ label, done: done.get(label) === true })),
        };
    });
    return { forms };
}

export function normalizeRoadPermitStatus(raw: unknown): RoadPermitStatus {
    return oneOf(raw, ROAD_PERMIT_STATUSES, 'draft');
}
