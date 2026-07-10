import { prisma } from '@/lib/prisma';
import { parseJsonField } from '@/lib/json-utils';
import { calcTimeDiffMinutes } from '@/utils/dateUtils';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { computeProjectCosts } from '@/lib/projectCost';

export type RevenueSource = 'invoice' | 'contract' | 'estimate' | 'none';

export interface ProjectProfit {
    id: string;
    title: string;
    customerName: string | null;
    status: string;
    assignmentCount: number;
    estimateAmount: number;
    estimateCostTotal: number | null;
    contractAmount: number;
    invoiceAmount: number;
    revenue: number;
    revenueSource: RevenueSource;
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
    totalCost: number;
    grossProfit: number;
    profitMargin: number;
    updatedAt: Date;
}

export interface DashboardSummary {
    totalProjects: number;
    totalRevenue: number;
    totalCost: number;
    totalGrossProfit: number;
    averageProfitMargin: number;
}

export interface AggregateRow {
    key: string;
    name: string;
    revenue: number;
    totalCost: number;
    grossProfit: number;
    profitMargin: number;
    projectCount: number;
}

export interface DashboardData {
    projects: ProjectProfit[];
    summary: DashboardSummary;
    byCustomer: AggregateRow[];
    byConstructionType: AggregateRow[];
    byForeman: AggregateRow[];
}

export interface DashboardFilters {
    status?: string;
    dateFrom?: string;            // YYYY-MM-DD（アサイン日基準）
    dateTo?: string;              // YYYY-MM-DD
    customerNames?: string[];
    foremanIds?: string[];
    constructionTypeIds?: string[];
}

export interface FilterOptions {
    customers: string[];
    foremen: { id: string; name: string }[];
    constructionTypes: { id: string; name: string }[];
}

export interface MonthlySalesPoint {
    year: number;          // JST 年
    month: number;         // JST 月 (1-12)
    sales: number;         // その JST 月に発行された Invoice.total(税込) 合計、cancelled 除外
    invoiceCount: number;
}

export interface MonthlySalesData {
    current: MonthlySalesPoint;     // 当月
    previous: MonthlySalesPoint;    // 前月
    momDelta: number;               // current.sales - previous.sales
    momPercent: number | null;      // 前月比%（前月 0 のとき null）
    trend: MonthlySalesPoint[];     // 直近 monthsBack ヶ月（古い→新しい、末尾が当月）
}

/** allocateLaborCostByProject が受け取る日報作業明細の最小形状。 */
export interface LaborWorkItem {
    id: string;
    startTime: string | null;
    endTime: string | null;
    breakMinutes: number | null;
    workerIds: string[];
    dailyReport: { date: Date } | null;
    assignment: {
        projectMasterId: string;
        workers: string | null;
        memberCount: number;
        assignedEmployeeId: string;
    };
}

/**
 * 日報作業明細から案件ごとの人件費を算出する（worker×日ごとに日当を分単位で按分・100円丸め、端数は最大案件で吸収）。
 * 協力業者(role=partner)職長のアサインに紐づく作業は人件費に計上しない（協力業者費へ統合されるため）。
 * `fetchProfitDashboardData`（全期間）と `fetchMonthlyAssigneeBreakdown`（当月のみ）で共有する純関数。
 */
