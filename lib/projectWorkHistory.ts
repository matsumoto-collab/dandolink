/**
 * 案件一覧の「作業履歴」による絞り込み。
 *
 * ProjectAssignment.date は JST 0時（UTC では前日15時）で保存されているため、
 * 日付の突き合わせは必ず JST に直した YYYY-MM-DD で行う（UTCのまま比較すると1日ずれる）。
 */

import type { ProjectWorkHistoryItem } from '@/types/calendar';

const pad = (n: number) => String(n).padStart(2, '0');

/** 保存された配置日時（ISO）を JST の YYYY-MM-DD に直す。 */
export function workDateToJstYmd(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

export interface WorkHistoryFilter {
    /** 作業日の下限（YYYY-MM-DD・当日を含む）。 */
    from?: string;
    /** 作業日の上限（YYYY-MM-DD・当日を含む）。 */
    to?: string;
    /** 工事種別の「名称」（組立 / 解体 など）。マスタに同名IDが複数あるため名前で突き合わせる。 */
    ctypeName?: string;
    /** 職長の User ID。 */
    foremanId?: string;
}

/** 絞り込み条件が1つでも指定されているか。 */
export function hasWorkHistoryFilter(f: WorkHistoryFilter): boolean {
    return !!(f.from || f.to || f.ctypeName || f.foremanId);
}

/**
 * 指定条件に合致する作業履歴だけを返す。
 *
 * 日付・工事種別・職長は「同じ1件の作業履歴」がすべて満たすことを求める
 * （「この期間に、この職長が、組立をやった案件」を探せるようにするため）。
 * 条件が未指定の項目は無条件で通す。
 */
export function filterWorkHistory(
    items: ProjectWorkHistoryItem[] | undefined,
    filter: WorkHistoryFilter,
    /** 工事種別ID → 名称。マスタ未登録のレガシー値も名称へ解決できる関数を渡す。 */
    resolveCtypeName: (ctypeId: string | null) => string,
): ProjectWorkHistoryItem[] {
    if (!items || items.length === 0) return [];
    return items.filter((w) => {
        if (filter.from || filter.to) {
            const ymd = workDateToJstYmd(w.date);
            if (!ymd) return false;
            if (filter.from && ymd < filter.from) return false;
            if (filter.to && ymd > filter.to) return false;
        }
        if (filter.ctypeName && resolveCtypeName(w.constructionType) !== filter.ctypeName) return false;
        if (filter.foremanId && w.foremanId !== filter.foremanId) return false;
        return true;
    });
}

/** 条件に合致する作業履歴が1件でもあるか（条件未指定なら常に true）。 */
export function matchesWorkHistory(
    items: ProjectWorkHistoryItem[] | undefined,
    filter: WorkHistoryFilter,
    resolveCtypeName: (ctypeId: string | null) => string,
): boolean {
    if (!hasWorkHistoryFilter(filter)) return true;
    return filterWorkHistory(items, filter, resolveCtypeName).length > 0;
}
