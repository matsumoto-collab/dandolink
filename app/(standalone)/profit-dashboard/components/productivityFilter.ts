/**
 * 「一人当たりの稼ぎ」タブの絞り込み（kei 要望 2026-09-12）。
 * 期間・担当者・顧客・工事内容を 1 か所で持ち、
 * 「売上 ÷ 人工」（過去データを含む全期間）と「一人当たりの稼ぎ」（2026-05 以降）の両方に同じ条件をかける。
 */
import { LIVE_DATA_START_MONTH, fiscalTermOf, fiscalTermRange } from '@/lib/backfill/constants';

export interface ProductivityFilter {
    /** 'YYYY-MM-DD'（JST） */
    from: string;
    to: string;
    /** 時系列の粒度。日別は期間が短いときだけ選べる */
    granularity: 'month' | 'day';
    assigneeId: string;
    /** 顧客名の突き合わせキー（法人格の有無を寄せたもの） */
    customerKey: string;
    content: string;
}

/** 絞り込みの選択肢（API が絞り込む前の期間全体から作って返す） */
export interface ProductivityOptions {
    customers: { key: string; name: string }[];
    contents: string[];
    assignees: { id: string; name: string }[];
}

/** 日別で出せる最長の期間（API 側と同じ値） */
export const MAX_DAY_RANGE_DAYS = 120;

/** 過去データの最初の月 */
export const BACKFILL_FIRST_MONTH = '2024-01';

/** 比べられる最初の期（過去データが 2024-01 からなので、丸ごと揃うのは第11期から） */
export const FIRST_FULL_TERM = 11;

/** JST の今日（'YYYY-MM-DD'） */
export function todayJst(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** その月の末日（'YYYY-MM-DD'） */
export function endOfMonth(yearMonth: string): string {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** 期間の日数 */
export function rangeDays(from: string, to: string): number {
    const a = new Date(`${from}T00:00:00Z`).getTime();
    const b = new Date(`${to}T00:00:00Z`).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.floor((b - a) / 86400000) + 1;
}

/** 直近 n か月（今月を含む）の期間 */
export function recentMonths(n: number): { from: string; to: string } {
    const today = todayJst();
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1 - (n - 1), 1));
    return { from: start.toISOString().slice(0, 10), to: today };
}

export interface ProductivityPreset {
    key: string;
    label: string;
    from: string;
    to: string;
}

/** 期間のボタン（左から新しい順・最後に全期間） */
export function productivityPresets(): ProductivityPreset[] {
    const today = todayJst();
    const list: ProductivityPreset[] = [
        { key: 'm1', label: '今月', ...recentMonths(1) },
        { key: 'm3', label: '直近3か月', ...recentMonths(3) },
        { key: 'm6', label: '直近6か月', ...recentMonths(6) },
        { key: 'm12', label: '直近12か月', ...recentMonths(12) },
    ];
    const currentTerm = fiscalTermOf(today.slice(0, 7));
    for (let t = currentTerm; t >= FIRST_FULL_TERM; t--) {
        const { from, to } = fiscalTermRange(t);
        list.push({ key: `term${t}`, label: `第${t}期`, from: `${from}-01`, to: endOfMonth(to) });
    }
    list.push({ key: 'all', label: '全期間', from: `${BACKFILL_FIRST_MONTH}-01`, to: today });
    return list;
}

/** 今の期間がどのボタンと同じか（同じものが無ければ null ＝ 日付を直接指定した状態） */
export function presetKeyOf(from: string, to: string): string | null {
    return productivityPresets().find((p) => p.from === from && p.to === to)?.key ?? null;
}

/** 既定の絞り込み（直近12か月・月別・絞り込みなし） */
export function defaultProductivityFilter(): ProductivityFilter {
    const { from, to } = recentMonths(12);
    return { from, to, granularity: 'month', assigneeId: '', customerKey: '', content: '' };
}

/** API に渡すクエリ */
export function toQuery(filter: ProductivityFilter, extra: Record<string, string> = {}): string {
    const p = new URLSearchParams({ from: filter.from, to: filter.to, ...extra });
    if (filter.assigneeId) p.set('assigneeId', filter.assigneeId);
    if (filter.customerKey) p.set('customerKey', filter.customerKey);
    if (filter.content) p.set('content', filter.content);
    return p.toString();
}

/** 期間が丸ごと 2026-04 以前か（＝原価が無いので稼ぎを出せない期間か） */
export function isBackfillOnlyRange(filter: { to: string }): boolean {
    return filter.to.slice(0, 7) < LIVE_DATA_START_MONTH;
}

/** 期間の一部が 2026-04 以前か（＝稼ぎは 2026-05 以降だけで数えている期間か） */
export function spansBackfill(filter: { from: string }): boolean {
    return filter.from.slice(0, 7) < LIVE_DATA_START_MONTH;
}

/** 稼ぎを実際に数えられる開始日（2026-05-01 より前は原価が無いので切り上げる。API 側と同じ） */
export function effectiveProfitFrom(from: string): string {
    const liveStart = `${LIVE_DATA_START_MONTH}-01`;
    return from < liveStart ? liveStart : from;
}

/** 絞り込みが 1 つでも掛かっているか */
export function hasGroupFilter(filter: ProductivityFilter): boolean {
    return !!(filter.assigneeId || filter.customerKey || filter.content);
}
