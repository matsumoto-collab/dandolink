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

        const laborDailyRate = Number(settings?.laborDailyRate ?? 15000);
        const standardWorkMinutes = settings?.standardWorkMinutes ?? 480;
        const minuteRate = laborDailyRate / standardWorkMinutes;
        const vehicleRateMap = new Map(allVehicles.map(v => [v.id, Number(v.dailyRate || 0)]));

        const estimateAmount = estimates.reduce((sum, e) => sum + Number(e.total), 0);
        const revenue = invoices.reduce((sum, i) => sum + Number(i.total), 0);

        let laborCost = 0, loadingCost = 0, vehicleCost = 0;

        // N+1回避: 各workItemの作業分数を事前計算
        const calcWorkMinutesFromItem = (startTime: string | null, endTime: string | null): number => {
            if (!startTime || !endTime) return 0;
            const [sh, sm] = startTime.split(':').map(Number);
            const [eh, em] = endTime.split(':').map(Number);
            return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
        };

        // 各dailyReport配下の全workItemの合計作業分数を計算
        const reportTotalsMap = new Map<string, number>();
        for (const assignment of projectMaster.assignments) {
            for (const workItem of assignment.dailyReportWorkItems) {
                if (workItem.dailyReport) {
                    const reportId = workItem.dailyReport.id;
                    const mins = calcWorkMinutesFromItem(workItem.startTime, workItem.endTime);
                    reportTotalsMap.set(reportId, (reportTotalsMap.get(reportId) || 0) + mins);
                }
            }
        }

        for (const assignment of projectMaster.assignments) {
            const workers = parseJsonField<string[]>(assignment.workers, []);
            const workerCount = workers.length || 1;
            const vehicles = parseJsonField<string[]>(assignment.vehicles, []);
            vehicles.forEach(vid => { vehicleCost += vehicleRateMap.get(vid) || 0; });

            for (const workItem of assignment.dailyReportWorkItems) {
                const workMinutes = calcWorkMinutesFromItem(workItem.startTime, workItem.endTime);
                laborCost += Math.round(workMinutes * workerCount * minuteRate);
                if (workItem.dailyReport) {
                    const totalWorkMinutes = reportTotalsMap.get(workItem.dailyReport.id) || 0;
                    if (totalWorkMinutes > 0) {
                        const ratio = workMinutes / totalWorkMinutes;
                        const loadingMinutes = (workItem.dailyReport.morningLoadingMinutes + workItem.dailyReport.eveningLoadingMinutes) * ratio;
                        loadingCost += Math.round(loadingMinutes * workerCount * minuteRate);
                    }
                }
            }
        }

        const materialCost = Number(projectMaster.materialCost || 0);
        const subcontractorCost = Number(projectMaster.subcontractorCost || 0);
        const otherExpenses = Number(projectMaster.otherExpenses || 0);
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

