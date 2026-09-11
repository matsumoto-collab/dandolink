/**
 * 期別・月別の「売上 ÷ 人工」（過去データ取込 仕様 3-4）。純粋関数。
 *
 * 一人当たりの稼ぎ（稼ぎ ÷ 人工）は原価が要るが、過去データ（2024-01〜2026-04）には案件別の原価が無い。
 * そこで第11期〜第13期を同じ物差しで比べるために、原価を使わない「売上 ÷ 人工」を月ごとに出す。
 *
 *   売上   … 2026-04 まで: 過去データの請求書（現場別）＋ 売上調整（顧客別）
 *             2026-05 から: DandoLink の請求書（送付済み以降・税抜）
 *   人工   … 2026-04 まで: 段取日報の自社の人数（外注の行は 0）
 *             2026-05 から: 日報から原価計上した人数（一人当たりの稼ぎの「総人数」と同じ）
 *
 * 3か月移動平均は「3か月の売上の合計 ÷ 3か月の人工の合計」（比の平均ではない）。
 * 分析用の月次ファイル（月次_売上と人工_2024-2026.csv）と同じ定義で、2024-03 = 50,716 円になる。
 * 表示の最初の月でも前の 2 か月を含めて計算する（呼び出し側が 2 か月前から facts を渡す）。
 */
import { fiscalTermOf, fiscalTermRange, LIVE_DATA_START_MONTH } from '@/lib/backfill/constants';
import { normalizeCompanyName } from '@/lib/backfill/matching';

/** 集計の元になる 1 件（案件×月 の売上や人工、顧客別の売上調整など） */
export interface SalesPerManDayFact {
    yearMonth: string;
    sales: number;
    manDays: number;
    customerName: string | null;
    /** 工事内容（過去データには無いので null） */
    content: string | null;
    /**
     * 顧客別・工事内容別に入れない（土場・研修など非現場の作業）。
     * 会社全体の月別・期別には含める（決算と突き合わせる数字が非現場を含めて計算されているため）
     */
    excludeFromGroups?: boolean;
}

export interface SalesPerManDayMonth {
    yearMonth: string;
    term: number;
    sales: number;
    manDays: number;
    salesPerManDay: number | null;
    movingAvg3: number | null;
    /** この月をどちらのデータで数えたか */
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
    months: SalesPerManDayMonth[];
    terms: SalesPerManDayTerm[];
    groupFrom: string;
    groupTo: string;
    byCustomer: SalesPerManDayGroup[];
    byContent: SalesPerManDayGroup[];
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
        .map((g) => ({ ...g, salesPerManDay: ratio(g.sales, g.manDays) }))
        .sort((a, b) => b.sales - a.sales);
}

export function summarizeSalesPerManDay(
    facts: SalesPerManDayFact[],
    opts: { from: string; to: string; groupFrom: string; groupTo: string },
): SalesPerManDaySummary {
    // ---- 月別（移動平均のため from の 2 か月前から集める） ----
    const salesByMonth = new Map<string, number>();
    const manDaysByMonth = new Map<string, number>();
    for (const f of facts) {
        salesByMonth.set(f.yearMonth, (salesByMonth.get(f.yearMonth) ?? 0) + f.sales);
        manDaysByMonth.set(f.yearMonth, (manDaysByMonth.get(f.yearMonth) ?? 0) + f.manDays);
    }
    const months: SalesPerManDayMonth[] = monthsBetween(opts.from, opts.to).map((ym) => {
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
            yearMonth: ym,
            term: fiscalTermOf(ym),
            sales,
            manDays,
            salesPerManDay: ratio(sales, manDays),
            movingAvg3: ratio(s3, m3),
            source: ym < LIVE_DATA_START_MONTH ? 'backfill' : 'live',
        };
    });

    // ---- 期別（表示している月だけで数える） ----
    const termMap = new Map<number, SalesPerManDayTerm>();
    for (const m of months) {
        const t = termMap.get(m.term) ?? (() => {
            const { from, to } = fiscalTermRange(m.term);
            return { term: m.term, label: `第${m.term}期`, from, to, sales: 0, manDays: 0, salesPerManDay: null, monthsCovered: 0 };
        })();
        t.sales += m.sales;
        t.manDays += m.manDays;
        if (m.sales !== 0 || m.manDays !== 0) t.monthsCovered += 1;
        termMap.set(m.term, t);
    }
    const terms = [...termMap.values()]
        .sort((a, b) => a.term - b.term)
        .map((t) => ({ ...t, salesPerManDay: ratio(t.sales, t.manDays) }));

    // ---- 顧客別・工事内容別（選んだ期間だけ） ----
    const inGroup = facts.filter((f) => !f.excludeFromGroups && f.yearMonth >= opts.groupFrom && f.yearMonth <= opts.groupTo);
    const byCustomer = groupBy(inGroup, (f) => {
        const name = (f.customerName ?? '').trim();
        if (!name) return { key: '__none__', name: '(顧客未設定)' };
        return { key: normalizeCompanyName(name) || name, name };
    }).map((g) => ({ ...g, sales: Math.round(g.sales) }));
    const byContent = groupBy(inGroup, (f) => {
        const name = (f.content ?? '').trim();
        return name ? { key: name, name } : { key: '__none__', name: '(工事内容なし・過去データを含む)' };
    }).map((g) => ({ ...g, sales: Math.round(g.sales) }));

    return {
        liveStartMonth: LIVE_DATA_START_MONTH,
        from: opts.from,
        to: opts.to,
        months,
        terms,
        groupFrom: opts.groupFrom,
        groupTo: opts.groupTo,
        byCustomer,
        byContent,
    };
}
