import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, serverErrorResponse } from '@/lib/api/utils';

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || 'all';
        const mode = searchParams.get('mode') || 'full';

        const where: Record<string, unknown> = status !== 'all' ? { status } : {};

        const projectMasters = await prisma.projectMaster.findMany({
            where,
            select: {
                id: true, title: true, customerName: true, status: true,
                materialCost: true, subcontractorCost: true, otherExpenses: true, updatedAt: true,
                _count: { select: { assignments: true } },
            },
            orderBy: { updatedAt: 'desc' },
        });

        const projectIds = projectMasters.map(pm => pm.id);

        if (mode === 'fast') {
            const [estimates, invoices] = await Promise.all([
                prisma.estimate.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true, total: true } }),
                prisma.invoice.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true, total: true } }),
            ]);

            const estimateByProject = new Map<string, number>();
            estimates.forEach(e => { if (e.projectMasterId) estimateByProject.set(e.projectMasterId, (estimateByProject.get(e.projectMasterId) || 0) + e.total); });

            const revenueByProject = new Map<string, number>();
            invoices.forEach(i => revenueByProject.set(i.projectMasterId, (revenueByProject.get(i.projectMasterId) || 0) + i.total));

            const profitSummaries = projectMasters.map(pm => {
                const estimateAmount = estimateByProject.get(pm.id) || 0;
                const revenue = revenueByProject.get(pm.id) || 0;
                const totalCost = (pm.materialCost || 0) + (pm.subcontractorCost || 0) + (pm.otherExpenses || 0);
                const grossProfit = revenue - totalCost;
                return {
                    id: pm.id, title: pm.title, customerName: pm.customerName, status: pm.status,
                    assignmentCount: pm._count.assignments, estimateAmount, revenue,
                    laborCost: 0, loadingCost: 0, vehicleCost: 0,
                    materialCost: pm.materialCost || 0, subcontractorCost: pm.subcontractorCost || 0, otherExpenses: pm.otherExpenses || 0,
                    totalCost, grossProfit, profitMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
                    updatedAt: pm.updatedAt, _costLoaded: false,
                };
            });

            return NextResponse.json({
                projects: profitSummaries, mode: 'fast',
                summary: {
                    totalProjects: profitSummaries.length,
                    totalRevenue: profitSummaries.reduce((sum, p) => sum + p.revenue, 0),
                    totalCost: profitSummaries.reduce((sum, p) => sum + p.totalCost, 0),
                    totalGrossProfit: profitSummaries.reduce((sum, p) => sum + p.grossProfit, 0),
                    averageProfitMargin: profitSummaries.length > 0 ? Math.round(profitSummaries.reduce((sum, p) => sum + p.profitMargin, 0) / profitSummaries.length * 10) / 10 : 0,
                },
            });
        }

        const [estimates, invoices, settings, workItems, assignments, vehicles] = await Promise.all([
            prisma.estimate.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true, total: true } }),
            prisma.invoice.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true, total: true } }),
            prisma.systemSettings.findFirst(),
            prisma.dailyReportWorkItem.findMany({
                where: { assignment: { projectMasterId: { in: projectIds } } },
                select: { workMinutes: true, dailyReport: { select: { morningLoadingMinutes: true, eveningLoadingMinutes: true } }, assignment: { select: { projectMasterId: true, workers: true } } },
            }),
            prisma.projectAssignment.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true, vehicles: true } }),
            prisma.vehicle.findMany({ select: { id: true, dailyRate: true } }),
        ]);

        const estimateByProject = new Map<string, number>();
        estimates.forEach(e => { if (e.projectMasterId) estimateByProject.set(e.projectMasterId, (estimateByProject.get(e.projectMasterId) || 0) + e.total); });

        const revenueByProject = new Map<string, number>();
        invoices.forEach(i => revenueByProject.set(i.projectMasterId, (revenueByProject.get(i.projectMasterId) || 0) + i.total));

        const minuteRate = (settings?.laborDailyRate ?? 15000) / (settings?.standardWorkMinutes ?? 480);
        const laborCostByProject = new Map<string, number>();
        const loadingCostByProject = new Map<string, number>();

        workItems.forEach(item => {
            const projectId = item.assignment.projectMasterId;
            const workerCount = parseJsonField<string[]>(item.assignment.workers, []).length || 1;
            laborCostByProject.set(projectId, (laborCostByProject.get(projectId) || 0) + Math.round(item.workMinutes * workerCount * minuteRate));
            if (item.dailyReport) {
                const loadingMinutes = item.dailyReport.morningLoadingMinutes + item.dailyReport.eveningLoadingMinutes;
                loadingCostByProject.set(projectId, (loadingCostByProject.get(projectId) || 0) + Math.round(loadingMinutes * 0.5 * workerCount * minuteRate));
            }
        });

        const vehicleRates = new Map(vehicles.map(v => [v.id, v.dailyRate || 0]));
        const vehicleCostByProject = new Map<string, number>();
        assignments.forEach(a => {
            const cost = parseJsonField<string[]>(a.vehicles, []).reduce((sum, vid) => sum + (vehicleRates.get(vid) || 0), 0);
            if (cost > 0) vehicleCostByProject.set(a.projectMasterId, (vehicleCostByProject.get(a.projectMasterId) || 0) + cost);
        });

        const profitSummaries = projectMasters.map(pm => {
            const estimateAmount = estimateByProject.get(pm.id) || 0;
            const revenue = revenueByProject.get(pm.id) || 0;
            const laborCost = laborCostByProject.get(pm.id) || 0;
            const loadingCost = loadingCostByProject.get(pm.id) || 0;
            const vehicleCost = vehicleCostByProject.get(pm.id) || 0;
            const totalCost = laborCost + loadingCost + vehicleCost + (pm.materialCost || 0) + (pm.subcontractorCost || 0) + (pm.otherExpenses || 0);
            const grossProfit = revenue - totalCost;
            return {
                id: pm.id, title: pm.title, customerName: pm.customerName, status: pm.status,
                assignmentCount: pm._count.assignments, estimateAmount, revenue, laborCost, loadingCost, vehicleCost,
                materialCost: pm.materialCost || 0, subcontractorCost: pm.subcontractorCost || 0, otherExpenses: pm.otherExpenses || 0,
                totalCost, grossProfit, profitMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
                updatedAt: pm.updatedAt, _costLoaded: true,
            };
        });

        return NextResponse.json({
            projects: profitSummaries, mode: 'full',
            summary: {
                totalProjects: profitSummaries.length,
                totalRevenue: profitSummaries.reduce((sum, p) => sum + p.revenue, 0),
                totalCost: profitSummaries.reduce((sum, p) => sum + p.totalCost, 0),
                totalGrossProfit: profitSummaries.reduce((sum, p) => sum + p.grossProfit, 0),
                averageProfitMargin: profitSummaries.length > 0 ? Math.round(profitSummaries.reduce((sum, p) => sum + p.profitMargin, 0) / profitSummaries.length * 10) / 10 : 0,
            },
        });
    } catch (error) {
        return serverErrorResponse('利益ダッシュボード取得', error);
    }
}
