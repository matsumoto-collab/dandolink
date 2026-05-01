import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, notFoundResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { calcTimeDiffMinutes } from '@/utils/dateUtils';

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
                        id: true,
                        assignedEmployeeId: true,
                        isDispatchConfirmed: true,
                        constructionType: true,
                        workers: true,
                        memberCount: true,
                        vehicles: true,
                        dailyReportWorkItems: {
                            select: {
                                id: true,
                                startTime: true,
                                endTime: true,
                                breakMinutes: true,
                                workerIds: true,
                                dailyReport: {
                                    select: {
                                        id: true,
                                        date: true,
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
            prisma.user.findMany({ where: { id: { in: [...allWorkerIdSet] } }, select: { id: true, dailyRate: true } }),
            prisma.worker.findMany({ where: { id: { in: [...allWorkerIdSet] } }, select: { id: true, dailyRate: true } }),
            foremanIds.length > 0
                ? prisma.user.findMany({ where: { id: { in: foremanIds } }, select: { id: true, role: true } })
                : Promise.resolve([] as { id: string; role: string }[]),
        ]);

        const defaultDailyRate = Number(settings?.laborDailyRate ?? 18000);

        // ユーザー/応援ごとの日給マップ
        const dailyRateMap = new Map<string, number>();
        for (const u of allUsers) {
            dailyRateMap.set(u.id, u.dailyRate ? Number(u.dailyRate) : defaultDailyRate);
        }
        for (const w of allWorkers) {
            if (!dailyRateMap.has(w.id)) {
                dailyRateMap.set(w.id, w.dailyRate ? Number(w.dailyRate) : defaultDailyRate);
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

        let vehicleCost = 0;
        const loadingCost = 0;

        const calcWorkMinutesFromItem = (startTime: string | null, endTime: string | null, breakMins: number): number => {
            if (!startTime || !endTime) return 0;
            return Math.max(0, calcTimeDiffMinutes(startTime, endTime) - breakMins);
        };

        // 車両費
        for (const assignment of projectMaster.assignments) {
            const vehicles = parseJsonField<string[]>(assignment.vehicles, []);
            vehicles.forEach(vid => { vehicleCost += vehicleRateMap.get(vid) || 0; });
        }

        // (workerId, date) ごとに minutes を集計（この案件分のみ）
        // 同一workerの同日が他案件に跨る可能性があるため、本APIでは「この案件分の按分」だけが必要。
        // ただし他案件の作業時間を加味しないと按分の母数が不正確になるため、
        // 当該workerの当該日の全workItem（他案件含む）を取得して母数を算出する。
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

        // 同workerの同日における他案件含む全作業分数を取得（按分母数）
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

        // (workerId, dateStr) -> 同日全分数
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

        // 当案件における (workerId, dateStr) -> 当案件分数
        const workerDayThisProjectMinutes = new Map<string, number>();
        const fallbackByItem = new Map<string, number>(); // workerIds 完全空のときのフォールバック用 minutes
        for (const assignment of projectMaster.assignments) {
            for (const workItem of assignment.dailyReportWorkItems) {
                if (!workItem.dailyReport) continue;
                const mins = calcWorkMinutesFromItem(workItem.startTime, workItem.endTime, workItem.breakMinutes);
                if (mins <= 0) continue;
                const dateStr = new Date(workItem.dailyReport.date).toISOString().slice(0, 10);
                let ids = workItem.workerIds.length > 0
                    ? workItem.workerIds
                    : parseJsonField<string[]>(assignment.workers, []);
                if (ids.length === 0) {
                    // memberCount フォールバック: 合成IDで本案件のみに帰属
                    const count = assignment.memberCount || 1;
                    ids = Array.from({ length: count }, (_, i) => `__fb__:${workItem.id}:${i}`);
                    // 合成IDの母数は当案件分のみ
                    for (const wid of ids) {
                        const key = `${wid}|${dateStr}`;
                        workerDayTotalMinutes.set(key, (workerDayTotalMinutes.get(key) || 0) + mins);
                    }
                    fallbackByItem.set(workItem.id, count);
                }
                for (const wid of ids) {
                    const key = `${wid}|${dateStr}`;
                    workerDayThisProjectMinutes.set(key, (workerDayThisProjectMinutes.get(key) || 0) + mins);
                }
            }
        }

        // 各 (workerId, dateStr) ごとに dailyRate × (本案件分数 / 当日総分数) を加算
        // 100円単位四捨五入。単一案件なので端数吸収はworker内合算後に1度行う。
        let laborCost = 0;
        for (const [key, thisMins] of workerDayThisProjectMinutes) {
            const [wid] = key.split('|');
            const totalMins = workerDayTotalMinutes.get(key) || thisMins;
            const dailyRate = dailyRateMap.get(wid) ?? defaultDailyRate;
            const raw = dailyRate * (thisMins / totalMins);
            const rounded = Math.round(raw / 100) * 100;
            laborCost += rounded;
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
