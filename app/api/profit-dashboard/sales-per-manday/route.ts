import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';
import { SALES_INVOICE_STATUSES, invoiceProjectShares } from '@/lib/profitDashboard';
import { normalizeConstructionContent } from '@/lib/constructionContent';
import { LIVE_DATA_START, LIVE_DATA_START_MONTH, jstYearMonthOf } from '@/lib/backfill/constants';
import {
    shiftYearMonth,
    summarizeSalesPerManDay,
    type SalesPerManDayFact,
} from '@/lib/salesPerManDay';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' の JST 1 日 0 時 */
function jstMonthStart(ym: string): Date {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1, -9, 0, 0, 0));
}

/**
 * GET /api/profit-dashboard/sales-per-manday?from=2024-01&to=2026-09&groupFrom=2025-03&groupTo=2026-02
 *
 * 期別・月別の「売上 ÷ 人工」と 3 か月移動平均、顧客別・工事内容別（過去データ取込 仕様 3-4）。
 * 2026-04 までは過去データ（取り込んだ請求書・作業履歴・売上調整）、2026-05 からは DandoLink のデータで数える。
 *
 * 期別・月別は会社全体の数字なので、土場・研修など非現場の人工と売上も含める
 * （仕様の完了条件＝決算・売上入金表と突き合わせる数字が、非現場を含めて計算されているため）。
 * 顧客別・工事内容別は現場の比較なので非現場を外す。
 */
