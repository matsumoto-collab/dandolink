import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, notFoundResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (role !== 'admin' && role !== 'manager') {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;
        const projectMaster = await prisma.projectMaster.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                contractAmount: true,
                materialCost: true,
                otherExpenses: true,
                subcontractorCosts: {
                    select: { constructionTypeId: true, amount: true },
                },
                assignments: {
                    select: {
                        assignedEmployeeId: true,
                        isDispatchConfirmed: true,
                        constructionType: true,
                        workers: true,
                        vehicles: true,
                        dailyReportWorkItems: {
                            select: {
                                startTime: true,
                                endTime: true,
                                breakMinutes: true,
                                workerIds: true,
                                dailyReport: {
                                    select: {
                                        id: true,
                                        morningLoadingMinutes: true,
                                        eveningLoadingMinutes: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!projectMaster) return notFoundResponse('案件');

        // 全workItemのworkerIds + assignment.workersからworker IDを収集
        const allWorkerIdSet = new Set<string>();
        for (const assignment of projectMaster.assignments) {
            const workers = parseJsonField<string[]>(assignment.workers, []);
            workers.forEach(wid => allWorkerIdSet.add(wid));
            for (const workItem of assignment.dailyReportWorkItems) {
                workItem.workerIds.forEach(wid => allWorkerIdSet.add(wid));
            }
        }

        // 職長候補ユーザー（手配確定アサインの職長ID）
        const foremanIds = [...new Set(projectMaster.assignments.map(a => a.assignedEmployeeId).filter(Boolean))] as string[];

        const [settings, estimates, invoices, allVehicles, allUsers, allWorkers, foremanUsers] = await Promise.all([
            prisma.systemSettings.findFirst(),
            prisma.estimate.findMany({ where: { projectMasterId: id }, select: { total: true, subtotal: true, costTotal: true } }),
            prisma.invoice.findMany({ where: { projectMasterId: id } }),
            prisma.vehicle.findMany({ select: { id: true, dailyRate: true } }),
            prisma.user.findMany({ where: { id: { in: [...allWorkerIdSet] } }, select: { id: true, hourlyRate: true } }),
            prisma.worker.findMany({ where: { id: { in: [...allWorkerIdSet] } }, select: { id: true, hourlyRate: true } }),
            foremanIds.length > 0
                ? prisma.user.findMany({ where: { id: { in: foremanIds } }, select: { id: true, role: true } })
                : Promise.resolve([] as { id: string; role: string }[]),
        ]);

        const laborDailyRate = Number(settings?.laborDailyRate ?? 15000);
        const standardWorkMinutes = settings?.standardWorkMinutes ?? 480;
        const defaultMinuteRate = laborDailyRate / standardWorkMinutes;

        // ユーザー/応援ごとの分単価マップ（hourlyRate / 60）、未設定はシステムデフォルト
        const minuteRateMap = new Map<string, number>();
        for (const u of allUsers) {
            minuteRateMap.set(u.id, u.hourlyRate ? Number(u.hourlyRate) / 60 : defaultMinuteRate);
        }
        for (const w of allWorkers) {
            if (!minuteRateMap.has(w.id)) {
                minuteRateMap.set(w.id, w.hourlyRate ? Number(w.hourlyRate) / 60 : defaultMinuteRate);
            }
        }

        const vehicleRateMap = new Map(allVehicles.map(v => [v.id, Number(v.dailyRate || 0)]));

        const estimateAmount = estimates.reduce((sum, e) => sum + Number(e.total), 0);
        const estimateSubtotal = estimates.reduce((sum, e) => sum + Number(e.subtotal), 0);
        const estimateCostTotal = estimates.some(e => e.costTotal != null)
            ? estimates.reduce((sum, e) => sum + (e.costTotal ?? 0), 0)
            : null;
        const invoiceAmount = invoices.reduce((sum, i) => sum + Number(i.total), 0);
        const invoiceSubtotal = invoices.reduce((sum, i) => sum + Number(i.subtotal), 0);
        const contractAmount = Number(projectMaster.contractAmount || 0);

        // 売上フォールバック（税別）: 請求書(税別) → 見積書(税別) → 足場工事金額 → 0
        let revenue = 0;
        let revenueSource: 'invoice' | 'estimate' | 'contract' | 'none' = 'none';
        if (invoiceSubtotal > 0) {
            revenue = invoiceSubtotal;
            revenueSource = 'invoice';
        } else if (estimateSubtotal > 0) {
            revenue = estimateSubtotal;
            revenueSource = 'estimate';
        } else if (contractAmount > 0) {
            revenue = contractAmount;
            revenueSource = 'contract';
        }

        let laborCost = 0, loadingCost = 0, vehicleCost = 0;

        const calcWorkMinutesFromItem = (startTime: string | null, endTime: string | null, breakMins: number): number => {
            if (!startTime || !endTime) return 0;
            const [sh, sm] = startTime.split(':').map(Number);
            const [eh, em] = endTime.split(':').map(Number);
            return Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - breakMins);
        };

        // 各dailyReport配下の全workItemの合計作業分数を計算（積込費按分用）
        const reportTotalsMap = new Map<string, number>();
        for (const assignment of projectMaster.assignments) {
            for (const workItem of assignment.dailyReportWorkItems) {
                if (workItem.dailyReport) {
                    const reportId = workItem.dailyReport.id;
                    const mins = calcWorkMinutesFromItem(workItem.startTime, workItem.endTime, workItem.breakMinutes);
                    reportTotalsMap.set(reportId, (reportTotalsMap.get(reportId) || 0) + mins);
                }
            }
        }

        for (const assignment of projectMaster.assignments) {
            const vehicles = parseJsonField<string[]>(assignment.vehicles, []);
            vehicles.forEach(vid => { vehicleCost += vehicleRateMap.get(vid) || 0; });

            for (const workItem of assignment.dailyReportWorkItems) {
                const workMinutes = calcWorkMinutesFromItem(workItem.startTime, workItem.endTime, workItem.breakMinutes);

                // 日報workItemのworkerIdsを優先、なければassignment.workersにフォールバック
                const workerIds = workItem.workerIds.length > 0
                    ? workItem.workerIds
                    : parseJsonField<string[]>(assignment.workers, []);

                // ワーカーごとの分単価合計
                const sumMinuteRate = workerIds.length > 0
                    ? workerIds.reduce((sum, wid) => sum + (minuteRateMap.get(wid) ?? defaultMinuteRate), 0)
                    : defaultMinuteRate;

                laborCost += Math.round(workMinutes * sumMinuteRate);

                if (workItem.dailyReport) {
                    const totalWorkMinutes = reportTotalsMap.get(workItem.dailyReport.id) || 0;
                    if (totalWorkMinutes > 0) {
                        const ratio = workMinutes / totalWorkMinutes;
                        const loadingMinutes = (workItem.dailyReport.morningLoadingMinutes + workItem.dailyReport.eveningLoadingMinutes) * ratio;
                        loadingCost += Math.round(loadingMinutes * sumMinuteRate);
                    }
                }
            }
        }

        const materialCost = Number(projectMaster.materialCost || 0);

        // 協力業者費: 手配確定済み & 担当職長が partner ロールのアサインから
        // 該当工事種別を集め、種別ごとの設定金額を1回だけ計上する
        const partnerForemanIds = new Set(
            foremanUsers.filter(u => u.role === 'partner').map(u => u.id)
        );
        const activeConstructionTypeIds = new Set<string>();
        for (const a of projectMaster.assignments) {
            if (!a.isDispatchConfirmed) continue;
            if (!partnerForemanIds.has(a.assignedEmployeeId)) continue;
            if (a.constructionType) activeConstructionTypeIds.add(a.constructionType);
        }
        const subcontractorCost = projectMaster.subcontractorCosts.reduce((sum, c) => {
            return activeConstructionTypeIds.has(c.constructionTypeId)
                ? sum + Number(c.amount || 0)
                : sum;
        }, 0);

        const otherExpenses = Number(projectMaster.otherExpenses || 0);
        const totalCost = laborCost + loadingCost + vehicleCost + materialCost + subcontractorCost + otherExpenses;
        const grossProfit = revenue - totalCost;
        const profitMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

        return NextResponse.json({
            projectMasterId: id, projectTitle: projectMaster.title,
            revenue, revenueSource,
            invoiceAmount, invoiceSubtotal, estimateAmount, estimateSubtotal, estimateCostTotal,
            contractAmount,
            costBreakdown: { laborCost, loadingCost, vehicleCost, materialCost, subcontractorCost, otherExpenses, totalCost },
            grossProfit, profitMargin,
        });
    } catch (error) {
        return serverErrorResponse('利益計算', error);
    }
}