export function allocateLaborCostByProject(
    workItems: LaborWorkItem[],
    params: { dailyRateMap: Map<string, number>; defaultDailyRate: number; partnerForemanIdSet: Set<string> },
): Map<string, number> {
    const { dailyRateMap, defaultDailyRate, partnerForemanIdSet } = params;

    // (workerId, dateStr) ごとに { projectId, minutes } を集める
    type WorkerDayEntry = { projectId: string; minutes: number };
    const workerDayMap = new Map<string, Map<string, WorkerDayEntry[]>>();

    for (const item of workItems) {
        if (!item.dailyReport) continue;
        // 協力業者foremanのassignmentに紐づく作業は labor cost を計上しない（協力業者費に統合）
        if (partnerForemanIdSet.has(item.assignment.assignedEmployeeId)) continue;
        const dateStr = new Date(item.dailyReport.date).toISOString().slice(0, 10);

        let minutes = 0;
        if (item.startTime && item.endTime) {
            minutes = Math.max(0, calcTimeDiffMinutes(item.startTime, item.endTime) - (item.breakMinutes || 0));
        }
        if (minutes <= 0) continue;

        // 日報workItemのworkerIdsを優先、なければassignment.workersにフォールバック
        let workerIds = item.workerIds.length > 0
            ? item.workerIds
            : parseJsonField<string[]>(item.assignment.workers, []);

        // それでも空ならmemberCountから合成IDを生成（assignment+itemに紐づく一人として扱う）
        if (workerIds.length === 0) {
            const count = item.assignment.memberCount || 1;
            workerIds = Array.from({ length: count }, (_, i) => `__fb__:${item.id}:${i}`);
        }

        for (const wid of workerIds) {
            let dayMap = workerDayMap.get(wid);
            if (!dayMap) { dayMap = new Map(); workerDayMap.set(wid, dayMap); }
            const arr = dayMap.get(dateStr);
            if (arr) arr.push({ projectId: item.assignment.projectMasterId, minutes });
            else dayMap.set(dateStr, [{ projectId: item.assignment.projectMasterId, minutes }]);
        }
    }

    // 日当ベースで按分計算（100円単位、最大案件で端数吸収）
    const laborCostByProject = new Map<string, number>();

    for (const [wid, dayMap] of workerDayMap) {
        const dailyRate = dailyRateMap.get(wid) ?? defaultDailyRate;
        for (const entries of dayMap.values()) {
            // 同一workerの同日エントリをproject単位で合算
            const projectMinutes = new Map<string, number>();
            let totalMinutes = 0;
            for (const e of entries) {
                projectMinutes.set(e.projectId, (projectMinutes.get(e.projectId) || 0) + e.minutes);
                totalMinutes += e.minutes;
            }
            if (totalMinutes <= 0) continue;

            // 100円単位四捨五入
            const allocations = Array.from(projectMinutes.entries()).map(([pid, mins]) => ({
                projectId: pid,
                minutes: mins,
                amount: Math.round((dailyRate * mins / totalMinutes) / 100) * 100,
            }));

            // 端数を最大案件で吸収
            const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
            const diff = dailyRate - allocSum;
            if (diff !== 0 && allocations.length > 0) {
                const maxIdx = allocations.reduce((mi, a, i, arr) => a.minutes > arr[mi].minutes ? i : mi, 0);
                allocations[maxIdx].amount += diff;
            }

            for (const a of allocations) {
                laborCostByProject.set(a.projectId, (laborCostByProject.get(a.projectId) || 0) + a.amount);
            }
        }
    }

    return laborCostByProject;
}

export async function fetchDashboardFilterOptions(): Promise<FilterOptions> {
    const [customerRows, assignedForemen, types] = await Promise.all([
        prisma.projectMaster.findMany({
            where: { customerName: { not: null } },
            select: { customerName: true },
            distinct: ['customerName'],
            orderBy: { customerName: 'asc' },
        }),
        // 実際にアサイン実績のある職長IDのみを抽出
        prisma.projectAssignment.findMany({
            select: { assignedEmployeeId: true },
            distinct: ['assignedEmployeeId'],
        }),
        prisma.constructionType.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { sortOrder: 'asc' },
        }),
    ]);

    const foremanIds = assignedForemen.map(a => a.assignedEmployeeId).filter(Boolean);
    const foremanUsers = foremanIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: foremanIds } },
            select: { id: true, displayName: true },
            orderBy: { displayName: 'asc' },
        })
        : [];

    return {
        customers: customerRows.map(c => c.customerName!).filter(Boolean),
        foremen: foremanUsers.map(f => ({ id: f.id, name: f.displayName })),
        constructionTypes: types,
    };
}

/**
 * 利益ダッシュボードのデータを取得
 * Server ComponentとAPIの両方から使用可能
 */
