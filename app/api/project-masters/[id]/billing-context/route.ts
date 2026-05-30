import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    notFoundResponse,
    serverErrorResponse,
} from '@/lib/api/utils';
import type {
    ProjectContext,
    ProjectContextEstimate,
    ProjectContextHistoryItem,
} from '@/types/billingDraft';
import { parseJsonField } from '@/lib/json-utils';
import { invoicedAmountForProject, type InvoiceForBillingSummary } from '@/lib/billing/billingStatus';

/** 見積書一覧の表示上限（残りは totalCount で「他 N 件」として返す）。 */
const ESTIMATE_DISPLAY_LIMIT = 3;

/**
 * 確定済み Invoice の集計対象外を判定するフィルタ。
 *
 * 現状 `'cancelled'` 値は本番 DB には存在しない（rev.18 §17.21.5.3 で確認済）。
 * Phase 3 で cancelled 導入時に拡張するため、関数として切り出しておく。
 */
function isInvoiceCancelled(status: string): boolean {
    return status === 'cancelled';
}

/**
 * GET /api/project-masters/[id]/billing-context
 *
 * 指定された案件の請求コンテキスト（契約金額・過去の請求済み合計・見積書一覧・履歴）を集約して返す。
 *
 * - 集計対象 Invoice：`Invoice.projectMasterId === pmId`（top-level 代表）
 *   ∪ `InvoiceProjectMaster.projectMasterId === pmId`（N:N、複数案件まとめ請求書）
 *   両者の和集合を id で dedup（既存 `getDocFlags` パターン踏襲、`app/api/project-masters/[id]/route.ts:52-59`）
 * - 過去合計：cancelled 除外（現状ノーオペ、Phase 3 で有効化）
 * - 見積書並び：`status='approved'` を先頭 → 残りは createdAt desc、上限 3 件 +「他 N 件」
 * - 履歴：BillingDraft（pending/confirmed/cancelled、deletedAt=null）+ Invoice の統合、createdAt desc、件数上限なし
 *
 * 権限：admin / manager のみ（`requireManagerOrAbove`）。
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string } },
) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const pmId = params.id;

        // 案件本体・直接紐づく Invoice・N:N リンク・見積書・請求予定 を並列取得
        const [pm, directInvoices, linkRows, estimates, billingDrafts] = await Promise.all([
            prisma.projectMaster.findUnique({
                where: { id: pmId },
                select: { id: true, contractAmount: true },
            }),
            prisma.invoice.findMany({
                where: { projectMasterId: pmId },
            }),
            prisma.invoiceProjectMaster.findMany({
                where: { projectMasterId: pmId },
                select: { invoiceId: true },
            }),
            prisma.estimate.findMany({
                where: { projectMasterId: pmId },
            }),
            prisma.billingDraft.findMany({
                where: { projectId: pmId, deletedAt: null },
            }),
        ]);

        if (!pm) return notFoundResponse('案件マスター');

        // N:N 経由で紐づく Invoice を追加で取得（direct 分とは重複の可能性あり → id で dedup）
        const linkInvoiceIds = linkRows.map((l) => l.invoiceId);
        const linkedInvoices = linkInvoiceIds.length > 0
            ? await prisma.invoice.findMany({ where: { id: { in: linkInvoiceIds } } })
            : [];

        const invoiceMap = new Map<string, (typeof directInvoices)[number]>();
        for (const inv of [...directInvoices, ...linkedInvoices]) {
            invoiceMap.set(inv.id, inv);
        }
        const allInvoices = Array.from(invoiceMap.values());

        // この案件ぶんの請求額（税抜）を Invoice ごとに算出する。
        // 請求書全体の total（税込・全案件）ではなく、明細(items)の projectMasterId タグで
        // 案件単位に按分する（複数案件まとめ請求でもこの案件の行だけを合算）。
        // 無タグのレガシー Invoice は代表案件のときだけ subtotal を計上（computeInvoicedByProject と同一ルール）。
        const toSummary = (inv: (typeof allInvoices)[number]): InvoiceForBillingSummary => ({
            status: inv.status,
            subtotal: Number(inv.subtotal),
            items: parseJsonField<InvoiceForBillingSummary['items']>(inv.items, []),
            projectMasterId: inv.projectMasterId,
        });
        const invoicedByInvoiceId = new Map<string, number>(
            allInvoices.map((inv) => [inv.id, invoicedAmountForProject(toSummary(inv), pmId)]),
        );

        // 過去の請求済み合計（この案件ぶん・税抜、cancelled 除外）
        const totalInvoicedAmount = allInvoices
            .filter((inv) => !isInvoiceCancelled(inv.status))
            .reduce((sum, inv) => sum + (invoicedByInvoiceId.get(inv.id) ?? 0), 0);

        // 見積書の並び替え：approved 先頭、残りは createdAt desc
        const sortedEstimates = [...estimates].sort((a, b) => {
            const aPri = a.status === 'approved' ? 0 : 1;
            const bPri = b.status === 'approved' ? 0 : 1;
            if (aPri !== bPri) return aPri - bPri;
            return b.createdAt.getTime() - a.createdAt.getTime();
        });

        const estimateItems: ProjectContextEstimate[] = sortedEstimates
            .slice(0, ESTIMATE_DISPLAY_LIMIT)
            .map((e) => ({
                id: e.id,
                estimateNumber: e.estimateNumber,
                title: e.title,
                status: e.status,
                subtotal: Number(e.subtotal),
                createdAt: e.createdAt.toISOString(),
                createdByName: e.createdByName ?? null,
            }));

        // 履歴：BillingDraft + Invoice 統合、createdAt desc
        const history: ProjectContextHistoryItem[] = [
            ...billingDrafts.map((d): ProjectContextHistoryItem => ({
                type: 'billing-draft',
                id: d.id,
                title: d.title,
                amount: d.amount != null ? Number(d.amount) : null,
                status: d.status,
                createdAt: d.createdAt.toISOString(),
            })),
            ...allInvoices.map((inv): ProjectContextHistoryItem => ({
                type: 'invoice',
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                title: inv.title,
                amount: invoicedByInvoiceId.get(inv.id) ?? 0,
                status: inv.status,
                createdAt: inv.createdAt.toISOString(),
            })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const response: ProjectContext = {
            contractAmount: pm.contractAmount ?? null,
            totalInvoicedAmount,
            estimates: { items: estimateItems, totalCount: sortedEstimates.length },
            history,
        };

        return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('案件の請求コンテキスト取得', error);
    }
}
