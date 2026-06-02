import { NextRequest, NextResponse } from 'next/server';
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
import type { BillingBoardRow, BillingBoardWorkItem, BillingDecision } from '@/types/billingBoard';

/** 1 案件あたりに返す作業履歴の上限（超過分は workCount で総数を示す）。 */
const MAX_WORK_ITEMS = 60;

/** YYYY-MM-DD 判定。 */
function isYmd(s: string | null): s is string {
    return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 既定の期間＝当月（JST）の初日〜末日。 */
function defaultMonthRange(): { from: string; to: string } {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const m = jst.getUTCMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}

/**
 * GET /api/billing-board?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 請求判断ボードの行を集約して返す（admin / manager 限定）。
 *
 * 掲載条件：指定期間内に配置(ProjectAssignment)があり、status≠cancelled かつ
 *           全額請求済み（billingStatus='full'）でない案件。
 * from/to 未指定時は当月（JST）。'excluded'（対象外）は除外せず返す（対象外タブ用）。
 *
 * 日付境界：ProjectAssignment.date は「JST 0時 = UTC前日15時」で保存されるため、
 *           JST 日付を `T00:00:00+09:00` / `T23:59:59.999+09:00` の UTC instant に直して比較する
 *           （feedback: assignment_date_jst_boundary）。
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const def = defaultMonthRange();
        const fromYmd = isYmd(searchParams.get('from')) ? (searchParams.get('from') as string) : def.from;
        const toYmd = isYmd(searchParams.get('to')) ? (searchParams.get('to') as string) : def.to;
        const start = new Date(`${fromYmd}T00:00:00+09:00`);
        const end = new Date(`${toYmd}T23:59:59.999+09:00`);

        // 期間内に配置のある案件のみ
        const projects = await prisma.projectMaster.findMany({
            where: {
                status: { not: 'cancelled' },
                assignments: { some: { date: { gte: start, lte: end } } },
            },
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

        const [invoices, assignments, estimates, pendingDrafts] = await Promise.all([
            prisma.invoice.findMany({
                select: { status: true, subtotal: true, items: true, projectMasterId: true },
            }),
            prisma.projectAssignment.findMany({
                where: { projectMasterId: { in: projectIds }, date: { gte: start, lte: end } },
                select: {
                    projectMasterId: true,
                    date: true,
                    constructionType: true,
                    assignedEmployeeId: true,
                    memberCount: true,
                },
                orderBy: { date: 'asc' },
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

        // 期間内の配置を案件ごとに集約（作業履歴・最終作業日・工事種別の初出順）
        const workByProject = new Map<string, BillingBoardWorkItem[]>();
        const lastWorkByProject = new Map<string, string>();
        const ctypeByProject = new Map<string, string[]>();
        for (const a of assignments) {
            const pid = a.projectMasterId;
            const item: BillingBoardWorkItem = {
                date: a.date.toISOString(),
                constructionType: a.constructionType ?? null,
                foremanId: a.assignedEmployeeId ?? null,
                memberCount: a.memberCount,
            };
            const arr = workByProject.get(pid);
            if (arr) arr.push(item);
            else workByProject.set(pid, [item]);
            lastWorkByProject.set(pid, item.date); // asc 取得なので最後の書き込み=最大日
            if (a.constructionType) {
                const cs = ctypeByProject.get(pid) ?? [];
                if (!cs.includes(a.constructionType)) {
                    cs.push(a.constructionType);
                    ctypeByProject.set(pid, cs);
                }
            }
        }

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

            const work = workByProject.get(p.id) ?? [];
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
                lastWorkDate: lastWorkByProject.get(p.id) ?? null,
                constructionTypeIds: ctypeByProject.get(p.id) ?? [],
                workHistory: work.slice(-MAX_WORK_ITEMS).reverse(), // 直近を上に
                workCount: work.length,
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