export async function fetchProfitDashboardData(
    statusOrFilters: string | DashboardFilters = 'all',
): Promise<DashboardData> {
    const filters: DashboardFilters = typeof statusOrFilters === 'string'
        ? { status: statusOrFilters }
        : statusOrFilters;
    const status = filters.status ?? 'all';

    // 案件マスター一覧を取得
    const where: Record<string, unknown> = {};
    if (status !== 'all') {
        where.status = status;
    }
    if (filters.customerNames && filters.customerNames.length > 0) {
        where.customerName = { in: filters.customerNames };
    }
    if (filters.constructionTypeIds && filters.constructionTypeIds.length > 0) {
        where.constructionType = { in: filters.constructionTypeIds };
    }
    // 期間 + 職長条件は同一アサインに対する条件
    const assignmentSome: Record<string, unknown> = {};
    if (filters.dateFrom || filters.dateTo) {
        const dateCond: Record<string, Date> = {};
        if (filters.dateFrom) dateCond.gte = new Date(`${filters.dateFrom}T00:00:00`);
        if (filters.dateTo) dateCond.lte = new Date(`${filters.dateTo}T23:59:59.999`);
        assignmentSome.date = dateCond;
    }
    if (filters.foremanIds && filters.foremanIds.length > 0) {
        assignmentSome.assignedEmployeeId = { in: filters.foremanIds };
    }
    if (Object.keys(assignmentSome).length > 0) {
        where.assignments = { some: assignmentSome };
    }

    // 基本クエリ: 案件一覧
    const projectMasters = await prisma.projectMaster.findMany({
        where,
        select: {
            id: true,
            title: true,
            customerName: true,
            status: true,
            constructionType: true,
            contractAmount: true,
            updatedAt: true,
            _count: {
                select: { assignments: true },
            },
        },
        orderBy: { updatedAt: 'desc' },
    });

    const projectIds = projectMasters.map(pm => pm.id);

    // 全クエリを並列実行（原価は共通エンジン computeProjectCosts に一本化）
    const [estimates, invoices, allUsers, foremanShares, constructionTypes, costMap] = await Promise.all([
        // 見積書(最新の作成日順)。売上は税抜(subtotal)で扱う
        prisma.estimate.findMany({
            where: { projectMasterId: { in: projectIds } },
            select: { projectMasterId: true, subtotal: true, costTotal: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        }),
        // 請求書。売上は税抜(subtotal)で扱う
        prisma.invoice.findMany({
            where: { projectMasterId: { in: projectIds } },
            select: { projectMasterId: true, subtotal: true },
        }),
        // 職長名の解決（byForeman 集計用）
        prisma.user.findMany({
            select: { id: true, displayName: true },
        }),
        // 職長別アサイン件数(各案件における按分計算用)
        prisma.projectAssignment.groupBy({
            by: ['projectMasterId', 'assignedEmployeeId'],
            where: { projectMasterId: { in: projectIds } },
            _count: { _all: true },
        }),
        // 工事種別マスター(名前解決)
        prisma.constructionType.findMany({
            select: { id: true, name: true },
        }),
        // 案件原価（人件費＋車両費＋材料費＋外注費＋その他、配置ごと上書き込み）
        computeProjectCosts(projectIds),
    ]);

    // 見積書: 各案件で全件合算(追加見積書を含む。見積額の表示・売上フォールバック用)。税抜(subtotal)
    const estimateByProject = new Map<string, number>();
    const estimateCostByProject = new Map<string, number | null>();
    for (const e of estimates) {
        if (!e.projectMasterId) continue;
        estimateByProject.set(
            e.projectMasterId,
            (estimateByProject.get(e.projectMasterId) || 0) + Number(e.subtotal)
        );
        if (e.costTotal != null) {
            const cur = estimateCostByProject.get(e.projectMasterId);
            estimateCostByProject.set(e.projectMasterId, (cur ?? 0) + e.costTotal);
        }
    }

    // 請求書をグループ化。税抜(subtotal)
    const revenueByProject = new Map<string, number>();
    for (const i of invoices) {
        if (i.projectMasterId) {
            revenueByProject.set(
                i.projectMasterId,
                (revenueByProject.get(i.projectMasterId) || 0) + Number(i.subtotal)
            );
        }
    }

    // 結果を組み立て（原価は costMap＝computeProjectCosts から取得）
    const profitSummaries: ProjectProfit[] = projectMasters.map(pm => {
        const estimateAmount = estimateByProject.get(pm.id) || 0;
        const estimateCostTotal = estimateCostByProject.get(pm.id) ?? null;
        const invoiceAmount = revenueByProject.get(pm.id) || 0;
        const contractAmount = Number(pm.contractAmount || 0);

        // 売上フォールバック: 請求書 → 見積金額 → 足場工事金額（案件詳細の利益タブと同順）
        let revenue = 0;
        let revenueSource: RevenueSource = 'none';
        if (invoiceAmount > 0) {
            revenue = invoiceAmount;
            revenueSource = 'invoice';
        } else if (estimateAmount > 0) {
            revenue = estimateAmount;
            revenueSource = 'estimate';
        } else if (contractAmount > 0) {
            revenue = contractAmount;
            revenueSource = 'contract';
        }

        // 原価は共通エンジン（人件費＋車両費＋材料費＋外注費＋その他、配置ごと上書き込み）
        const cb = costMap.get(pm.id)?.breakdown;
        const laborCost = cb?.laborCost ?? 0;
        const loadingCost = cb?.loadingCost ?? 0;
        const vehicleCost = cb?.vehicleCost ?? 0;
        const materialCost = cb?.materialCost ?? 0;
        const subcontractorCost = cb?.subcontractorCost ?? 0;
        const otherExpenses = cb?.otherExpenses ?? 0;
        const totalCost = cb?.totalCost ?? 0;
        const grossProfit = revenue - totalCost;
        const profitMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

        return {
            id: pm.id,
            title: pm.title,
            customerName: pm.customerName,
            status: pm.status,
            assignmentCount: pm._count.assignments,
            estimateAmount,
            estimateCostTotal,
            contractAmount,
            invoiceAmount,
            revenue,
            revenueSource,
            laborCost,
            loadingCost,
            vehicleCost,
            materialCost,
            subcontractorCost,
            otherExpenses,
            totalCost,
            grossProfit,
            profitMargin,
            updatedAt: pm.updatedAt,
        };
    });

    // 集計
    const summary: DashboardSummary = {
        totalProjects: profitSummaries.length,
        totalRevenue: profitSummaries.reduce((sum, p) => sum + p.revenue, 0),
        totalCost: profitSummaries.reduce((sum, p) => sum + p.totalCost, 0),
        totalGrossProfit: profitSummaries.reduce((sum, p) => sum + p.grossProfit, 0),
        averageProfitMargin: profitSummaries.length > 0
            ? Math.round(profitSummaries.reduce((sum, p) => sum + p.profitMargin, 0) / profitSummaries.length * 10) / 10
            : 0,
    };

    // 案件IDから工事種別ID/顧客名のマップを作成
    const projectMetaMap = new Map<string, { customerName: string | null; constructionType: string }>();
    for (const pm of projectMasters) {
        projectMetaMap.set(pm.id, {
            customerName: pm.customerName,
            constructionType: pm.constructionType || '',
        });
    }

    const constructionTypeNameMap = new Map<string, string>();
    for (const ct of constructionTypes) {
        constructionTypeNameMap.set(ct.id, ct.name);
    }
    // レガシー値の名前
    constructionTypeNameMap.set('assembly', '組立');
    constructionTypeNameMap.set('demolition', '解体');
    constructionTypeNameMap.set('other', 'その他');

    // 案件ごとのアサイン総数(按分用の分母)
    const totalAssignByProject = new Map<string, number>();
    for (const row of foremanShares) {
        const cnt = row._count._all;
        totalAssignByProject.set(
            row.projectMasterId,
            (totalAssignByProject.get(row.projectMasterId) || 0) + cnt
        );
    }

    const userNameMap = new Map<string, string>();
    for (const u of allUsers) {
        userNameMap.set(u.id, u.displayName);
    }

    function buildAggregate(
        keyOf: (p: ProjectProfit) => { key: string; name: string } | null,
    ): AggregateRow[] {
        const map = new Map<string, AggregateRow>();
        for (const p of profitSummaries) {
            const k = keyOf(p);
            if (!k) continue;
            const cur = map.get(k.key) ?? {
                key: k.key,
                name: k.name,
                revenue: 0,
                totalCost: 0,
                grossProfit: 0,
                profitMargin: 0,
                projectCount: 0,
            };
            cur.revenue += p.revenue;
            cur.totalCost += p.totalCost;
            cur.grossProfit += p.grossProfit;
            cur.projectCount += 1;
            map.set(k.key, cur);
        }
        const rows = Array.from(map.values());
        for (const r of rows) {
            r.profitMargin = r.revenue > 0 ? Math.round((r.grossProfit / r.revenue) * 1000) / 10 : 0;
        }
        rows.sort((a, b) => b.grossProfit - a.grossProfit);
        return rows;
    }

    const byCustomer = buildAggregate(p => ({
        key: p.customerName ?? '__unset__',
        name: p.customerName ?? '(未設定)',
    }));

    const byConstructionType = buildAggregate(p => {
        const meta = projectMetaMap.get(p.id);
        const ctId = meta?.constructionType || '';
        const name = constructionTypeNameMap.get(ctId) || (ctId ? ctId : '(未設定)');
        return { key: ctId || '__unset__', name };
    });

    // 職長別: アサイン件数で按分
    const foremanMap = new Map<string, AggregateRow & { _projectIds: Set<string> }>();
    for (const row of foremanShares) {
        const project = profitSummaries.find(p => p.id === row.projectMasterId);
        if (!project) continue;
        const total = totalAssignByProject.get(row.projectMasterId) || 0;
        if (total === 0) continue;
        const ratio = row._count._all / total;
        const fid = row.assignedEmployeeId;
        const cur = foremanMap.get(fid) ?? {
            key: fid,
            name: userNameMap.get(fid) || '(不明)',
            revenue: 0,
            totalCost: 0,
            grossProfit: 0,
            profitMargin: 0,
            projectCount: 0,
            _projectIds: new Set<string>(),
        };
        cur.revenue += project.revenue * ratio;
        cur.totalCost += project.totalCost * ratio;
        cur.grossProfit += project.grossProfit * ratio;
        cur._projectIds.add(row.projectMasterId);
        foremanMap.set(fid, cur);
    }
    const byForeman: AggregateRow[] = Array.from(foremanMap.values()).map(r => ({
        key: r.key,
        name: r.name,
        revenue: Math.round(r.revenue),
        totalCost: Math.round(r.totalCost),
        grossProfit: Math.round(r.grossProfit),
        profitMargin: r.revenue > 0 ? Math.round((r.grossProfit / r.revenue) * 1000) / 10 : 0,
        projectCount: r._projectIds.size,
    })).sort((a, b) => b.grossProfit - a.grossProfit);

    return {
        projects: profitSummaries,
        summary,
        byCustomer,
        byConstructionType,
        byForeman,
    };
}

/**
 * 「今月の売上」とその月次推移を集計する（請求日ベース）。
 *
 * - 売上＝当該 JST 月に作成された請求書（Invoice）の total(税込) 合計（kei 決定 2026-07-07。
 *   税抜統一で一度 subtotal にしたが、月商は請求額＝税込の感覚で見たいとの要望で税込へ戻した。
 *   担当者別/顧客別内訳 fetchMonthlyAssigneeBreakdown は粗利＝売上−原価(税抜)の正確さを保つため税抜のまま）。
 *   `Invoice.createdAt` が請求日（作成日）として保存されている（InvoiceForm の請求日入力 → createdAt、
 *   BillingDraft 確定経由は確定時刻）。
 * - 計上対象は **送付済み以降**（status: sent/paid/overdue）。下書き・担当確認済み・取消は除外（kei 決定 2026-06-02）。
 *   現在ステータスで判定するため、過去月の値は後からステータスが進む/戻ると変動しうる。
 * - 本番サーバは UTC 稼働のため、月境界は JST(UTC+9) で算出する
 *   （`Date.UTC(y, m, d, -9, …)` ＝ JST 00:00。app/api/partner-schedule/route.ts と同じイディオム）。
 * - フィルタ非依存の全社・当月 KPI。返り値は number/string のみ（API/server props 双方でそのまま JSON 化可能）。
 *
 * @param monthsBack trend に含める月数（末尾が当月）
 * @param now 基準時刻（テスト用に注入可能）
 */
// 売上として計上する請求書ステータス（送付済み以降）。下書き/担当確認済み/取消は除外。
export const SALES_INVOICE_STATUSES = ['sent', 'paid', 'overdue'] as const;

export async function fetchMonthlySales(
    monthsBack = 12,
    now: Date = new Date(),
): Promise<MonthlySalesData> {
    // JST 現在の年月（UTC+9 にずらして年月を取り出す）
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const y = jstNow.getUTCFullYear();
    const m = jstNow.getUTCMonth(); // 0-based

    // クエリ範囲: (monthsBack-1)ヶ月前の月初(JST) 〜 翌月初(JST)
    const rangeStart = new Date(Date.UTC(y, m - (monthsBack - 1), 1, -9, 0, 0, 0));
    const rangeEnd = new Date(Date.UTC(y, m + 1, 1, -9, 0, 0, 0));

    const invoices = await prisma.invoice.findMany({
        where: {
            createdAt: { gte: rangeStart, lt: rangeEnd },
            status: { in: [...SALES_INVOICE_STATUSES] },
        },
        select: { total: true, createdAt: true },
    });

    // 月バケットを古い順に生成（Date.UTC は月のアンダーフローを正規化＝年跨ぎ対応）
    const trend: MonthlySalesPoint[] = [];
    const indexByKey = new Map<string, number>();
    for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - i, 1));
        const yy = d.getUTCFullYear();
        const mm = d.getUTCMonth(); // 0-based
        indexByKey.set(`${yy}-${mm}`, trend.length);
        trend.push({ year: yy, month: mm + 1, sales: 0, invoiceCount: 0 });
    }

    for (const inv of invoices) {
        const jst = new Date(inv.createdAt.getTime() + 9 * 60 * 60 * 1000);
        const idx = indexByKey.get(`${jst.getUTCFullYear()}-${jst.getUTCMonth()}`);
        if (idx == null) continue;
        trend[idx].sales += Number(inv.total);
        trend[idx].invoiceCount += 1;
    }

    const current = trend[trend.length - 1];
    const previous = trend.length >= 2
        ? trend[trend.length - 2]
        : { year: current.year, month: current.month, sales: 0, invoiceCount: 0 };
    const momDelta = current.sales - previous.sales;
    const momPercent = previous.sales > 0
        ? Math.round((momDelta / previous.sales) * 1000) / 10
        : null;

    return { current, previous, momDelta, momPercent, trend };
}

