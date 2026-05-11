import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, notFoundResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { calcTimeDiffMinutes } from '@/utils/dateUtils';

interface RouteContext { params: Promise<{ id: string }>; }

interface LaborRow {
    assignmentId: string;
    date: string;
    constructionTypeName: string | null;
    hours: number;
    foremanName: string | null;
    memberCount: number;
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}
interface VehicleRow {
    assignmentId: string;
    date: string;
    vehicleNames: string[];
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}
interface SubcontractorRow {
    assignmentId: string;
    date: string;
    constructionTypeName: string | null;
    foremanName: string | null;
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}

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
                loadingCost: true,
                revenueOverride: true,
                subcontractorCosts: {
                    select: { constructionTypeId: true, amount: true },
                },
                assignments: {
                    select: {
                        id: true,
                        date: true,
                        assignedEmployeeId: true,
                        isDispatchConfirmed: true,
                        constructionType: true,
                        workers: true,
                        memberCount: true,
                        vehicles: true,
                        laborCostOverride: true,
                        vehicleCostOverride: true,
                        subcontractorCostOverride: true,
                        dailyReportWorkItems: {
                            select: {
                                id: true,
                                startTime: true,
                                endTime: true,
                                breakMinutes: true,
                                workerIds: true,
                                dailyReport: { select: { id: true, date: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!projectMaster) return notFoundResponse('案件');

        const allWorkerIdSet = new Set<string>();
        for (const assignment of projectMaster.assignments) {
            const workers = parseJsonField<string[]>(assignment.workers, []);
            workers.forEach(wid => allWorkerIdSet.add(wid));
            for (const workItem of assignment.dailyReportWorkItems) {
                workItem.workerIds.forEach(wid => allWorkerIdSet.add(wid));
            }
        }

        const foremanIds = [...new Set(projectMaster.assignments.map(a => a.assignedEmployeeId).filter(Boolean))] as string[];

        const [settings, estimates, invoices, allVehicles, allUsers, allWorkers, foremanUsers, constructionTypes] = await Promise.all([
            prisma.systemSettings.findFirst(),
            prisma.estimate.findMany({ where: { projectMasterId: id }, select: { total: true, subtotal: true, costTotal: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } }),
            prisma.invoice.findMany({ where: { projectMasterId: id } }),
            prisma.vehicle.findMany({ select: { id: true, name: true, dailyRate: true } }),
            prisma.user.findMany({ where: { id: { in: [...allWorkerIdSet] } }, select: { id: true, dailyRate: true } }),
            prisma.worker.findMany({ where: { id: { in: [...allWorkerIdSet] } }, select: { id: true, dailyRate: true } }),
            foremanIds.length > 0
                ? prisma.user.findMany({ where: { id: { in: foremanIds } }, select: { id: true, displayName: true, role: true } })
                : Promise.resolve([] as { id: string; displayName: string; role: string }[]),
            prisma.constructionType.findMany({ select: { id: true, name: true } }),
        ]);

        const defaultDailyRate = Number(settings?.laborDailyRate ?? 18000);

        const dailyRateMap = new Map<string, number>();
        for (const u of allUsers) dailyRateMap.set(u.id, u.dailyRate ? Number(u.dailyRate) : defaultDailyRate);
        for (const w of allWorkers) {
            if (!dailyRateMap.has(w.id)) dailyRateMap.set(w.id, w.dailyRate ? Number(w.dailyRate) : defaultDailyRate);
        }
        const vehicleRateMap = new Map(allVehicles.map(v => [v.id, Number(v.dailyRate || 0)]));
        const vehicleNameMap = new Map(allVehicles.map(v => [v.id, v.name]));
        const foremanNameMap = new Map(foremanUsers.map(u => [u.id, u.displayName]));
        const ctNameMap = new Map(constructionTypes.map(c => [c.id, c.name]));

        // 同一案件に複数の見積書がある場合は最新1件のみを採用
        const latestEstimate = estimates[0];
        const estimateAmount = latestEstimate ? Number(latestEstimate.total) : 0;
        const estimateSubtotal = latestEstimate ? Number(latestEstimate.subtotal) : 0;
        const estimateCostTotal = latestEstimate?.costTotal ?? null;
        const invoiceAmount = invoices.reduce((sum, i) => sum + Number(i.total), 0);
        const invoiceSubtotal = invoices.reduce((sum, i) => sum + Number(i.subtotal), 0);
        const contractAmount = Number(projectMaster.contractAmount || 0);

        let revenue = 0;
        let revenueSource: 'invoice' | 'estimate' | 'contract' | 'override' | 'none' = 'none';
        let autoRevenue = 0;
        let autoRevenueSource: 'invoice' | 'estimate' | 'contract' | 'none' = 'none';
        if (invoiceSubtotal > 0) { autoRevenue = invoiceSubtotal; autoRevenueSource = 'invoice'; }
        else if (estimateSubtotal > 0) { autoRevenue = estimateSubtotal; autoRevenueSource = 'estimate'; }
        else if (contractAmount > 0) { autoRevenue = contractAmount; autoRevenueSource = 'contract'; }

        if (projectMaster.revenueOverride != null) {
            revenue = projectMaster.revenueOverride;
            revenueSource = 'override';
        } else {
            revenue = autoRevenue;
            revenueSource = autoRevenueSource;
        }

        const calcWorkMinutesFromItem = (startTime: string | null, endTime: string | null, breakMins: number): number => {
            if (!startTime || !endTime) return 0;
            return Math.max(0, calcTimeDiffMinutes(startTime, endTime) - breakMins);
        };

        // ---- 按分母数（worker,date）の集計 ----
        const workerDateKeys = new Set<string>();
        for (const assignment of projectMaster.assignments) {
            for (const workItem of assignment.dailyReportWorkItems) {
                if (!workItem.dailyReport) continue;
                const dateStr = new Date(workItem.dailyReport.date).toISOString().slice(0, 10);
                const ids = workItem.workerIds.length > 0
                    ? workItem.workerIds
                    : parseJsonField<string[]>(assignment.workers, []);
                for (const wid of ids) workerDateKeys.add(`${wid}|${dateStr}`);
            }
        }
        const otherWorkItems = workerDateKeys.size > 0
            ? await prisma.dailyReportWorkItem.findMany({
                where: {
                    OR: Array.from(workerDateKeys).map(k => {
                        const [wid, dateStr] = k.split('|');
                        return {
                            workerIds: { has: wid },
                            dailyReport: { date: new Date(`${dateStr}T00:00:00.000Z`) },
                        };
                    }),
                },
                select: {
                    startTime: true,
                    endTime: true,
                    breakMinutes: true,
                    workerIds: true,
                    assignment: { select: { projectMasterId: true, workers: true } },
                    dailyReport: { select: { date: true } },
                },
            })
            : [];
        const workerDayTotalMinutes = new Map<string, number>();
        for (const item of otherWorkItems) {
            if (!item.dailyReport) continue;
            const mins = calcWorkMinutesFromItem(item.startTime, item.endTime, item.breakMinutes);
            if (mins <= 0) continue;
            const dateStr = new Date(item.dailyReport.date).toISOString().slice(0, 10);
            const ids = item.workerIds.length > 0 ? item.workerIds : parseJsonField<string[]>(item.assignment.workers, []);
            for (const wid of ids) {
                const key = `${wid}|${dateStr}`;
                workerDayTotalMinutes.set(key, (workerDayTotalMinutes.get(key) || 0) + mins);
            }
        }

        // partnerForemanIds for subcontractor calc
        const partnerForemanIds = new Set(foremanUsers.filter(u => u.role === 'partner').map(u => u.id));

        // 工事種別ごとの subcontractor 単価
        const subcontractorTypeAmount = new Map<string, number>(
            projectMaster.subcontractorCosts.map(c => [c.constructionTypeId, Number(c.amount || 0)])
        );

        const laborRows: LaborRow[] = [];
        const vehicleRows: VehicleRow[] = [];
        const subcontractorRows: SubcontractorRow[] = [];

        let laborCost = 0;
        let vehicleCost = 0;
        let subcontractorCost = 0;
        const subcontractorTypeUsed = new Set<string>(); // 上書きが無い場合の従来計算用

        for (const a of projectMaster.assignments) {
            const dateStr = new Date(a.date).toISOString().slice(0, 10);
            const ctName = a.constructionType ? (ctNameMap.get(a.constructionType) ?? null) : null;
            const foremanName = foremanNameMap.get(a.assignedEmployeeId) ?? null;
            // 協力業者ロールがアサインされた配置は労務費を計上しない（協力業者費に統合）
            const isPartnerForeman = partnerForemanIds.has(a.assignedEmployeeId);

            // ----- 労務費（assignment単位に集計） -----
            let assignmentLaborRaw = 0;
            let assignmentMinutes = 0;
            for (const workItem of a.dailyReportWorkItems) {
                if (!workItem.dailyReport) continue;
                const mins = calcWorkMinutesFromItem(workItem.startTime, workItem.endTime, workItem.breakMinutes);
                if (mins <= 0) continue;
                assignmentMinutes += mins;
                const wDateStr = new Date(workItem.dailyReport.date).toISOString().slice(0, 10);
                let ids = workItem.workerIds.length > 0
                    ? workItem.workerIds
                    : parseJsonField<string[]>(a.workers, []);
                if (ids.length === 0) {
                    const count = a.memberCount || 1;
                    ids = Array.from({ length: count }, (_, i) => `__fb__:${workItem.id}:${i}`);
                    for (const wid of ids) {
                        const key = `${wid}|${wDateStr}`;
                        workerDayTotalMinutes.set(key, mins);
                    }
                }
                for (const wid of ids) {
                    const key = `${wid}|${wDateStr}`;
                    const totalMins = workerDayTotalMinutes.get(key) || mins;
                    const dailyRate = dailyRateMap.get(wid) ?? defaultDailyRate;
                    assignmentLaborRaw += dailyRate * (mins / totalMins);
                }
            }
            const autoLaborCost = Math.round(assignmentLaborRaw / 100) * 100;
            const effectiveLabor = a.laborCostOverride != null ? a.laborCostOverride : autoLaborCost;
            const hours = Math.round((assignmentMinutes / 60) * 10) / 10;
            // 協力業者配置は labor 集計から除外、breakdown 行にも出さない
            if (!isPartnerForeman) {
                laborCost += effectiveLabor;
                laborRows.push({
                    assignmentId: a.id,
                    date: dateStr,
                    constructionTypeName: ctName,
                    hours,
                    foremanName,
                    memberCount: a.memberCount || 0,
                    autoCost: autoLaborCost,
                    override: a.laborCostOverride,
                    effectiveCost: effectiveLabor,
                });
            }

            // ----- 車両費 -----
            const vehIds = parseJsonField<string[]>(a.vehicles, []);
            const autoVehicle = vehIds.reduce((sum, vid) => sum + (vehicleRateMap.get(vid) || 0), 0);
            const effectiveVehicle = a.vehicleCostOverride != null ? a.vehicleCostOverride : autoVehicle;
            // 行は車両がある or 上書きがある場合のみ表示
            if (vehIds.length > 0 || a.vehicleCostOverride != null) {
                vehicleRows.push({
                    assignmentId: a.id,
                    date: dateStr,
                    vehicleNames: vehIds.map(vid => vehicleNameMap.get(vid) ?? '不明').filter(Boolean),
                    autoCost: autoVehicle,
                    override: a.vehicleCostOverride,
                    effectiveCost: effectiveVehicle,
                });
            }
            vehicleCost += effectiveVehicle;

            // ----- 外注費（協力業者） -----
            const isPartnerSubcontractor = a.isDispatchConfirmed
                && partnerForemanIds.has(a.assignedEmployeeId)
                && !!a.constructionType
                && subcontractorTypeAmount.has(a.constructionType);
            const autoSubFromType = isPartnerSubcontractor && a.constructionType && !subcontractorTypeUsed.has(a.constructionType)
                ? (subcontractorTypeAmount.get(a.constructionType) ?? 0)
                : 0;
            // 自動値は「種別ごとに最初の対象アサインへ計上」
            if (autoSubFromType > 0 && a.constructionType) subcontractorTypeUsed.add(a.constructionType);

            const hasSubOverride = a.subcontractorCostOverride != null;
            const effectiveSub = hasSubOverride ? (a.subcontractorCostOverride as number) : autoSubFromType;
            if (isPartnerSubcontractor || hasSubOverride) {
                subcontractorRows.push({
                    assignmentId: a.id,
                    date: dateStr,
                    constructionTypeName: ctName,
                    foremanName,
                    autoCost: autoSubFromType,
                    override: a.subcontractorCostOverride,
                    effectiveCost: effectiveSub,
                });
            }
            subcontractorCost += effectiveSub;
        }

        const materialCost = Number(projectMaster.materialCost || 0);
        const otherExpenses = Number(projectMaster.otherExpenses || 0);
        const loadingCost = Number(projectMaster.loadingCost || 0);

        const totalCost = laborCost + loadingCost + vehicleCost + materialCost + subcontractorCost + otherExpenses;
        const grossProfit = revenue - totalCost;
        const profitMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

        return NextResponse.json({
            projectMasterId: id, projectTitle: projectMaster.title,
            revenue, revenueSource, autoRevenue, revenueOverride: projectMaster.revenueOverride,
            invoiceAmount, invoiceSubtotal, estimateAmount, estimateSubtotal, estimateCostTotal,
            contractAmount,
            costBreakdown: { laborCost, loadingCost, vehicleCost, materialCost, subcontractorCost, otherExpenses, totalCost },
            breakdown: {
                labor: laborRows.sort((a, b) => a.date.localeCompare(b.date)),
                vehicle: vehicleRows.sort((a, b) => a.date.localeCompare(b.date)),
                subcontractor: subcontractorRows.sort((a, b) => a.date.localeCompare(b.date)),
                materialCost,
                otherExpenses,
                loadingCost,
            },
            grossProfit, profitMargin,
        });
    } catch (error) {
        return serverErrorResponse('利益計算', error);
    }
}
