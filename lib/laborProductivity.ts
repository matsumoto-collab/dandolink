/**
 * 利益ダッシュボード「人工生産性」タブの集計（仕様3-4）。
 *
 * 区分（工事内容・顧客・担当者）ごとに、加工高と総人数を合計して人工あたり加工高を出す。
 * **1件あたり加工高と1件あたり人工を必ず併記する**：実測では大規模と住宅の人工単価は
 * ほぼ互角（56,182円 vs 43,828円）だが、1件あたり加工高は約9倍の差がある。人工単価だけを
 * 見ると「大規模も住宅も同じ」という誤った結論になるため。
 *
 * 信頼度フラグの付いた案件（原価未入力・請求不足・手動上書き・未請求・自社人工なし）は
 * 平均を歪めるので集計から外し、除外件数と理由を注記する。
 */
import {
    VALUE_ADDED_FLAG_LABELS,
    type ValueAddedFlag,
    type ValueAddedJudgement,
    type ValueAddedResult,
} from '@/lib/valueAdded';

export const UNKNOWN_GROUP_LABEL = '未設定';

export interface LaborProductivityProject {
    projectMasterId: string;
    title: string;
    customerName: string | null;
    /** 工事内容（lib/constructionContent で正規化済み） */
    constructionContent: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    valueAdded: ValueAddedResult;
}

export interface LaborProductivityGroup {
    key: string;
    label: string;
    projectCount: number;
    valueAddedTotal: number;
    headcountTotal: number;
    /** 人工あたり加工高＝加工高の合計 ÷ 総人数の合計（案件ごとの平均ではない） */
    perManday: number | null;
    /** 1件あたり加工高 */
    valueAddedPerProject: number;
    /** 1件あたり人工 */
    headcountPerProject: number;
}

export interface LaborProductivityShortfall {
    projectMasterId: string;
    title: string;
    perManday: number;
    headcount: number;
    /** しきい値までの不足額の総額＝(しきい値 − 人工単価) × 総人数 */
    shortfallTotal: number;
    judgement: ValueAddedJudgement;
    outsourcingHeavy: boolean;
}

export interface LaborProductivityExcluded {
    flag: ValueAddedFlag;
    label: string;
    count: number;
}

export interface LaborProductivitySummary {
    includedCount: number;
    excludedCount: number;
    excluded: LaborProductivityExcluded[];
    overall: LaborProductivityGroup;
    byContent: LaborProductivityGroup[];
    byCustomer: LaborProductivityGroup[];
    byAssignee: LaborProductivityGroup[];
    shortfalls: LaborProductivityShortfall[];
    threshold: number | null;
}

function makeGroup(key: string, label: string, projects: LaborProductivityProject[]): LaborProductivityGroup {
    let valueAddedTotal = 0;
    let headcountTotal = 0;
    for (const p of projects) {
        valueAddedTotal += p.valueAdded.valueAdded;
        headcountTotal += p.valueAdded.headcount;
    }
    const count = projects.length;
    return {
        key,
        label,
        projectCount: count,
        valueAddedTotal,
        headcountTotal,
        perManday: headcountTotal > 0 ? Math.trunc(valueAddedTotal / headcountTotal) : null,
        valueAddedPerProject: count > 0 ? Math.trunc(valueAddedTotal / count) : 0,
        // 1件あたり人工は小数第1位まで（案件数が少ないと整数丸めで差が消えるため）
        headcountPerProject: count > 0 ? Math.round((headcountTotal / count) * 10) / 10 : 0,
    };
}

function groupBy(
    projects: LaborProductivityProject[],
    pick: (p: LaborProductivityProject) => { key: string; label: string },
): LaborProductivityGroup[] {
    const buckets = new Map<string, { label: string; items: LaborProductivityProject[] }>();
    for (const p of projects) {
        const { key, label } = pick(p);
        const bucket = buckets.get(key) ?? { label, items: [] };
        bucket.items.push(p);
        buckets.set(key, bucket);
    }
    return Array.from(buckets.entries())
        .map(([key, b]) => makeGroup(key, b.label, b.items))
        // 加工高の大きい順（会社への貢献が大きい区分から見たい）
        .sort((a, b) => b.valueAddedTotal - a.valueAddedTotal);
}

/**
 * 集計する。threshold が null（しきい値未設定）のときは下位リストを作らない。
 */
export function summarizeLaborProductivity(
    projects: LaborProductivityProject[],
    threshold: number | null,
): LaborProductivitySummary {
    const included = projects.filter(p => !p.valueAdded.excludedFromAggregate);
    const excludedProjects = projects.filter(p => p.valueAdded.excludedFromAggregate);

    // 除外理由の内訳（1案件が複数の理由を持つことがあるので理由ごとに数える）
    const excludedCounts = new Map<ValueAddedFlag, number>();
    for (const p of excludedProjects) {
        for (const flag of p.valueAdded.flags) {
            // outsourcing_heavy は除外理由ではない（集計には含める案件にも付く）
            if (flag === 'outsourcing_heavy') continue;
            excludedCounts.set(flag, (excludedCounts.get(flag) ?? 0) + 1);
        }
    }

    const shortfalls: LaborProductivityShortfall[] = [];
    if (threshold !== null && threshold > 0) {
        for (const p of included) {
            const va = p.valueAdded;
            if (va.perManday === null || va.judgement === 'good' || va.judgement === 'unknown') continue;
            shortfalls.push({
                projectMasterId: p.projectMasterId,
                title: p.title,
                perManday: va.perManday,
                headcount: va.headcount,
                shortfallTotal: Math.max(0, Math.trunc((threshold - va.perManday) * va.headcount)),
                judgement: va.judgement,
                outsourcingHeavy: va.outsourcingHeavy,
            });
        }
        shortfalls.sort((a, b) => b.shortfallTotal - a.shortfallTotal);
    }

    return {
        includedCount: included.length,
        excludedCount: excludedProjects.length,
        excluded: Array.from(excludedCounts.entries())
            .map(([flag, count]) => ({ flag, label: VALUE_ADDED_FLAG_LABELS[flag], count }))
            .sort((a, b) => b.count - a.count),
        overall: makeGroup('__all__', '全体', included),
        byContent: groupBy(included, p => ({
            key: p.constructionContent ?? '__none__',
            label: p.constructionContent ?? UNKNOWN_GROUP_LABEL,
        })),
        byCustomer: groupBy(included, p => ({
            key: p.customerName ?? '__none__',
            label: p.customerName ?? UNKNOWN_GROUP_LABEL,
        })),
        byAssignee: groupBy(included, p => ({
            key: p.assigneeId ?? '__none__',
            label: p.assigneeName ?? UNKNOWN_GROUP_LABEL,
        })),
        shortfalls,
        threshold,
    };
}
