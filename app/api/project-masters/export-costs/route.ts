import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';
import { SALES_INVOICE_STATUSES, invoiceProjectShares } from '@/lib/profitDashboard';
import type { ProjectCostExportRow } from '@/lib/projectMasterCsv';

/**
 * 案件CSV（案件一覧の「案件CSV」）の金額列用 API。
 *
 * 原価は案件詳細の利益タブと同じ共通エンジン `computeProjectCosts` の実計上額を返す
 * （案件マスタの「協力業者費（予定）」単価ではなく、手配確定・出来高・上書きを反映した確定値）。
 *
 * 売上は利益タブと同じ請求ルール（送付済み以降 × まとめ請求のシェア按分・税抜）だが、
 * **フォールバックの順番だけ利益タブと異なる**。
 *   利益タブ: 請求 → 見積 → 契約金額
 *   このCSV : 請求 → 契約金額 → 見積   ← kei 指定（契約が決まっている案件は契約額を売上として見たい）
 * revenueOverride（手動上書き）は常に最優先。
 */

/** 一度に問い合わせできる案件数の上限（案件一覧の全件出力を想定した安全弁）。 */
const MAX_IDS = 2000;

export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (role !== 'admin' && role !== 'manager') {
            return errorResponse('権限がありません', 403);
        }

        const body = await request.json().catch(() => null);
        const rawIds = (body as { ids?: unknown } | null)?.ids;
        if (!Array.isArray(rawIds) || rawIds.length === 0) {
            return validationErrorResponse('ids（案件IDの配列）を指定してください');
        }
        if (rawIds.length > MAX_IDS) {
            return validationErrorResponse(`一度に取得できる案件は${MAX_IDS}件までです`);
        }
        // 重複・非文字列を落としてから問い合わせる
        const ids = Array.from(new Set(rawIds.filter((v): v is string => typeof v === 'string' && v !== '')));
        if (ids.length === 0) {
            return validationErrorResponse('ids（案件IDの配列）を指定してください');
        }
        const idSet = new Set(ids);

        const [projectMasters, estimates, invoices, costMap] = await Promise.all([
            prisma.projectMaster.findMany({
                where: { id: { in: ids } },
                select: { id: true, contractAmount: true, revenueOverride: true },
            }),
            prisma.estimate.findMany({
                where: { projectMasterId: { in: ids } },
                select: { projectMasterId: true, subtotal: true },
            }),
            // ids が多いと OR(items contains 〇〇) が件数ぶん膨らむため、売上対象の請求書を全件取り、
            // シェア（invoiceProjectShares）を1パスで走査して該当案件へ振り分ける。
            prisma.invoice.findMany({
                where: { status: { in: [...SALES_INVOICE_STATUSES] } },
                select: { subtotal: true, items: true, projectMasterId: true },
            }),
            computeProjectCosts(ids, { withDetail: true }),
        ]);

        // 見積（複数合算・追加見積含む。利益タブと同じ）
        const estimateSubtotalById = new Map<string, number>();
        for (const e of estimates) {
            if (!e.projectMasterId) continue;
            estimateSubtotalById.set(e.projectMasterId, (estimateSubtotalById.get(e.projectMasterId) ?? 0) + Number(e.subtotal));
        }

        // 請求（まとめ請求はこの案件のシェアぶんだけ計上）
        const invoiceSubtotalById = new Map<string, number>();
        for (const inv of invoices) {
            const shares = invoiceProjectShares(inv);
            if (shares.size === 0) continue;
            for (const [pid, share] of shares) {
                if (share <= 0 || !idSet.has(pid)) continue;
                invoiceSubtotalById.set(pid, (invoiceSubtotalById.get(pid) ?? 0) + Number(inv.subtotal) * share);
            }
        }

        const data: ProjectCostExportRow[] = projectMasters.map((pm) => {
            const invoiceSubtotal = Math.round(invoiceSubtotalById.get(pm.id) ?? 0);
            const estimateSubtotal = Math.round(estimateSubtotalById.get(pm.id) ?? 0);
            const contractAmount = Number(pm.contractAmount || 0);

            let revenue = 0;
            let revenueSource: ProjectCostExportRow['revenueSource'] = 'none';
            if (pm.revenueOverride != null) {
                revenue = pm.revenueOverride;
                revenueSource = 'override';
            } else if (invoiceSubtotal > 0) {
                revenue = invoiceSubtotal;
                revenueSource = 'invoice';
            } else if (contractAmount > 0) {
                revenue = contractAmount;
                revenueSource = 'contract';
            } else if (estimateSubtotal > 0) {
                revenue = estimateSubtotal;
                revenueSource = 'estimate';
            }

            const cost = costMap.get(pm.id);
            const b = cost?.breakdown ?? {
                laborCost: 0, loadingCost: 0, vehicleCost: 0,
                materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0,
            };
            // 人時＝配置ごとの作業時間 × 実際に原価計上した人数（協力業者職長の配置は労務に含まれない）
            const laborRows = cost?.detail?.labor ?? [];
            let laborHours = 0;
            let laborManDays = 0;
            for (const r of laborRows) {
                laborHours += (Number(r.hours) || 0) * (Number(r.workerCount) || 0);
                laborManDays += Number(r.workerCount) || 0;
            }

            return {
                id: pm.id,
                revenue: Math.round(revenue),
                revenueSource,
                subcontractorCost: b.subcontractorCost,
                materialCost: b.materialCost,
                loadingCost: b.loadingCost,
                laborCost: b.laborCost,
                vehicleCost: b.vehicleCost,
                otherExpenses: b.otherExpenses,
                totalCost: b.totalCost,
                laborHours: Math.round(laborHours * 10) / 10,
                laborManDays,
            };
        });

        return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('案件原価エクスポート', err);
    }
}
