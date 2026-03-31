import { prisma } from '@/lib/prisma';
import { parseJsonField } from '@/lib/json-utils';

export interface ProjectProfit {
    id: string;
    title: string;
    customerName: string | null;
    status: string;
    assignmentCount: number;
    estimateAmount: number;
    estimateCostTotal: number | null;
    revenue: number;
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

export interface DashboardData {
    projects: ProjectProfit[];
    summary: DashboardSummary;
}

/**
 * 利益ダッシュボードのデータを取得
 * Server ComponentとAPIの両方から使用可能
 */
export async function fetchProfitDashboardData(status: string = 'all'): Promise<DashboardData> {
    // 案件マスター一覧を取得
    const where: Record<string, unknown> = {};
    if (status !== 'all') {
        where.status = status;
    }

    // 基本クエリ: 案件一覧
    const projectMasters = await prisma.projectMaster.findMany({
        where,
        select: {
            id: true,
            title: true,
            customerName: true,
            status: true,
            materialCost: true,
            subcontractorCost: true,
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
    const [estimates, invoices, settings, workItems, assignments, vehicles, allUsers, allWorkers] = await Promise.all([
        // 見積書
        prisma.estimate.findMany({
            where: { projectMasterId: { in: projectIds } },
            select: { projectMasterId: true, total: true, costTotal: true },
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
        // ユーザー時給
        prisma.user.findMany({
            select: { id: true, hourlyRate: true },
        }),
        // 応援ワーカー時給
        prisma.worker.findMany({
            select: { id: true, hourlyRate: true },
        }),
    ]);

    // 見積書をグループ化
    const estimateByProject = new Map<string, number>();
    const estimateCostByProject = new Map<string, number | null>();
    for (const e of estimates) {
        if (e.projectMasterId) {
            estimateByProject.set(
                e.projectMasterId,
                (estimateByProject.get(e.projectMasterId) || 0) + Number(e.total)
            );
            // 見積原価: 複数見積がある場合は合算（null同士はnullのまま）
            if (e.costTotal != null) {
                estimateCostByProject.set(
                    e.projectMasterId,
                    (estimateCostByProject.get(e.projectMasterId) || 0) + e.costTotal
                );
            }
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
        const revenue = revenueByProject.get(pm.id) || 0;
        const laborCost = laborCostByProject.get(pm.id) || 0;
        const loadingCost = loadingCostByProject.get(pm.id) || 0;
        const vehicleCost = vehicleCostByProject.get(pm.id) || 0;
        const materialCost = Number(pm.materialCost || 0);
        const subcontractorCost = Number(pm.subcontractorCost || 0);
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
            revenue,
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

    return {
        projects: profitSummaries,
        summary,
    };
}