export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const sp = new URL(request.url).searchParams;
        const nowYm = jstYearMonthOf(new Date());
        const from = YM_RE.test(sp.get('from') ?? '') ? sp.get('from')! : '2024-01';
        const toRaw = YM_RE.test(sp.get('to') ?? '') ? sp.get('to')! : nowYm;
        const to = toRaw < from ? from : toRaw;
        const groupFrom = YM_RE.test(sp.get('groupFrom') ?? '') ? sp.get('groupFrom')! : from;
        const groupTo = YM_RE.test(sp.get('groupTo') ?? '') ? sp.get('groupTo')! : to;

        // 3 か月移動平均のため、表示の最初の月の 2 か月前から集める
        const fetchFrom = shiftYearMonth(from < groupFrom ? from : groupFrom, -2);
        const fetchTo = to > groupTo ? to : groupTo;
        const fromInstant = jstMonthStart(fetchFrom);
        const toInstant = jstMonthStart(shiftYearMonth(fetchTo, 1));

        const facts: SalesPerManDayFact[] = [];
        const salesStatuses = [...SALES_INVOICE_STATUSES];

        // ---- 2026-04 まで: 過去データ ----
        if (fetchFrom < LIVE_DATA_START_MONTH) {
            const bfEnd = toInstant < LIVE_DATA_START ? toInstant : LIVE_DATA_START;
            const [invoices, assignments, adjustments] = await Promise.all([
                prisma.invoice.findMany({
                    where: { isBackfilled: true, status: { in: salesStatuses }, createdAt: { gte: fromInstant, lt: bfEnd } },
                    select: { subtotal: true, createdAt: true, projectMasterId: true },
                }),
                prisma.projectAssignment.findMany({
                    where: { isBackfilled: true, memberCount: { gt: 0 }, date: { gte: fromInstant, lt: bfEnd } },
                    select: { projectMasterId: true, date: true, memberCount: true },
                }),
                prisma.revenueAdjustment.findMany({
                    where: { yearMonth: { gte: fetchFrom, lte: fetchTo, lt: LIVE_DATA_START_MONTH } },
                    select: { yearMonth: true, customerName: true, amountExclTax: true },
                }),
            ]);
            const pmIds = new Set<string>();
            for (const i of invoices) if (i.projectMasterId) pmIds.add(i.projectMasterId);
            for (const a of assignments) pmIds.add(a.projectMasterId);
            const pms = pmIds.size
                ? await prisma.projectMaster.findMany({
                    where: { id: { in: [...pmIds] } },
                    select: { id: true, customerName: true, isNonSite: true },
                })
                : [];
            const pmById = new Map(pms.map((p) => [p.id, p]));
            const customerOf = (pid: string | null) => (pid ? pmById.get(pid)?.customerName ?? null : null);
            // 非現場は顧客別・工事内容別に入れない（会社全体の月別・期別には含める）
            const nonSite = (pid: string | null) => !!(pid && pmById.get(pid)?.isNonSite);
            for (const i of invoices) {
                facts.push({
                    yearMonth: jstYearMonthOf(i.createdAt), sales: Number(i.subtotal), manDays: 0,
                    customerName: customerOf(i.projectMasterId), content: null, excludeFromGroups: nonSite(i.projectMasterId),
                });
            }
            for (const a of assignments) {
                facts.push({
                    yearMonth: jstYearMonthOf(a.date), sales: 0, manDays: a.memberCount,
                    customerName: customerOf(a.projectMasterId), content: null, excludeFromGroups: nonSite(a.projectMasterId),
                });
            }
            for (const a of adjustments) {
                facts.push({ yearMonth: a.yearMonth, sales: a.amountExclTax, manDays: 0, customerName: a.customerName, content: null });
            }
        }

        // ---- 2026-05 から: DandoLink のデータ ----
        if (fetchTo >= LIVE_DATA_START_MONTH) {
            const liveStart = fromInstant > LIVE_DATA_START ? fromInstant : LIVE_DATA_START;
            const [invoices, assignmentProjects] = await Promise.all([
                prisma.invoice.findMany({
                    where: { isBackfilled: false, status: { in: salesStatuses }, createdAt: { gte: liveStart, lt: toInstant } },
                    select: { subtotal: true, createdAt: true, projectMasterId: true, items: true, customerId: true },
                }),
                prisma.projectAssignment.findMany({
                    where: { isBackfilled: false, date: { gte: liveStart, lt: toInstant } },
                    select: { projectMasterId: true },
                    distinct: ['projectMasterId'],
                }),
            ]);

            // 人工 = 日報から原価計上した人数（一人当たりの稼ぎの「総人数」と同じ・協力業者職長の配置は含まない）
            const workIds = assignmentProjects.map((a) => a.projectMasterId);
            const costMap = workIds.length ? await computeProjectCosts(workIds, { withDetail: true }) : new Map();

            const pmIds = new Set<string>(workIds);
            const invoiceShares = invoices.map((inv) => ({ inv, shares: invoiceProjectShares(inv) }));
            for (const { shares } of invoiceShares) for (const pid of shares.keys()) pmIds.add(pid);
            const [pms, customers] = await Promise.all([
                pmIds.size
                    ? prisma.projectMaster.findMany({
                        where: { id: { in: [...pmIds] } },
                        select: { id: true, customerName: true, constructionContent: true },
                    })
                    : Promise.resolve([]),
                prisma.customer.findMany({
                    where: { id: { in: invoices.map((i) => i.customerId).filter((v): v is string => !!v) } },
                    select: { id: true, name: true },
                }),
            ]);
            const pmById = new Map(pms.map((p) => [p.id, p]));
            const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

            for (const { inv, shares } of invoiceShares) {
                const ym = jstYearMonthOf(inv.createdAt);
                const subtotal = Number(inv.subtotal);
                if (shares.size === 0) {
                    // 案件なし請求は請求書の顧客で数える
                    facts.push({ yearMonth: ym, sales: subtotal, manDays: 0, customerName: inv.customerId ? customerNameById.get(inv.customerId) ?? null : null, content: null });
                    continue;
                }
                for (const [pid, share] of shares) {
                    const pm = pmById.get(pid);
                    facts.push({
                        yearMonth: ym,
                        sales: subtotal * share,
                        manDays: 0,
                        customerName: pm?.customerName ?? null,
                        content: normalizeConstructionContent(pm?.constructionContent),
                    });
                }
            }
            for (const pid of workIds) {
                const pm = pmById.get(pid);
                const laborRows = costMap.get(pid)?.detail?.labor ?? [];
                for (const row of laborRows) {
                    const ym = row.date.slice(0, 7);
                    // 試用期間（〜2026-04）の日報は過去データと重なるので数えない
                    if (ym < LIVE_DATA_START_MONTH || ym < fetchFrom || ym > fetchTo) continue;
                    if (!row.workerCount) continue;
                    facts.push({
                        yearMonth: ym,
                        sales: 0,
                        manDays: row.workerCount,
                        customerName: pm?.customerName ?? null,
                        content: normalizeConstructionContent(pm?.constructionContent),
                    });
                }
            }
        }

        const summary = summarizeSalesPerManDay(facts, { from, to, groupFrom, groupTo });
        return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('売上÷人工の集計', error);
    }
}
