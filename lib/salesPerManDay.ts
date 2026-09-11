/**
 * 期別・月別・日別の「売上 ÷ 人工」（過去データ取込 仕様 3-4 ＋ kei の絞り込み要望 2026-09-12）。純粋関数。
 *
 * 一人当たりの稼ぎ（稼ぎ ÷ 人工）は原価が要るが、過去データ（2024-01〜2026-04）には案件別の原価が無い。
 * そこで第11期〜第13期を同じ物差しで比べるために、原価を使わない「売上 ÷ 人工」を出す。
 *
 *   売上   … 2026-04 まで: 過去データの請求書（現場別）＋ 売上調整（顧客別・月単位）
 *             2026-05 から: DandoLink の請求書（送付済み以降・税抜）
 *   人工   … 2026-04 まで: 段取日報の自社の人数（外注の行は 0）
 *             2026-05 から: 日報から原価計上した人数（一人当たりの稼ぎの「総人数」と同じ）
 *
 * 3か月移動平均は「3か月の売上の合計 ÷ 3か月の人工の合計」（比の平均ではない）。
 * 分析用の月次ファイル（月次_売上と人工_2024-2026.csv）と同じ定義で、2024-03 = 50,716 円になる。
 * 月別のときだけ出す（日別では意味がないため）。
 *
 * 日別は「延べ人工」と「その日に請求した売上」を並べる（kei 決定）。売上調整は日が分からないので
 * 日別には出さない（月別・期別には入る）。
 */
import { fiscalTermOf, fiscalTermRange, LIVE_DATA_START_MONTH } from '@/lib/backfill/constants';
import { normalizeCompanyName } from '@/lib/backfill/matching';

export type SalesPerManDayGranularity = 'month' | 'day';

/** 集計の元になる 1 件（案件×日 の売上や人工、顧客別の売上調整など） */
export interface SalesPerManDayFact {
    /** JST の 'YYYY-MM-DD'。売上調整は日が分からないので null */
    date: string | null;
    /** 'YYYY-MM' */
    yearMonth: string;
    sales: number;
    manDays: number;
    customerName: string | null;
    content: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    /**
     * 顧客別・工事内容別・担当者別に入れない（土場・研修など非現場の作業）。
     * 会社全体の月別・期別には含める（決算と突き合わせる数字が非現場を含めて計算されているため）
     */
    excludeFromGroups?: boolean;
}

export interface SalesPerManDayBucket {
    /** 月別は 'YYYY-MM'、日別は 'YYYY-MM-DD' */
    key: string;
    term: number;
    sales: number;
    manDays: number;
    salesPerManDay: number | null;
    /** 月別のみ。3 か月の売上合計 ÷ 3 か月の人工合計 */
    movingAvg3: number | null;
    /** この期間をどちらのデータで数えたか */
    source: 'backfill' | 'live';
}

export interface SalesPerManDayTerm {
    term: number;
    label: string;
    from: string;
    to: string;
    sales: number;
    manDays: number;
    salesPerManDay: number | null;
    /** この期のうち数字がある月の数（途中の期は 12 未満） */
    monthsCovered: number;
}

export interface SalesPerManDayGroup {
    key: string;
    name: string;
    sales: number;
    manDays: number;
    salesPerManDay: number | null;
}

export interface SalesPerManDaySummary {
    liveStartMonth: string;
    from: string;
    to: string;
    granularity: SalesPerManDayGranularity;
    buckets: SalesPerManDayBucket[];
    terms: SalesPerManDayTerm[];
    byCustomer: SalesPerManDayGroup[];
    byContent: SalesPerManDayGroup[];
    byAssignee: SalesPerManDayGroup[];
    /** 日別のときに、日が分からないため出していない売上調整の額（0 なら注記を出さない） */
    adjustmentExcludedFromDaily: number;
}

const ratio = (sales: number, manDays: number) => (manDays > 0 ? Math.round(sales / manDays) : null);

/** 'YYYY-MM' を n か月ずらす */
export function shiftYearMonth(ym: string, n: number): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** from〜to の 'YYYY-MM' を順に並べる */
export function monthsBetween(from: string, to: string): string[] {
    const out: string[] = [];
    for (let ym = from; ym <= to; ym = shiftYearMonth(ym, 1)) out.push(ym);
    return out;
}

/** from〜to の 'YYYY-MM-DD' を順に並べる */
export function daysBetween(from: string, to: string): string[] {
    const out: string[] = [];
    const end = new Date(`${to}T00:00:00Z`).getTime();
    for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86400000) {
        out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
}

/** 名前ごとにまとめる（顧客は法人格の有無を寄せる。表示名は最初に出てきた名前） */
function groupBy(
    facts: SalesPerManDayFact[],
    keyOf: (f: SalesPerManDayFact) => { key: string; name: string },
): SalesPerManDayGroup[] {
    const map = new Map<string, SalesPerManDayGroup>();
    for (const f of facts) {
        const { key, name } = keyOf(f);
        const g = map.get(key) ?? { key, name, sales: 0, manDays: 0, salesPerManDay: null };
        g.sales += f.sales;
        g.manDays += f.manDays;
        map.set(key, g);
    }
    return [...map.values()]
        .map((g) => ({ ...g, sales: Math.round(g.sales), salesPerManDay: ratio(g.sales, g.manDays) }))
        .sort((a, b) => b.sales - a.sales);
}

