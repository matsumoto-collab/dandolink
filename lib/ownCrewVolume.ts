/**
 * 自社班の出来高（職長班 × 月の作業一覧）の計算。
 *
 * 協力業者出来高（components/PartnerWorkVolume）が「会社 × 月」の支払い明細なのに対し、
 * こちらは「自社の職長班が月に行った作業」を 1 行ずつ並べ、各行に次の 3 つの金額を出す。
 *
 *   外注換算 … この作業を協力業者に出していたら払った額（内製と外注のどちらが得か）
 *   稼ぎ     … 案件の稼ぎ（会社に残るお金）を延べ人工で割り、その日の人数を掛けた額
 *   人件費   … 原価エンジンの按分後の人件費（配置ごとの上書きを反映）
 *
 * 月合計から
 *   一人当たりの稼ぎ      = 稼ぎ合計 ÷ 人工合計
 *   人件費1円あたりの稼ぎ = 稼ぎ合計 ÷ 人件費合計
 *   自社でやった得        = 外注換算合計 − 人件費合計
 * を出す。
 *
 * ここは Prisma を触らない純粋関数。取得は app/api/own-crew-volume/route.ts が行う。
 */
import type { CostBreakdown } from '@/utils/costCalculation';
import type { LaborCostRow } from '@/lib/projectCost';
import type { SubcontractorRates } from '@/lib/subcontractorCostCheck';
import {
    computeValueAdded,
    DEFAULT_VALUE_ADDED_SETTINGS,
    type ValueAddedSettings,
} from '@/lib/valueAdded';

/** 工事種別の自動計算（協力業者費）の対象になる 2 種別。名前で解決する（種別は UUID マスタ） */
export const ASSEMBLY_TYPE_NAME = '組立';
export const DEMOLITION_TYPE_NAME = '解体';

export type OwnCrewSalesBasis = 'invoice' | 'estimate' | 'contract' | 'override' | 'none';

export type OwnCrewVolumeFlag =
    | 'no_report'
    | 'unbilled'
    | 'joyo'
    | 'outsourcing_heavy'
    | 'labor_override';

export interface OwnCrewVolumeRow {
    assignmentId: string;
    /** 'YYYY-MM-DD'（labor 行の date＝配置日 JST） */
    date: string;
    foremanId: string;
    foremanName: string;
    projectMasterId: string;
    /** 正式名称（title）。無ければ name+honorific */
    projectTitle: string;
    customerName: string | null;
    managerName: string | null;
    constructionTypeName: string | null;
    /** 原価計上した実人数（日報ベース） */
    workerCount: number;
    /** 手配時の予定人数（日報なし行の参考表示） */
    memberCount: number;
    hours: number;
    /** 按分後の人件費（上書き反映） */
    laborCost: number;
    /** 外注換算。出せないときは null */
    outsourcingEquivalent: number | null;
    /** 稼ぎの日割り。出せないときは null */
    earnings: number | null;
    salesBasis: OwnCrewSalesBasis;
    flags: OwnCrewVolumeFlag[];
}

export interface OwnCrewVolumeTotals {
    rowCount: number;
    /** 人工合計（workerCount の合計） */
    manDays: number;
    hours: number;
    outsourcingEquivalent: number;
    earnings: number;
    laborCost: number;
    /** 一人当たりの稼ぎ＝earnings ÷ manDays（manDays 0 なら null） */
    perManday: number | null;
    /** 人件費1円あたりの稼ぎ＝earnings ÷ laborCost（laborCost 0 なら null） */
    productivityRatio: number | null;
    /** 自社でやった得＝outsourcingEquivalent − laborCost */
    makeVsBuy: number;
    /** 未請求（見積・契約金額ベース）の行数。合計には含めるが確度が低い */
    unbilledRowCount: number;
}

export interface OwnCrewVolumeGroup {
    foremanId: string;
    foremanName: string;
    rows: OwnCrewVolumeRow[];
    totals: OwnCrewVolumeTotals;
}

/** 登録済みの協力業者費（予定）。運搬費は自動計算の対象外なので作業費だけを渡す */
export interface OwnCrewSubcontractorCost {
    constructionTypeName: string | null;
    amount: number;
}

