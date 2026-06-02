import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';
import {
    computeInvoicedByProject,
    getBillingStatus,
    type InvoiceForBillingSummary,
} from '@/lib/billing/billingStatus';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import type { BillingBoardRow, BillingDecision } from '@/types/billingBoard';

/**
 * GET /api/billing-board
 *
 * 請求判断ボードの行を集約して返す（admin / manager 限定）。
 *
 * 掲載条件：カレンダー配置済み（assignment 1 件以上）かつ status≠cancelled かつ
 *           全額請求済み（billingStatus='full'）でない案件。
 * 'excluded'（対象外）は除外せず返す（クライアントの対象外タブで表示するため）。
 *
 * 請求済み額は `computeInvoicedByProject`（明細の projectMasterId タグで案件按分・税抜）で算出し、
 * `getBillingStatus` で 未/一部/済 を判定する（案件一覧「請求」列と同一ロジック）。
 */
export async function GET() {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        // カレンダー配置済み（assignment が 1 件以上）の案件のみ
        const projects = await prisma.projectMaster.findMany({
            where: { assignments: { some: {} }, status: { not: 'cancelled' } },
            select: {
                id: true,
                title: true,
                name: true,
                customerId: true,
                customerName: true,
                status: true,
                contractAmount: true,
                createdBy: true,
                billingDecision: true,
            },
        });

        const projectIds = projects.map((p) => p.id);
        if (projectIds.length === 0) {
            return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
        }

        // 請求済み額（全 Invoice から案件按分）・最終作業日・見積・pending 請求予定 を並列取得
        const [invoices, lastWorkRows, estimates, pendingDrafts] = await Promise.all([
            prisma.invoice.findMany({
                select: { status: true, subtotal: true, items: true, projectMasterId: true },
            }),
            prisma.projectAssignment.groupBy({
                by: ['projectMasterId'],
                where: { projectMasterId: { in: projectIds } },
                _max: { date: true },
            }),
            prisma.estimate.findMany({
                where: { projectMasterId: { in: projectIds } },
                select: { projectMasterId: true, status: true },
            }),
            prisma.billingDraft.findMany({
                where: { projectId: { in: projectIds }, status: 'pending', deletedAt: null },
                select: { projectId: true },
            }),
        ]);

        const invoicedByProject = computeInvoicedByProject(
            invoices.map((inv): InvoiceForBillingSummary => ({
                status: inv.status,
                subtotal: Number(inv.subtotal),
                items: parseJsonField<InvoiceForBillingSummary['items']>(inv.items, []),
                projectMasterId: inv.projectMasterId,
            })),
        );

        const lastWorkByProject = new Map<string, Date | null>(
            lastWorkRows.map((r) => [r.projectMasterId, r._max.date]),
        );

        const estimateCountByProject = new Map<string, number>();
        const approvedProjects = new Set<string>();
        for (const e of estimates) {
            if (!e.projectMasterId) continue;
            estimateCountByProject.set(e.projectMasterId, (estimateCountByProject.get(e.projectMasterId) ?? 0) + 1);
            if (e.status === 'approved') approvedProjects.add(e.projectMasterId);
        }

        const draftProjectIds = new Set(pendingDrafts.map((d) => d.projectId));

        const rows: BillingBoardRow[] = [];
        for (const p of projects) {
            const invoiced = invoicedByProject[p.id] ?? 0;
            const contract = p.contractAmount ?? null;
            const billingStatus = getBillingStatus(contract, invoiced);
            if (billingStatus === 'full') continue; // 全額請求済みはボードから外す

            rows.push({
                id: p.id,
                title: p.title,
                name: p.name,
                customerId: p.customerId,
                customerName: p.customerName,
                status: p.status,
                contractAmount: contract,
                invoicedAmount: invoiced,
                billingStatus,
                remainingAmount: contract != null ? contract - invoiced : null,
                assigneeIds: extractAssigneeIds(p.createdBy ?? undefined),
                lastWorkDate: lastWorkByProject.get(p.id)?.toISOString() ?? null,
                estimateCount: estimateCountByProject.get(p.id) ?? 0,
                hasApprovedEstimate: approvedProjects.has(p.id),
                hasPendingDraft: draftProjectIds.has(p.id),
                billingDecision: (p.billingDecision as BillingDecision) ?? 'pending',
            });
        }

        return NextResponse.json(rows, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求判断ボードの取得', error);
    }
}
