import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/profit-dashboard - 全案件の利益サマリー一覧を取得（高速化版）
// mode=fast: 基本情報のみ（見積・請求金額）を高速返却
// mode=full または未指定: 原価計算込みの完全データ
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || 'all';
        const mode = searchParams.get('mode') || 'full';

        // 案件マスター一覧を取得（配置数のみカウント）
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

        // ===============================
        // Fast mode: 基本情報のみを高速返却
        // ===============================
        if (mode === 'fast') {
            // 見積書と請求書を並列取得
            const [estimates, invoices] = await Promise.all([
                prisma.estimate.findMany({
                    where: { projectMasterId: { in: projectIds } },
                    select: { projectMasterId: true, total: true },
                }),
                prisma.invoice.findMany({
                    where: { projectMasterId: { in: projectIds } },
                    select: { projectMasterId: true, total: true },
                }),
            ]);

            const estimateByProject = new Map<string, number>();
            for (const e of estimates) {
                if (e.projectMasterId) {
                    estimateByProject.set(
                        e.projectMasterId,
                        (estimateByProject.get(e.projectMasterId) || 0) + e.total
                    );
                }
            }

            const revenueByProject = new Map<string, number>();
            for (const i of invoices) {
                revenueByProject.set(
                    i.projectMasterId,
                    (revenueByProject.get(i.projectMasterId) || 0) + i.total
                );
            }

            // 基本情報のみのサマリー（原価は後から追加）
            const profitSummaries = projectMasters.map(pm => {
                const estimateAmount = estimateByProject.get(pm.id) || 0;
                const revenue = revenueByProject.get(pm.id) || 0;
                const materialCost = pm.materialCost || 0;
                const subcontractorCost = pm.subcontractorCost || 0;
                const otherExpenses = pm.otherExpenses || 0;

                // fastモードでは日報ベースの原価は0とする（後で取得）
                const totalCost = materialCost + subcontractorCost + otherExpenses;
                const grossProfit = revenue - totalCost;
                const profitMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

                return {
                    id: pm.id,
                    title: pm.title,
                    customerName: pm.customerName,
                    status: pm.status,
                    assignmentCount: pm._count.assignments,
                    estimateAmount,
                    revenue,
                    laborCost: 0,
                    loadingCost: 0,
                    vehicleCost: 0,
                    materialCost,
                    subcontractorCost,
                    otherExpenses,
                    totalCost,
                    grossProfit,
                    profitMargin,
                    updatedAt: pm.updatedAt,
                    _costLoaded: false, // 原価未計算フラグ
                };
            });

            const summary = {
                totalProjects: profitSummaries.length,
                totalRevenue: profitSummaries.reduce((sum, p) => sum + p.revenue, 0),
                totalCost: profitSummaries.reduce((sum, p) => sum + p.totalCost, 0),
                totalGrossProfit: profitSummaries.reduce((sum, p) => sum + p.grossProfit, 0),
                averageProfitMargin: profitSummaries.length > 0
                    ? Math.round(profitSummaries.reduce((sum, p) => sum + p.profitMargin, 0) / profitSummaries.length * 10) / 10
                    : 0,
            };

            return NextResponse.json({
                projects: profitSummaries,
                summary,
                mode: 'fast',
            });
        }

        // ===============================
        // Full mode: 全データを並列クエリで取得
        // ===============================

        // 全クエリを並列実行（大幅な高速化）
        const [estimates, invoices, settings, workItems, assignments, vehicles] = await Promise.all([
            // 見積書
            prisma.estimate.findMany({
                where: { projectMasterId: { in: projectIds } },
                select: { projectMasterId: true, total: true },
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
                    workMinutes: true,
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
        ]);

        // 見積書をグループ化
        const estimateByProject = new Map<string, number>();
        for (const e of estimates) {
            if (e.projectMasterId) {
                estimateByProject.set(
                    e.projectMasterId,
                    (estimateByProject.get(e.projectMasterId) || 0) + e.total
                );
            }
        }

        // 請求書をグループ化
        const revenueByProject = new Map<string, number>();
        for (const i of invoices) {
            revenueByProject.set(
                i.projectMasterId,
                (revenueByProject.get(i.projectMasterId) || 0) + i.total
            );
        }

        // システム設定から単価計算
        const laborDailyRate = settings?.laborDailyRate ?? 15000;
        const standardWorkMinutes = settings?.standardWorkMinutes ?? 480;
        const minuteRate = laborDailyRate / standardWorkMinutes;

        // 日報データをプロジェクトごとに集計
        const laborCostByProject = new Map<string, number>();
        const loadingCostByProject = new Map<string, number>();

        for (const item of workItems) {
            const projectId = item.assignment.projectMasterId;
            const workers = item.assignment.workers ? JSON.parse(item.assignment.workers) : [];
            const workerCount = workers.length || 1;

            // 人件費
            const laborCost = Math.round(item.workMinutes * workerCount * minuteRate);
            laborCostByProject.set(
                projectId,
                (laborCostByProject.get(projectId) || 0) + laborCost
            );

            // 積込費（簡易計算: 作業時間に比例）
            if (item.dailyReport) {
                const loadingMinutes = item.dailyReport.morningLoadingMinutes + item.dailyReport.eveningLoadingMinutes;
                const loadingCost = Math.round(loadingMinutes * 0.5 * workerCount * minuteRate);
                loadingCostByProject.set(
                    projectId,
                    (loadingCostByProject.get(projectId) || 0) + loadingCost
                );
            }
        }

        // 車両費を計算
        const vehicleRates = new Map<string, number>();
        for (const v of vehicles) {
            vehicleRates.set(v.id, v.dailyRate || 0);
        }

        const vehicleCostByProject = new Map<string, number>();
        for (const a of assignments) {
            const vehicleIds: string[] = a.vehicles ? JSON.parse(a.vehicles) : [];
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
        const profitSummaries = projectMasters.map(pm => {
            const estimateAmount = estimateByProject.get(pm.id) || 0;
            const revenue = revenueByProject.get(pm.id) || 0;
            const laborCost = laborCostByProject.get(pm.id) || 0;
            const loadingCost = loadingCostByProject.get(pm.id) || 0;
            const vehicleCost = vehicleCostByProject.get(pm.id) || 0;
            const materialCost = pm.materialCost || 0;
            const subcontractorCost = pm.subcontractorCost || 0;
            const otherExpenses = pm.otherExpenses || 0;

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
                _costLoaded: true, // 原価計算済みフラグ
            };
        });

        // 集計
        const summary = {
            totalProjects: profitSummaries.length,
            totalRevenue: profitSummaries.reduce((sum, p) => sum + p.revenue, 0),
            totalCost: profitSummaries.reduce((sum, p) => sum + p.totalCost, 0),
            totalGrossProfit: profitSummaries.reduce((sum, p) => sum + p.grossProfit, 0),
            averageProfitMargin: profitSummaries.length > 0
                ? Math.round(profitSummaries.reduce((sum, p) => sum + p.profitMargin, 0) / profitSummaries.length * 10) / 10
                : 0,
        };

        return NextResponse.json({
            projects: profitSummaries,
            summary,
            mode: 'full',
        });
    } catch (error) {
        console.error('Failed to fetch profit dashboard:', error);
        return NextResponse.json({ error: 'Failed to fetch profit dashboard' }, { status: 500 });
    }
}