/** 案件 1 件ぶんの入力。laborRows は「全期間」（表示月に限らない）の labor 行 */
export interface OwnCrewVolumeProject {
    projectMasterId: string;
    projectTitle: string;
    customerName: string | null;
    managerName: string | null;
    contractAmount: number;
    revenueOverride: number | null;
    /** 確定売上（税抜・まとめ請求の按分後） */
    invoiceSubtotal: number;
    /** 見積（税抜・複数合算） */
    estimateSubtotal: number;
    registeredSubcontractorCosts: OwnCrewSubcontractorCost[];
    cost: CostBreakdown;
    laborRows: LaborCostRow[];
    hasManualCost: boolean;
    hasAssignments: boolean;
}

/** 表示月の対象配置（自社職長のみ）。labor 行とは assignmentId で突き合わせる */
export interface OwnCrewVolumeAssignment {
    assignmentId: string;
    foremanId: string;
    foremanName: string;
}

export interface BuildOwnCrewVolumeParams {
    projects: OwnCrewVolumeProject[];
    assignments: OwnCrewVolumeAssignment[];
    /** 協力業者（role = partner / partner_member）のユーザー ID。常用フラグの判定に使う */
    partnerUserIds: string[];
    rates: SubcontractorRates;
    settings?: ValueAddedSettings;
}

export interface BuildOwnCrewVolumeResult {
    groups: OwnCrewVolumeGroup[];
    totals: OwnCrewVolumeTotals;
}

/** 案件の稼ぎ（会社に残るお金）と、その根拠になった売上の区分 */
export interface OwnCrewProjectEarnings {
    /** 案件の稼ぎ V。出せないときは null */
    valueAdded: number | null;
    salesBasis: OwnCrewSalesBasis;
    /** 案件の総人数 H（全期間の labor 行 workerCount 合計） */
    headcount: number;
    /** 労務の外注比率が高い案件（人工単価が跳ね上がるので注意表示する） */
    outsourcingHeavy: boolean;
}

/** 円未満切り捨て（0方向）。lib/valueAdded.ts と同じ規則 */
function truncYen(value: number): number {
    return Math.trunc(value);
}

/** 行が 1 件も無いときの合計（対象0件のレスポンス用） */
export function emptyOwnCrewVolumeTotals(): OwnCrewVolumeTotals {
    return {
        rowCount: 0, manDays: 0, hours: 0,
        outsourcingEquivalent: 0, earnings: 0, laborCost: 0,
        perManday: null, productivityRatio: null, makeVsBuy: 0,
        unbilledRowCount: 0,
    };
}

/**
 * 案件の稼ぎ V を出す。
 * 請求があれば確定値（computeValueAdded）、未請求なら見積ベースの仮の値。
 */
export function computeProjectEarnings(
    project: OwnCrewVolumeProject,
    settings: ValueAddedSettings = DEFAULT_VALUE_ADDED_SETTINGS,
): OwnCrewProjectEarnings {
    const headcount = project.laborRows.reduce((s, r) => s + (r.workerCount || 0), 0);
    const invoiceSubtotal = Math.round(project.invoiceSubtotal || 0);
    const estimateSubtotal = Math.round(project.estimateSubtotal || 0);

    // 「外注中心」の判定は売上に依らない（外注費÷(外注費+人件費)）ので、未請求でも同じ入力で取れる
    const va = computeValueAdded(
        {
            sales: invoiceSubtotal,
            cost: project.cost,
            headcount,
            estimateSubtotal,
            hasManualCost: project.hasManualCost,
            hasAssignments: project.hasAssignments,
        },
        settings,
    );

    if (invoiceSubtotal > 0) {
        return {
            valueAdded: va.valueAdded,
            salesBasis: 'invoice',
            headcount,
            outsourcingHeavy: va.outsourcingHeavy,
        };
    }

    // 未請求: 見積（または手動上書き・契約金額）を売上と見なした仮の稼ぎ
    const contractAmount = Math.round(project.contractAmount || 0);
    const salesBasis: OwnCrewSalesBasis =
        project.revenueOverride != null
            ? 'override'
            : estimateSubtotal > 0
                ? 'estimate'
                : contractAmount > 0
                    ? 'contract'
                    : 'none';
    if (salesBasis === 'none') {
        return { valueAdded: null, salesBasis, headcount, outsourcingHeavy: va.outsourcingHeavy };
    }
    const estimatedRevenue = project.revenueOverride != null
        ? project.revenueOverride
        : (estimateSubtotal > 0 ? estimateSubtotal : contractAmount);
    const nonLaborCost = Math.round(project.cost.totalCost || 0) - Math.round(project.cost.laborCost || 0);
    return {
        valueAdded: truncYen(estimatedRevenue - nonLaborCost),
        salesBasis,
        headcount,
        outsourcingHeavy: va.outsourcingHeavy,
    };
}

