import { prisma } from '@/lib/prisma';
import { parseJsonField } from '@/lib/json-utils';

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
            materialCost: true,
            subcontractorCost: true,
            subcontractorAssemblyCost: true,
            subcontractorDemolitionCost: true,
            otherExpenses: true,
            updatedAt: true,
            _count: {
                select: { assignments: true },
            },
        },
        orderBy: { updatedAt: 'desc' },
    });

    const projectIds = projectMasters.map(pm => pm.id);

    // 全クエリを並列実行
    const [estimates, invoices, settings, workItems, assignments, vehicles, allUsers, allWorkers, foremanShares, constructionTypes] = await Promise.all([
        // 見積書(最新の作成日順)
        prisma.estimate.findMany({
            where: { projectMasterId: { in: projectIds } },
            select: { projectMasterId: true, total: true, costTotal: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        }),
        // 請求書
        prisma.invoice.findMany({
            where: { projectMasterId: { in: projectIds } },
            select: { projectMasterId: true, total: true },
        }),
        // システム設定
        prisma.systemSettings.findFirst(),
        // 日報作業明細
        prisma.dailyReportWorkItem.findMany({
            where: {
                assignment: {
                    projectMasterId: { in: projectIds },
                },
            },
            select: {
                startTime: true,
                endTime: true,
                breakMinutes: true,
                workerIds: true,
                dailyReport: {
                    select: {
                        morningLoadingMinutes: true,
                        eveningLoadingMinutes: true,
                    },
                },
                assignment: {
                    select: {
                        projectMasterId: true,
                        workers: true,
                        memberCount: true,
                    },
                },
            },
        }),
        // 配置情報
        prisma.projectAssignment.findMany({
            where: { projectMasterId: { in: projectIds } },
            select: { projectMasterId: true, vehicles: true },
        }),
        // 車両情報
        prisma.vehicle.findMany({
            select: { id: true, dailyRate: true },
        }),
        // ユーザー時給+表示名
        prisma.user.findMany({
            select: { id: true, hourlyRate: true, displayName: true },
        }),
        // 応援ワーカー時給
        prisma.worker.findMany({
            select: { id: true, hourlyRate: true },
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
    ]);

    // 見積書: 各案件で最新1件を採用(見積額の表示・売上フォールバック用)
    const estimateByProject = new Map<string, number>();
    const estimateCostByProject = new Map<string, number | null>();
    for (const e of estimates) {
        if (!e.projectMasterId) continue;
        // estimates は createdAt desc でソート済み、最初に出てきたものが最新
        if (!estimateByProject.has(e.projectMasterId)) {
            estimateByProject.set(e.projectMasterId, Number(e.total));
        }
        if (e.costTotal != null && !estimateCostByProject.has(e.projectMasterId)) {
            estimateCostByProject.set(e.projectMasterId, e.costTotal);
        }
    }

    // 請求書をグループ化
    const revenueByProject = new Map<string, number>();
    for (const i of invoices) {
        if (i.projectMasterId) {
            revenueByProject.set(
                i.projectMasterId,
                (revenueByProject.get(i.projectMasterId) || 0) + Number(i.total)
            );
        }
    }

    // システム設定から単価計算（個別時給未設定時のフォールバック）
    const laborDailyRate = Number(settings?.laborDailyRate ?? 15000);
    const standardWorkMinutes = settings?.standardWorkMinutes ?? 480;
    const defaultMinuteRate = laborDailyRate / standardWorkMinutes;

    // ユーザー/応援ごとの分単価マップ（hourlyRate / 60）
    const minuteRateMap = new Map<string, number>();
    for (const u of allUsers) {
        minuteRateMap.set(u.id, u.hourlyRate ? Number(u.hourlyRate) / 60 : defaultMinuteRate);
    }
    for (const w of allWorkers) {
        if (!minuteRateMap.has(w.id)) {
            minuteRateMap.set(w.id, w.hourlyRate ? Number(w.hourlyRate) / 60 : defaultMinuteRate);
        }
    }

    // 日報データをプロジェクトごとに集計
    const laborCostByProject = new Map<string, number>();
    const loadingCostByProject = new Map<string, number>();

    for (const item of workItems) {
        const projectId = item.assignment.projectMasterId;

        // 日報workItemのworkerIdsを優先、なければassignment.workersにフォールバック
        const workerIds = item.workerIds.length > 0
            ? item.workerIds
            : parseJsonField<string[]>(item.assignment.workers, []);

        // ワーカーごとの分単価合計
        const sumMinuteRate = workerIds.length > 0
            ? workerIds.reduce((sum, wid) => sum + (minuteRateMap.get(wid) ?? defaultMinuteRate), 0)
            : (item.assignment.memberCount || 1) * defaultMinuteRate;

        // startTime/endTimeから作業分数を計算（休憩時間を差し引き）
        let workMinutes = 0;
        if (item.startTime && item.endTime) {
            const [sh, sm] = item.startTime.split(':').map(Number);
            const [eh, em] = item.endTime.split(':').map(Number);
            workMinutes = Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - (item.breakMinutes || 0));
        }

        // 人件費
        const laborCost = Math.round(workMinutes * sumMinuteRate);
        laborCostByProject.set(
            projectId,
            (laborCostByProject.get(projectId) || 0) + laborCost
        );

        // 積込費
        if (item.dailyReport) {
            const loadingMinutes = item.dailyReport.morningLoadingMinutes + item.dailyReport.eveningLoadingMinutes;
            const loadingCost = Math.round(loadingMinutes * 0.5 * sumMinuteRate);
            loadingCostByProject.set(
                projectId,
                (loadingCostByProject.get(projectId) || 0) + loadingCost
            );
        }
    }

    // 車両費を計算
    const vehicleRates = new Map<string, number>();
    for (const v of vehicles) {
        vehicleRates.set(v.id, Number(v.dailyRate || 0));
    }

    const vehicleCostByProject = new Map<string, number>();
    for (const a of assignments) {
        const vehicleIds: string[] = parseJsonField<string[]>(a.vehicles, []);
        let cost = 0;
        for (const vid of vehicleIds) {
            cost += vehicleRates.get(vid) || 0;
        }
        if (cost > 0) {
            vehicleCostByProject.set(
                a.projectMasterId,
                (vehicleCostByProject.get(a.projectMasterId) || 0) + cost
            );
        }
    }

    // 結果を組み立て
    const profitSummaries: ProjectProfit[] = projectMasters.map(pm => {
        const estimateAmount = estimateByProject.get(pm.id) || 0;
        const estimateCostTotal = estimateCostByProject.get(pm.id) ?? null;
        const invoiceAmount = revenueByProject.get(pm.id) || 0;
        const contractAmount = Number(pm.contractAmount || 0);

        // 売上フォールバック: 請求書 → 契約金額 → 見積金額
        let revenue = 0;
        let revenueSource: RevenueSource = 'none';
        if (invoiceAmount > 0) {
            revenue = invoiceAmount;
            revenueSource = 'invoice';
        } else if (contractAmount > 0) {
            revenue = contractAmount;
            revenueSource = 'contract';
        } else if (estimateAmount > 0) {
            revenue = estimateAmount;
            revenueSource = 'estimate';
        }

        const laborCost = laborCostByProject.get(pm.id) || 0;
        const loadingCost = loadingCostByProject.get(pm.id) || 0;
        const vehicleCost = vehicleCostByProject.get(pm.id) || 0;
        const materialCost = Number(pm.materialCost || 0);
        const subcontractorCost =
            Number(pm.subcontractorCost || 0)
            + Number(pm.subcontractorAssemblyCost || 0)
            + Number(pm.subcontractorDemolitionCost || 0);
        const otherExpenses = Number(pm.otherExpenses || 0);

        const totalCost = laborCost + loadingCost + vehicleCost + materialCost + subcontractorCost + otherExpenses;
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