// 案件担当者が未設定の案件・案件無し請求を集約する擬似担当者ID。
export const UNASSIGNED_ASSIGNEE_ID = '__unassigned__';

// 集計の軸（担当者別 / 顧客別）と期間（当月 / 年間＝暦年1-12月）。
export type BreakdownAxis = 'assignee' | 'customer';
export type BreakdownPeriod = 'month' | 'year';

// グループ（担当者 or 顧客）を展開したときの案件1件ぶんの明細行。
export interface MonthlyAssigneeProjectRow {
    projectId: string;          // ProjectMaster.id。'' = 案件なし請求
    projectName: string;        // 正式名称（title＝敬称・工事名称込み）
    customerName: string;       // 顧客名（無ければ ''）
    sales: number;              // 期間内の請求書(税抜)のうちこの案件ぶん
    cost: number;               // 案件の確定原価（computeProjectCosts。配置上書き・材料費等込み）
    grossProfit: number;
}

// 集計グループ（担当者 or 顧客）1件ぶん。
export interface MonthlyAssigneeRow {
    key: string;               // 担当者ID or 顧客キー（識別子 & React key）
    name: string;
    sales: number;             // items の合計
    cost: number;              // items の原価合計
    grossProfit: number;       // sales - cost
    items: MonthlyAssigneeProjectRow[]; // このグループの案件明細
}

