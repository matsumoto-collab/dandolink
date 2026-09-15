/**
 * グラフに渡す形へデータを並べ替え・まとめる純粋関数（kei 要望 2026-09-15）。
 * 利益サマリー（案件詳細）・自社班の出来高・利益ダッシュボードのグラフで使う。
 * 色はここでは持たない（components/charts/chartTheme.ts）。
 */
import { ASSEMBLY_TYPE_NAME, DEMOLITION_TYPE_NAME, type OwnCrewVolumeGroup } from '@/lib/ownCrewVolume';
import type { MonthlyAssigneeRow } from '@/lib/profitDashboard';

/** 「その他」にまとめた行のキー */
export const REST_KEY = '__rest__';

function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
    return items.reduce((sum, item) => sum + pick(item), 0);
}

// ---------------------------------------------------------------------------
// 共通: 大きい順の上位 N 件＋「その他」
// ---------------------------------------------------------------------------

/**
 * value の大きい順に並べ、上位 n 件より後ろを fold で 1 件にまとめる。
 * あふれる件数が minRest 未満ならまとめずにそのまま並べる
 * （既定 2＝「その他（1件）」のような意味の薄い行を作らない）。
 */
export function foldTopN<T>(
    items: readonly T[],
    n: number,
    value: (item: T) => number,
    fold: (rest: T[]) => T,
    minRest = 2,
): T[] {
    const sorted = [...items].sort((a, b) => value(b) - value(a));
    if (sorted.length - n < minRest) return sorted;
    return [...sorted.slice(0, n), fold(sorted.slice(n))];
}

// ---------------------------------------------------------------------------
// 利益サマリー: お金の行き先（売上 = 利益 + 原価の内訳）
// ---------------------------------------------------------------------------

export type ProfitCompositionKey = 'profit' | 'subcontractor' | 'labor' | 'material' | 'loading' | 'vehicle' | 'other';

export interface ProfitCompositionCosts {
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
}

export interface ProfitCompositionSegment {
    key: ProfitCompositionKey;
    label: string;
    value: number;
}

export interface ProfitComposition {
    /** revenue = 売上を「利益＋原価の内訳」に分ける／cost = 赤字や売上なしで、原価の内訳だけを分ける */
    mode: 'revenue' | 'cost';
    segments: ProfitCompositionSegment[];
    totalCost: number;
    /** 原価が売上を上回った額。売上があって赤字のときだけ 0 より大きい */
    lossAmount: number;
}

/**
 * ドーナツで回る順番。隣り合う色が見分けやすい並び（chartTheme で検証済み）にしてあり、
 * 原価内訳の一覧の並び（人件費→車両費→…）とは違う。
 */
const COST_SEGMENTS: {
    key: Exclude<ProfitCompositionKey, 'profit'>;
    label: string;
    pick: (c: ProfitCompositionCosts) => number;
}[] = [
    { key: 'subcontractor', label: '外注費', pick: (c) => c.subcontractorCost },
    { key: 'labor', label: '人件費', pick: (c) => c.laborCost },
    { key: 'material', label: '材料費', pick: (c) => c.materialCost },
    { key: 'loading', label: '積込費', pick: (c) => c.loadingCost },
    { key: 'vehicle', label: '車両費', pick: (c) => c.vehicleCost },
    { key: 'other', label: 'その他', pick: (c) => c.otherExpenses },
];

/** 0 円の項目は外す。売上も原価も無ければ null（グラフを出さない） */
export function buildProfitComposition(
    costs: ProfitCompositionCosts,
    revenue: number,
    grossProfit: number,
): ProfitComposition | null {
    const costSegments: ProfitCompositionSegment[] = COST_SEGMENTS
        .map(({ key, label, pick }) => ({ key, label, value: Math.max(0, pick(costs)) }))
        .filter((s) => s.value > 0);
    const totalCost = sumBy(costSegments, (s) => s.value);

    if (revenue > 0 && grossProfit >= 0) {
        const segments: ProfitCompositionSegment[] = grossProfit > 0
            ? [{ key: 'profit', label: '利益', value: grossProfit }, ...costSegments]
            : costSegments;
        return segments.length > 0 ? { mode: 'revenue', segments, totalCost, lossAmount: 0 } : null;
    }
    if (totalCost <= 0) return null;
    return {
        mode: 'cost',
        segments: costSegments,
        totalCost,
        lossAmount: revenue > 0 ? Math.max(0, -grossProfit) : 0,
    };
}

// ---------------------------------------------------------------------------
// 自社班の出来高: 日ごとの人工（作業内容別）
// ---------------------------------------------------------------------------

export type CrewContentKey = 'assembly' | 'demolition' | 'other';

export const CREW_CONTENT_KEYS: CrewContentKey[] = ['assembly', 'demolition', 'other'];

export const CREW_CONTENT_LABELS: Record<CrewContentKey, string> = {
    assembly: '組立',
    demolition: '解体',
    other: 'その他',
};

/** 工事種別の名前 → 組立／解体／その他（種別は UUID マスタなので名前で判定する） */
export function crewContentKey(constructionTypeName: string | null): CrewContentKey {
    if (constructionTypeName === ASSEMBLY_TYPE_NAME) return 'assembly';
    if (constructionTypeName === DEMOLITION_TYPE_NAME) return 'demolition';
    return 'other';
}

