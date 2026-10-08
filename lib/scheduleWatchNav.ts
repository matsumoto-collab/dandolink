/**
 * 「朝の見張りまとめ」通知 → 週間カレンダーの「見張りナビ」へ渡す、配置の一覧の受け渡し。
 *
 * 通知の URL（`?watch=`）とベルの data.items の両方で同じ形を使う。
 * サーバー（lib/scheduleWatch.ts）とクライアント（MainContent / WeeklyCalendar）の両方から
 * import するので、prisma や React は import しない（純粋関数だけ）。
 */

export interface ScheduleWatchNavItem {
    assignmentId: string;
    /** 配置日（JST）YYYY-MM-DD */
    date: string;
    /** ベルの本文の行（帯に現場名が見つからないときの代わりの表示） */
    label?: string;
}

/** Web Push の payload（約4KB）に収めるための上限 */
export const MAX_WATCH_NAV_ITEMS = 12;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `${date}_${assignmentId}` を ',' で連結（先頭 MAX 件） */
export function buildWatchParam(items: ScheduleWatchNavItem[]): string {
    return items
        .slice(0, MAX_WATCH_NAV_ITEMS)
        .map((i) => `${i.date}_${i.assignmentId}`)
        .join(',');
}

/** buildWatchParam の逆変換。形の合わない要素は捨てる。MAX 件まで */
export function parseWatchParam(raw: string | null | undefined): ScheduleWatchNavItem[] {
    if (!raw) return [];
    const result: ScheduleWatchNavItem[] = [];
    for (const part of raw.split(',')) {
        if (result.length >= MAX_WATCH_NAV_ITEMS) break;
        const sep = part.indexOf('_');
        if (sep < 0) continue;
        const date = part.slice(0, sep).trim();
        const assignmentId = part.slice(sep + 1).trim();
        if (!DATE_RE.test(date) || !assignmentId) continue;
        result.push({ assignmentId, date });
    }
    return result;
}