/**
 * 外注換算に使う売上（税抜）。案件詳細 profit API の `revenue` と同じ順で決める
 * （revenueOverride ?? 請求税抜 ?? 見積税抜 ?? 足場工事金額）。
 */
function revenueForOutsourcing(project: OwnCrewVolumeProject): number {
    if (project.revenueOverride != null) return project.revenueOverride;
    const invoiceSubtotal = Math.round(project.invoiceSubtotal || 0);
    if (invoiceSubtotal > 0) return invoiceSubtotal;
    const estimateSubtotal = Math.round(project.estimateSubtotal || 0);
    if (estimateSubtotal > 0) return estimateSubtotal;
    return Math.round(project.contractAmount || 0);
}

/**
 * 工事種別ごとの「協力業者に出していたら払った額」。
 * - 案件登録の協力業者費（作業費）があればその額
 * - 無ければ自動計算式（売上 × 協力業者率 → 組立/解体へ按分。SubcontractorCostSection handleAutoCalc と同一）
 * - 組立・解体以外で登録も無ければ null（自動計算の対象外なので 0 と決めつけない）
 */
function outsourcingAmountByType(
    project: OwnCrewVolumeProject,
    rates: SubcontractorRates,
): Map<string, number> {
    const byType = new Map<string, number>();
    for (const c of project.registeredSubcontractorCosts) {
        const name = c.constructionTypeName;
        if (!name) continue;
        const amount = Number(c.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        byType.set(name, (byType.get(name) ?? 0) + amount);
    }

    const revenue = revenueForOutsourcing(project);
    const revenueRate = Number(rates?.revenueRate);
    const assemblyRate = Number(rates?.assemblyRate);
    const demolitionRate = Number(rates?.demolitionRate);
    if (!(revenue > 0) || !Number.isFinite(revenueRate) || !Number.isFinite(assemblyRate) || !Number.isFinite(demolitionRate)) {
        return byType;
    }
    const total = revenue * revenueRate / 100;
    if (!byType.has(ASSEMBLY_TYPE_NAME)) {
        byType.set(ASSEMBLY_TYPE_NAME, Math.round(total * assemblyRate / 100));
    }
    if (!byType.has(DEMOLITION_TYPE_NAME)) {
        byType.set(DEMOLITION_TYPE_NAME, Math.round(total * demolitionRate / 100));
    }
    return byType;
}

function addRowToTotals(totals: OwnCrewVolumeTotals, row: OwnCrewVolumeRow): void {
    totals.rowCount += 1;
    totals.manDays += row.workerCount;
    totals.hours += row.hours;
    totals.laborCost += row.laborCost;
    // null は 0 として足さない（値のある行だけ足す）
    if (row.outsourcingEquivalent != null) totals.outsourcingEquivalent += row.outsourcingEquivalent;
    if (row.earnings != null) totals.earnings += row.earnings;
    if (row.flags.includes('unbilled')) totals.unbilledRowCount += 1;
}

function finalizeTotals(totals: OwnCrewVolumeTotals): OwnCrewVolumeTotals {
    totals.hours = Math.round(totals.hours * 10) / 10;
    totals.perManday = totals.manDays > 0 ? truncYen(totals.earnings / totals.manDays) : null;
    totals.productivityRatio = totals.laborCost > 0 ? totals.earnings / totals.laborCost : null;
    totals.makeVsBuy = totals.outsourcingEquivalent - totals.laborCost;
    return totals;
}

/** 日付昇順 → 職長名 → 現場名（日本語順） */
function compareRows(a: OwnCrewVolumeRow, b: OwnCrewVolumeRow): number {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.foremanName !== b.foremanName) return a.foremanName.localeCompare(b.foremanName, 'ja');
    return a.projectTitle.localeCompare(b.projectTitle, 'ja');
}