export interface OwnCrewDailyPoint {
    /** 'YYYY-MM-DD' */
    date: string;
    day: number;
    /** 0=日 … 6=土 */
    weekday: number;
    assembly: number;
    demolition: number;
    other: number;
    /** 延べ人工（workerCount の合計） */
    manDays: number;
    /** その日に作業した現場の数 */
    siteCount: number;
    earnings: number;
    laborCost: number;
    /** 日報なし（人数 0 で数えた）配置の件数 */
    noReportCount: number;
}

/** 表示月の 1 日〜月末を 1 日 1 件で並べる（作業の無い日も 0 で並べて、休みの日が見えるようにする） */
export function buildOwnCrewDaily(groups: readonly OwnCrewVolumeGroup[], year: number, month: number): OwnCrewDailyPoint[] {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const points: OwnCrewDailyPoint[] = [];
    const sites: Set<string>[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
        points.push({
            date: `${prefix}${String(day).padStart(2, '0')}`,
            day,
            weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
            assembly: 0,
            demolition: 0,
            other: 0,
            manDays: 0,
            siteCount: 0,
            earnings: 0,
            laborCost: 0,
            noReportCount: 0,
        });
        sites.push(new Set());
    }
    for (const group of groups) {
        for (const row of group.rows) {
            if (!row.date.startsWith(prefix)) continue;
            const index = Number(row.date.slice(8, 10)) - 1;
            const point = points[index];
            if (!point) continue;
            point[crewContentKey(row.constructionTypeName)] += row.workerCount;
            point.manDays += row.workerCount;
            point.earnings += row.earnings ?? 0;
            point.laborCost += row.laborCost;
            if (row.flags.includes('no_report')) point.noReportCount += 1;
            sites[index].add(row.projectMasterId);
        }
    }
    points.forEach((point, i) => {
        point.siteCount = sites[i].size;
    });
    return points;
}

/** 月の延べ人工を 組立／解体／その他 に分ける */
export function summarizeOwnCrewContent(groups: readonly OwnCrewVolumeGroup[]): Record<CrewContentKey, number> {
    const totals: Record<CrewContentKey, number> = { assembly: 0, demolition: 0, other: 0 };
    for (const group of groups) {
        for (const row of group.rows) totals[crewContentKey(row.constructionTypeName)] += row.workerCount;
    }
    return totals;
}

// ---------------------------------------------------------------------------
// 利益ダッシュボード: 担当者別／顧客別の売上と粗利
// ---------------------------------------------------------------------------

export interface SalesProfitBar {
    key: string;
    name: string;
    sales: number;
    cost: number;
    grossProfit: number;
    /** 棒の中の粗利の長さ（赤字なら 0） */
    profitPart: number;
    /** 棒の中の原価の長さ（profitPart と足すと売上） */
    costPart: number;
    /** 粗利率（%・小数1桁） */
    margin: number;
    /** 案件の件数 */
    itemCount: number;
}

/** 棒の長さ＝売上。売上 0 以下（返金だけの月など）は棒にしない。上位 topN 件の後ろは「その他（件数）」 */
export function buildSalesProfitBars(rows: readonly MonthlyAssigneeRow[], topN: number): SalesProfitBar[] {
    type Base = Pick<SalesProfitBar, 'key' | 'name' | 'sales' | 'cost' | 'grossProfit' | 'itemCount'>;
    const base: Base[] = rows
        .filter((r) => r.sales > 0)
        .map((r) => ({ key: r.key, name: r.name, sales: r.sales, cost: r.cost, grossProfit: r.grossProfit, itemCount: r.items.length }));
    const folded = foldTopN(base, topN, (r) => r.sales, (rest) => ({
        key: REST_KEY,
        name: `その他（${rest.length}）`,
        sales: sumBy(rest, (r) => r.sales),
        cost: sumBy(rest, (r) => r.cost),
        grossProfit: sumBy(rest, (r) => r.grossProfit),
        itemCount: sumBy(rest, (r) => r.itemCount),
    }));
    return folded.map((r) => {
        const profitPart = Math.max(0, Math.min(r.grossProfit, r.sales));
        return {
            ...r,
            profitPart,
            costPart: r.sales - profitPart,
            margin: Math.round((r.grossProfit / r.sales) * 1000) / 10,
        };
    });
}

export interface ShareItem {
    key: string;
    label: string;
    value: number;
}

/** 売上の割合（ドーナツ用）。上位 topN 件の後ろは 1 件でも「その他」にまとめる（色を topN 色より増やさない） */
export function buildSalesShare(rows: readonly MonthlyAssigneeRow[], topN: number): ShareItem[] {
    const items = rows.filter((r) => r.sales > 0).map((r) => ({ key: r.key, label: r.name, value: r.sales }));
    return foldTopN(
        items,
        topN,
        (item) => item.value,
        (rest) => ({ key: REST_KEY, label: `その他（${rest.length}）`, value: sumBy(rest, (item) => item.value) }),
        1,
    );
}
