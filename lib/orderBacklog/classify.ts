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

/**
 * 案件から「住宅 / 他」を決める。
 *
 * 敬称が「様邸」「様」なら個人宅。敬称が入っていない案件もあるので、
 * 現場名・案件名に「邸」が含まれていれば住宅として拾う。
 */
export function siteKindFromProject(project: SiteKindSource): SiteKind {
    const honorific = (project.honorific ?? '').trim();
    if (honorific === '様邸' || honorific === '様') return 'house';
    const text = `${project.name ?? ''}${project.title ?? ''}`;
    return text.includes('邸') ? 'house' : 'other';
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