/**
 * 表示月の自社職長の配置 1 件 = 1 行にして、職長ごとのグループと月合計を作る。
 * 行の元は原価エンジンの labor 行（自社職長の配置なら日報が無くても必ず 1 件ある）。
 */
export function buildOwnCrewVolume(params: BuildOwnCrewVolumeParams): BuildOwnCrewVolumeResult {
    const settings = params.settings ?? DEFAULT_VALUE_ADDED_SETTINGS;
    const partnerIds = new Set(params.partnerUserIds);
    const assignmentById = new Map(params.assignments.map(a => [a.assignmentId, a]));

    const rowsByForeman = new Map<string, OwnCrewVolumeRow[]>();
    const foremanNameById = new Map<string, string>();

    for (const project of params.projects) {
        const earnings = computeProjectEarnings(project, settings);
        const amountByType = outsourcingAmountByType(project, params.rates);

        // 種別ごとの自社人工（全期間）。外注換算の日割りの分母
        const headcountByType = new Map<string, number>();
        for (const r of project.laborRows) {
            const name = r.constructionTypeName;
            if (!name) continue;
            headcountByType.set(name, (headcountByType.get(name) ?? 0) + (r.workerCount || 0));
        }

        for (const laborRow of project.laborRows) {
            const assignment = assignmentById.get(laborRow.assignmentId);
            if (!assignment) continue; // 表示月・自社職長の対象外

            const workerCount = laborRow.workerCount || 0;

            // 稼ぎ: 案件の稼ぎ V を案件の総人数 H で割り、この行の人数を掛ける
            const rowEarnings = earnings.valueAdded != null && earnings.headcount > 0
                ? truncYen(earnings.valueAdded / earnings.headcount * workerCount)
                : null;

            // 外注換算: 種別ごとの額をその種別の自社人工で日割り
            const typeName = laborRow.constructionTypeName;
            const typeAmount = typeName != null ? amountByType.get(typeName) : undefined;
            const typeHeadcount = typeName != null ? (headcountByType.get(typeName) ?? 0) : 0;
            const outsourcingEquivalent = typeAmount != null && typeHeadcount > 0
                ? Math.round(typeAmount / typeHeadcount * workerCount)
                : null;

            const flags: OwnCrewVolumeFlag[] = [];
            if (workerCount === 0) flags.push('no_report');
            if (earnings.salesBasis !== 'invoice') flags.push('unbilled');
            if (laborRow.workerIds.some(id => partnerIds.has(id))) flags.push('joyo');
            if (earnings.outsourcingHeavy) flags.push('outsourcing_heavy');
            if (laborRow.override != null) flags.push('labor_override');

            const row: OwnCrewVolumeRow = {
                assignmentId: laborRow.assignmentId,
                date: laborRow.date,
                foremanId: assignment.foremanId,
                foremanName: assignment.foremanName,
                projectMasterId: project.projectMasterId,
                projectTitle: project.projectTitle,
                customerName: project.customerName,
                managerName: project.managerName,
                constructionTypeName: typeName,
                workerCount,
                memberCount: laborRow.memberCount || 0,
                hours: laborRow.hours || 0,
                laborCost: laborRow.effectiveCost || 0,
                outsourcingEquivalent,
                earnings: rowEarnings,
                salesBasis: earnings.salesBasis,
                flags,
            };

            const list = rowsByForeman.get(assignment.foremanId);
            if (list) list.push(row);
            else rowsByForeman.set(assignment.foremanId, [row]);
            foremanNameById.set(assignment.foremanId, assignment.foremanName);
        }
    }

    const totals = emptyOwnCrewVolumeTotals();
    const groups: OwnCrewVolumeGroup[] = [];
    for (const [foremanId, rows] of rowsByForeman) {
        rows.sort(compareRows);
        const groupTotals = emptyOwnCrewVolumeTotals();
        for (const row of rows) {
            addRowToTotals(groupTotals, row);
            addRowToTotals(totals, row);
        }
        groups.push({
            foremanId,
            foremanName: foremanNameById.get(foremanId) ?? '',
            rows,
            totals: finalizeTotals(groupTotals),
        });
    }
    groups.sort((a, b) => a.foremanName.localeCompare(b.foremanName, 'ja'));

    return { groups, totals: finalizeTotals(totals) };
}