export interface MonthlyAssigneeBreakdown {
    year: number;
    month: number;             // 1-12 (JST)。period='year' のときは対象年のみ意味を持つ
    axis: BreakdownAxis;
    period: BreakdownPeriod;
    rows: MonthlyAssigneeRow[];
    totals: { sales: number; cost: number; grossProfit: number };
}

const NO_CUSTOMER_KEY = '__nocustomer__';

/**
 * 指定期間（当月 or 暦年）に **請求のあった案件** の「担当者別 / 顧客別」売上・原価・粗利を集計する。
 *
 * - 対象: 期間内に発行(createdAt)した請求書がある案件のみ（未請求の案件は一覧に出さない）。
 * - 売上: 期間内の請求書(送付済み以降, 税抜 subtotal)。複数案件まとめ請求は明細額で案件按分。
 * - 原価＝**繰越方式**（kei決定 2026-07-10・未成工事支出金の考え方）:
 *   「その請求月の原価 ＝ その月末までに発生した原価のうち、まだ過去の請求月に計上していない分」。
 *   実装は累積差分＝ cost(請求月mi) = C(mi月末) − C(直前請求月末)。最新請求月のみ上限なし（C(∞)）で
 *   請求後に発生した原価も取りこぼさない。C は `computeProjectCosts` の cutoffs オプションで一括取得。
 *   これにより1案件を複数月に分割請求しても原価は二重計上されず、全請求月の原価合計＝案件の確定原価。
 *   日付を持たない原価（旧スカラー・日付未入力の手入力明細・発行日なし仕入請求書）は初回請求月に計上。
 *   原価の手修正は案件詳細（利益タブの配置別上書き＋手入力明細[発生日つき]）に一本化。ここは表示のみ。
 * - axis='assignee' は主担当（`extractAssigneeIds(createdBy)[0]`）、'customer' は案件の顧客名でグルーピング。明細は顧客名→案件名順。
 */
