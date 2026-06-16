import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, notFoundResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';

interface RouteContext { params: Promise<{ id: string }>; }

/**
 * 案件詳細の「利益タブ」用 API。
 * 原価は共通エンジン `computeProjectCosts`（利益ダッシュボード一覧・月次内訳と同一ロジック）で算出する。
 * 売上は 請求(税抜) → 見積(税抜) → 足場工事金額 のフォールバック＋ revenueOverride。
 */
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
            select: { id: true, title: true, contractAmount: true, revenueOverride: true },
        });
        if (!projectMaster) return notFoundResponse('案件');

        const [estimates, invoices, costMap] = await Promise.all([
            prisma.estimate.findMany({
                where: { projectMasterId: id },
                select: { id: true, estimateNumber: true, title: true, total: true, subtotal: true, costTotal: true, createdAt: true, updatedAt: true },
                orderBy: { createdAt: 'asc' },
            }),
            prisma.invoice.findMany({ where: { projectMasterId: id } }),
            computeProjectCosts([id], { withDetail: true }),
        ]);

        // 見積（複数合算・追加見積含む）
        let estimateCostSum = 0;
        let anyEstimateCostSet = false;
        for (const e of estimates) {
            if (e.costTotal != null) { estimateCostSum += e.costTotal; anyEstimateCostSet = true; }
        }
        const estimateAmount = estimates.reduce((sum, e) => sum + Number(e.total), 0);
        const estimateSubtotal = estimates.reduce((sum, e) => sum + Number(e.subtotal), 0);
        const estimateCostTotal = anyEstimateCostSet ? estimateCostSum : null;
        const estimateBreakdown = estimates.map(e => ({
            id: e.id, estimateNumber: e.estimateNumber, title: e.title,
            total: Number(e.total), subtotal: Number(e.subtotal), costTotal: e.costTotal, createdAt: e.createdAt,
        }));
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

        // 原価（共通エンジン）
        const cost = costMap.get(id);
        const costBreakdown = cost?.breakdown ?? { laborCost: 0, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0 };
        const detail = cost?.detail ?? { labor: [], vehicle: [], subcontractor: [], materialCost: 0, otherExpenses: 0, loadingCost: 0, purchaseInvoices: [] };

        const totalCost = costBreakdown.totalCost;
        const grossProfit = revenue - totalCost;
        const profitMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

        // 見込み(見積基準) と 確定(請求基準) を明示的に算出（すべて税抜）
        // 見込み売上 = 手動上書き ?? 見積(税抜小計) ?? 足場工事金額
        const estimatedRevenue = projectMaster.revenueOverride != null
            ? projectMaster.revenueOverride
            : (estimateSubtotal > 0 ? estimateSubtotal : contractAmount);
        const confirmedRevenue = invoiceSubtotal;                 // 請求(税抜)。未請求は0
        const isBilled = invoiceSubtotal > 0;
        const estimatedProfit = estimatedRevenue - totalCost;     // 見積残（見込み利益）
        const confirmedProfit = confirmedRevenue - totalCost;     // 確定利益（請求後）
        const costConsumptionRate = estimatedRevenue > 0          // 原価消化率%（見積に対する原価の割合）
            ? Math.round((totalCost / estimatedRevenue) * 1000) / 10
            : null;

        return NextResponse.json({
            projectMasterId: id, projectTitle: projectMaster.title,
            revenue, revenueSource, autoRevenue, revenueOverride: projectMaster.revenueOverride,
            invoiceAmount, invoiceSubtotal, estimateAmount, estimateSubtotal, estimateCostTotal,
            estimateBreakdown,
            contractAmount,
            costBreakdown,
            breakdown: {
                labor: detail.labor,
                vehicle: detail.vehicle,
                subcontractor: detail.subcontractor,
                materialCost: detail.materialCost,
                otherExpenses: detail.otherExpenses,
                loadingCost: detail.loadingCost,
                purchaseInvoices: detail.purchaseInvoices,
            },
            grossProfit, profitMargin,
            // Phase4: 見込み／確定／見積残／消化率
            estimatedRevenue, confirmedRevenue, isBilled,
            estimatedProfit, confirmedProfit, costConsumptionRate,
        });
    } catch (error) {
        return serverErrorResponse('利益計算', error);
    }
}
