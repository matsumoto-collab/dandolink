import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const projectMaster = await prisma.projectMaster.findUnique({
            where: { id },
            include: { assignments: { include: { dailyReportWorkItems: { include: { dailyReport: true } } } } },
        });
        if (!projectMaster) return notFoundResponse('案件');

        const [settings, estimates, invoices, allVehicles] = await Promise.all([
            prisma.systemSettings.findFirst(),
            prisma.estimate.findMany({ where: { projectMasterId: id } }),
            prisma.invoice.findMany({ where: { projectMasterId: id } }),
            prisma.vehicle.findMany({ select: { id: true, dailyRate: true } }),
        ]);

        const laborDailyRate = settings?.laborDailyRate ?? 15000;
        const standardWorkMinutes = settings?.standardWorkMinutes ?? 480;
        const minuteRate = laborDailyRate / standardWorkMinutes;
        const vehicleRateMap = new Map(allVehicles.map(v => [v.id, v.dailyRate || 0]));

        const estimateAmount = estimates.reduce((sum, e) => sum + e.total, 0);
        const revenue = invoices.reduce((sum, i) => sum + i.total, 0);

        let laborCost = 0, loadingCost = 0, vehicleCost = 0;

        for (const assignment of projectMaster.assignments) {
            const workers = parseJsonField<string[]>(assignment.workers, []);
            const workerCount = workers.length || 1;
            const vehicles = parseJsonField<string[]>(assignment.vehicles, []);
            vehicles.forEach(vid => { vehicleCost += vehicleRateMap.get(vid) || 0; });

            for (const workItem of assignment.dailyReportWorkItems) {
                laborCost += Math.round(workItem.workMinutes * workerCount * minuteRate);
                if (workItem.dailyReport) {
                    const totalWorkMinutes = await getTotalWorkMinutesForReport(workItem.dailyReport.id);
                    if (totalWorkMinutes > 0) {
                        const ratio = workItem.workMinutes / totalWorkMinutes;
                        const loadingMinutes = (workItem.dailyReport.morningLoadingMinutes + workItem.dailyReport.eveningLoadingMinutes) * ratio;
                        loadingCost += Math.round(loadingMinutes * workerCount * minuteRate);
                    }
                }
            }
        }

        const materialCost = projectMaster.materialCost || 0;
        const subcontractorCost = projectMaster.subcontractorCost || 0;
        const otherExpenses = projectMaster.otherExpenses || 0;
        const totalCost = laborCost + loadingCost + vehicleCost + materialCost + subcontractorCost + otherExpenses;
        const grossProfit = revenue - totalCost;
        const profitMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

        return NextResponse.json({
            projectMasterId: id, projectTitle: projectMaster.title, revenue, estimateAmount,
            costBreakdown: { laborCost, loadingCost, vehicleCost, materialCost, subcontractorCost, otherExpenses, totalCost },
            grossProfit, profitMargin,
        });
    } catch (error) {
        return serverErrorResponse('利益計算', error);
    }
}

async function getTotalWorkMinutesForReport(dailyReportId: string): Promise<number> {
    const workItems = await prisma.dailyReportWorkItem.findMany({ where: { dailyReportId } });
    return workItems.reduce((sum, item) => sum + item.workMinutes, 0);
}