export async function fetchMonthlyAssigneeBreakdown(params: {
    year: number;
    month: number; // 1-12 (JST)
    axis?: BreakdownAxis;
    period?: BreakdownPeriod;
}): Promise<MonthlyAssigneeBreakdown> {
    const { year, month } = params;
    const axis: BreakdownAxis = params.axis ?? 'assignee';
    const period: BreakdownPeriod = params.period ?? 'month';
    const m0 = month - 1; // 0-based

    // 期間の JST 範囲（JST 00:00 = 前日 UTC 15:00。hour に -9）
    const rangeStart = period === 'year'
        ? new Date(Date.UTC(year, 0, 1, -9, 0, 0, 0))
        : new Date(Date.UTC(year, m0, 1, -9, 0, 0, 0));
    const rangeEnd = period === 'year'
        ? new Date(Date.UTC(year + 1, 0, 1, -9, 0, 0, 0))
        : new Date(Date.UTC(year, m0 + 1, 1, -9, 0, 0, 0));

    // 1段目: 送付済み以降の**全期間**の請求書＋担当者名。
    // 期間内売上と「案件→請求月集合」（繰越方式のカットオフ算出用）を同じ按分ロジックで作る。
    const [allInvoices, allUsers] = await Promise.all([
        prisma.invoice.findMany({
            where: { status: { in: [...SALES_INVOICE_STATUSES] } },
            select: { createdAt: true, subtotal: true, items: true, projectMasterId: true },
        }),
        prisma.user.findMany({ select: { id: true, displayName: true } }),
    ]);
    const userNameMap = new Map<string, string>();
    for (const u of allUsers) userNameMap.set(u.id, u.displayName);

    // 請求書1枚の売上(税抜 subtotal)を案件へ按分する（明細タグ按分 → projectMasterId 直付け → 案件なし）。
    // 期間内売上と請求月集合の両方でこの同一ロジックを使い、対象案件のズレを防ぐ。
    const attributeInvoice = (inv: { subtotal: unknown; items: string | null; projectMasterId: string | null }) => {
        const byProject = new Map<string, number>();
        let projectless = 0;
        const subtotal = Number(inv.subtotal); // 税抜
        if (!subtotal) return { byProject, projectless };
        const items = parseJsonField<Array<{ projectMasterId?: string | null; amount?: number | string | null }>>(inv.items, []);
        const projAmount = new Map<string, number>();
        for (const it of items) {
            if (!it.projectMasterId) continue;
            const n = Number(it.amount);
            projAmount.set(it.projectMasterId, (projAmount.get(it.projectMasterId) || 0) + (Number.isFinite(n) ? n : 0));
        }
        const totalTagged = [...projAmount.values()].reduce((s, v) => s + v, 0);
        if (projAmount.size > 0 && totalTagged > 0) {
            for (const [pid, amt] of projAmount) byProject.set(pid, subtotal * (amt / totalTagged));
        } else if (inv.projectMasterId) {
            byProject.set(inv.projectMasterId, subtotal);
        } else {
            projectless = subtotal;
        }
        return { byProject, projectless };
    };

    // ---- 期間内売上（案件ごと）と、全期間の「案件→JST請求月→按分売上」を同時に作る ----
    const jstMonthKeyOf = (d: Date) => {
        const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
        return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const salesByProject = new Map<string, number>();                   // 期間内（表示用）
    let projectlessSales = 0;                                           // 期間内・案件なし
    const monthSalesByProject = new Map<string, Map<string, number>>(); // 全期間: pid → (月キー → 按分売上)
    for (const inv of allInvoices) {
        const { byProject, projectless } = attributeInvoice(inv);
        const inRange = inv.createdAt >= rangeStart && inv.createdAt < rangeEnd;
        if (inRange) projectlessSales += projectless;
        if (byProject.size === 0) continue;
        const mKey = jstMonthKeyOf(inv.createdAt);
        for (const [pid, amt] of byProject) {
            let mm = monthSalesByProject.get(pid);
            if (!mm) { mm = new Map(); monthSalesByProject.set(pid, mm); }
            mm.set(mKey, (mm.get(mKey) || 0) + amt);
            if (inRange) salesByProject.set(pid, (salesByProject.get(pid) || 0) + amt);
        }
    }

    // 当該期間に「請求のある」案件だけを対象にする（未請求の案件は一覧に出さない）
    const billedPids = [...salesByProject.keys()].filter(pid => (salesByProject.get(pid) || 0) > 0);

    // ---- 繰越方式のカットオフ算出 ----
    // 各案件の請求月列（按分後売上>0 の JST 月キー・昇順）から、
    //   upper = 期間内最終請求月の月末（その月が案件の最新請求月なら null=上限なし → 請求後の原価も拾う）
    //   lower = 期間より前の最終請求月の月末（なければ減算なし＝日付なし原価も初回請求月に落ちる）
    // とし、原価 = C(upper) − C(lower)（累積差分＝望遠鏡和で全請求月の合計が案件の確定原価に一致）。
    // distinct なカットオフをまとめ、computeProjectCosts は1回だけ呼ぶ。
    const endOfMonthKey = (key: string): Date => {
        const [ky, km] = key.split('-').map(Number); // km は 1-based → Date.UTC の 0-based 月にそのまま渡すと翌月
        return new Date(Date.UTC(ky, km, 1, -9, 0, 0, 0)); // JST 翌月1日 00:00（排他上限）
    };
    const periodStartKey = period === 'year' ? `${year}-01` : `${year}-${String(month).padStart(2, '0')}`;
    const periodEndKey = period === 'year' ? `${year}-12` : periodStartKey;

    const cutoffs: (Date | null)[] = [];
    const cutoffIndex = new Map<string, number>(); // 'inf' または ISO文字列 → cutoffs の添字
    const indexOfCutoff = (c: Date | null): number => {
        const k = c === null ? 'inf' : c.toISOString();
        let i = cutoffIndex.get(k);
        if (i === undefined) { i = cutoffs.length; cutoffs.push(c); cutoffIndex.set(k, i); }
        return i;
    };
    const costCutsByPid = new Map<string, { upperIdx: number; lowerIdx: number | null }>();
    for (const pid of billedPids) {
        const months = [...(monthSalesByProject.get(pid) ?? new Map<string, number>())]
            .filter(([, amt]) => amt > 0).map(([k]) => k).sort();
        const latest = months[months.length - 1];
        const lastInPeriod = months.filter(k => k >= periodStartKey && k <= periodEndKey).pop();
        const prevBefore = months.filter(k => k < periodStartKey).pop();
        // billedPids の定義上 lastInPeriod は必ず存在する（同じ按分で期間内売上>0）。万一欠けても上限なしに落として安全側。
        const upper: Date | null = !lastInPeriod || lastInPeriod === latest ? null : endOfMonthKey(lastInPeriod);
        costCutsByPid.set(pid, {
            upperIdx: indexOfCutoff(upper),
            lowerIdx: prevBefore ? indexOfCutoff(endOfMonthKey(prevBefore)) : null,
        });
    }

    // 2段目: 共通原価エンジン（カットオフ一括・クエリ数は従来と同じ）＋案件メタ
    const [costMap, projects] = await Promise.all([
        computeProjectCosts(billedPids, { cutoffs }),
        billedPids.length > 0
            ? prisma.projectMaster.findMany({
                where: { id: { in: billedPids } },
                select: { id: true, createdBy: true, name: true, title: true, customerName: true },
            })
            : Promise.resolve([]),
    ]);

    // 案件メタ（正式名称＝title／顧客名／主担当）
    const principalByProject = new Map<string, string>();
    const projectNameMap = new Map<string, string>();
    const customerByProject = new Map<string, string>();
    for (const p of projects) {
        principalByProject.set(p.id, extractAssigneeIds(p.createdBy ?? undefined)[0] ?? UNASSIGNED_ASSIGNEE_ID);
        projectNameMap.set(p.id, p.title || p.name || '(案件名なし)');
        customerByProject.set(p.id, p.customerName || '');
    }

    // ---- 案件ごとの明細を作る（請求のある案件のみ） ----
    type Agg = MonthlyAssigneeProjectRow & { assigneeId: string };
    const aggs: Agg[] = [];
    for (const pid of billedPids) {
        const sales = Math.round(salesByProject.get(pid) || 0);
        // 繰越方式: C(期間内最終請求月末 or ∞) − C(直前請求月末)。単月請求の案件は総原価そのまま（従来と一致）。
        const cuts = costCutsByPid.get(pid);
        const totals = costMap.get(pid)?.totalsAtCutoffs;
        const upperVal = cuts ? (totals?.[cuts.upperIdx] ?? 0) : 0;
        const lowerVal = cuts && cuts.lowerIdx !== null ? (totals?.[cuts.lowerIdx] ?? 0) : 0;
        const cost = Math.round(upperVal - lowerVal);
        aggs.push({
            projectId: pid,
            projectName: projectNameMap.get(pid) || '(案件名なし)',
            customerName: customerByProject.get(pid) || '',
            assigneeId: principalByProject.get(pid) ?? UNASSIGNED_ASSIGNEE_ID,
            sales, cost, grossProfit: sales - cost,
        });
    }
    if (projectlessSales > 0) {
        const s = Math.round(projectlessSales);
        aggs.push({
            projectId: '', projectName: '(案件なし)', customerName: '',
            assigneeId: UNASSIGNED_ASSIGNEE_ID,
            sales: s, cost: 0, grossProfit: s,
        });
    }

    // ---- 軸でグルーピング ----
    const groupKeyOf = (a: Agg) => axis === 'assignee' ? a.assigneeId : (a.customerName || NO_CUSTOMER_KEY);
    const groupNameOf = (a: Agg) => axis === 'assignee'
        ? (a.assigneeId === UNASSIGNED_ASSIGNEE_ID ? '(担当者未設定)' : (userNameMap.get(a.assigneeId) || '(不明)'))
        : (a.customerName || '(顧客未設定)');

    const groups = new Map<string, { name: string; items: MonthlyAssigneeProjectRow[] }>();
    for (const a of aggs) {
        const key = groupKeyOf(a);
        let g = groups.get(key);
        if (!g) { g = { name: groupNameOf(a), items: [] }; groups.set(key, g); }
        g.items.push({
            projectId: a.projectId, projectName: a.projectName, customerName: a.customerName,
            sales: a.sales, cost: a.cost, grossProfit: a.grossProfit,
        });
    }

    const collator = new Intl.Collator('ja');
    const rows: MonthlyAssigneeRow[] = [...groups.entries()].map(([key, g]) => {
        const items = g.items.sort((a, b) =>
            collator.compare(a.customerName, b.customerName) || collator.compare(a.projectName, b.projectName));
        const sales = items.reduce((s, i) => s + i.sales, 0);
        const cost = items.reduce((s, i) => s + i.cost, 0);
        return { key, name: g.name, sales, cost, grossProfit: sales - cost, items };
    }).sort((a, b) => b.sales - a.sales || b.grossProfit - a.grossProfit);

    const totals = rows.reduce(
        (t, r) => { t.sales += r.sales; t.cost += r.cost; t.grossProfit += r.grossProfit; return t; },
        { sales: 0, cost: 0, grossProfit: 0 },
    );

    return { year, month, axis, period, rows, totals };
}