/**
 * @param facts 表示する期間の 2 か月前から渡す（最初の月の 3 か月移動平均のため）
 * @param opts.from / opts.to 表示する期間（'YYYY-MM-DD'）
 */
export function summarizeSalesPerManDay(
    facts: SalesPerManDayFact[],
    opts: { from: string; to: string; granularity: SalesPerManDayGranularity },
): SalesPerManDaySummary {
    const fromMonth = opts.from.slice(0, 7);
    const toMonth = opts.to.slice(0, 7);

    // ---- 月ごとの集計（期別と 3 か月移動平均に使う。表示期間の前の月も含む） ----
    const salesByMonth = new Map<string, number>();
    const manDaysByMonth = new Map<string, number>();
    for (const f of facts) {
        salesByMonth.set(f.yearMonth, (salesByMonth.get(f.yearMonth) ?? 0) + f.sales);
        manDaysByMonth.set(f.yearMonth, (manDaysByMonth.get(f.yearMonth) ?? 0) + f.manDays);
    }

    // ---- 表示する期間の中の facts（日別は日付、月別は月で切る） ----
    const inRange = facts.filter((f) =>
        f.date ? f.date >= opts.from && f.date <= opts.to : f.yearMonth >= fromMonth && f.yearMonth <= toMonth,
    );

    // ---- 棒（月別 or 日別） ----
    let buckets: SalesPerManDayBucket[];
    if (opts.granularity === 'day') {
        const salesByDay = new Map<string, number>();
        const manDaysByDay = new Map<string, number>();
        for (const f of inRange) {
            if (!f.date) continue; // 売上調整は日が分からないので日別には出さない
            salesByDay.set(f.date, (salesByDay.get(f.date) ?? 0) + f.sales);
            manDaysByDay.set(f.date, (manDaysByDay.get(f.date) ?? 0) + f.manDays);
        }
        buckets = daysBetween(opts.from, opts.to).map((day) => {
            const sales = Math.round(salesByDay.get(day) ?? 0);
            const manDays = manDaysByDay.get(day) ?? 0;
            const ym = day.slice(0, 7);
            return {
                key: day,
                term: fiscalTermOf(ym),
                sales,
                manDays,
                salesPerManDay: ratio(sales, manDays),
                movingAvg3: null,
                source: ym < LIVE_DATA_START_MONTH ? 'backfill' : 'live',
            };
        });
    } else {
        buckets = monthsBetween(fromMonth, toMonth).map((ym) => {
            const sales = Math.round(salesByMonth.get(ym) ?? 0);
            const manDays = manDaysByMonth.get(ym) ?? 0;
            let s3 = 0;
            let m3 = 0;
            for (let i = 0; i < 3; i++) {
                const k = shiftYearMonth(ym, -i);
                s3 += salesByMonth.get(k) ?? 0;
                m3 += manDaysByMonth.get(k) ?? 0;
            }
            return {
                key: ym,
                term: fiscalTermOf(ym),
                sales,
                manDays,
                salesPerManDay: ratio(sales, manDays),
                movingAvg3: ratio(s3, m3),
                source: ym < LIVE_DATA_START_MONTH ? 'backfill' : 'live',
            };
        });
    }

    // ---- 期別（表示している月だけで数える） ----
    const termMap = new Map<number, SalesPerManDayTerm>();
    for (const ym of monthsBetween(fromMonth, toMonth)) {
        const term = fiscalTermOf(ym);
        const t = termMap.get(term) ?? (() => {
            const { from, to } = fiscalTermRange(term);
            return { term, label: `第${term}期`, from, to, sales: 0, manDays: 0, salesPerManDay: null, monthsCovered: 0 };
        })();
        const sales = salesByMonth.get(ym) ?? 0;
        const manDays = manDaysByMonth.get(ym) ?? 0;
        t.sales += sales;
        t.manDays += manDays;
        if (sales !== 0 || manDays !== 0) t.monthsCovered += 1;
        termMap.set(term, t);
    }
    const terms = [...termMap.values()]
        .sort((a, b) => a.term - b.term)
        .map((t) => ({ ...t, sales: Math.round(t.sales), salesPerManDay: ratio(t.sales, t.manDays) }));

    // ---- 顧客別・工事内容別・担当者別（表示している期間だけ・非現場は除く） ----
    const forGroups = inRange.filter((f) => !f.excludeFromGroups);
    const byCustomer = groupBy(forGroups, (f) => {
        const name = (f.customerName ?? '').trim();
        if (!name) return { key: '__none__', name: '(顧客未設定)' };
        return { key: normalizeCompanyName(name) || name, name };
    });
    const byContent = groupBy(forGroups, (f) => {
        const name = (f.content ?? '').trim();
        return name ? { key: name, name } : { key: '__none__', name: '(工事内容なし・過去データを含む)' };
    });
    const byAssignee = groupBy(forGroups, (f) =>
        f.assigneeId
            ? { key: f.assigneeId, name: f.assigneeName || '(不明)' }
            : { key: '__none__', name: '(担当者なし・過去データを含む)' },
    );

    const adjustmentExcludedFromDaily = opts.granularity === 'day'
        ? Math.round(inRange.filter((f) => !f.date).reduce((s, f) => s + f.sales, 0))
        : 0;

    return {
        liveStartMonth: LIVE_DATA_START_MONTH,
        from: opts.from,
        to: opts.to,
        granularity: opts.granularity,
        buckets,
        terms,
        byCustomer,
        byContent,
        byAssignee,
        adjustmentExcludedFromDaily,
    };
}
