import {
    BUCKET_MID_MIN_AMOUNT,
    type BucketKey,
    type SiteKind,
    type WorkKind,
} from '@/lib/orderBacklog/types';

/**
 * 案件の工事内容から「仮設工事 / 新築工事」を決める。
 *
 * ProjectMaster.constructionContent は UUID マスタ化される前の旧enum値（'new_construction' など）が
 * 本番に残っているため、表示名（'新築'）と旧値の両方を見る。
 * 改修・大規模・屋根壁・仮囲い・未設定はすべて仮設工事扱い（受注明細書では新築だけを分ける）。
 */
export function workKindFromConstructionContent(content: string | null | undefined): WorkKind {
    const v = (content ?? '').trim();
    if (!v) return 'temp';
    return v === '新築' || v === 'new_construction' ? 'new' : 'temp';
}

/** siteKindFromProject が見る案件の最小形（顧客の敬称と現場名）。 */
export interface SiteKindSource {
    /** 顧客・案件の敬称（'様邸' / '様' / '御中'） */
    honorific?: string | null;
    /** 現場名（短縮） */
    name?: string | null;
    /** 案件名（敬称・工事種別まで合成済み） */
    title?: string | null;
}

/** 現場名・案件名に含まれていれば個人宅とみなす語（元ファイルの案件リストで「住宅」に分類されていた名前から） */
const HOUSE_NAME_PATTERN = /邸|戸建|建売|号地|の家/;

/**
 * 案件から「住宅 / 他」を決める。
 *
 * 敬称「様邸」は個人宅。**「様」だけでは住宅にしない**＝本番の案件は法人現場にも「様」が付いていて
 * （御中はほぼ使われていない）、「様」で拾うとほぼ全件が住宅に寄ってしまうため。
 * 敬称が無い／「様」の案件は、現場名・案件名に「邸」「戸建」「建売」「号地」「の家」があれば住宅。
 */
export function siteKindFromProject(project: SiteKindSource): SiteKind {
    const honorific = (project.honorific ?? '').trim();
    if (honorific === '様邸') return 'house';
    const text = `${project.name ?? ''}${project.title ?? ''}`;
    return HOUSE_NAME_PATTERN.test(text) ? 'house' : 'other';
}

/** bucketKeyFor が見る明細行の最小形。 */
export interface BucketSource {
    workKind: WorkKind;
    siteKind: SiteKind;
    /** 契約額（円） */
    contractAmount: number;
}

/**
 * 明細行が入る区分集約のキー。個別行（＝閾値以上）なら null。
 *
 * 境界: 499,999→low / 500,000→mid / 999,999→mid / 1,000,000（既定の閾値）→個別行。
 */
export function bucketKeyFor(line: BucketSource, threshold: number): BucketKey | null {
    const amount = line.contractAmount;
    if (amount >= threshold) return null;
    const size = amount >= BUCKET_MID_MIN_AMOUNT ? 'mid' : 'low';
    return `${line.workKind}_${line.siteKind}_${size}`;
}
