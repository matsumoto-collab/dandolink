import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';
import { SALES_INVOICE_STATUSES, invoiceProjectShares } from '@/lib/profitDashboard';
import { normalizeConstructionContent } from '@/lib/constructionContent';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { LIVE_DATA_START, LIVE_DATA_START_MONTH, jstYearMonthOf } from '@/lib/backfill/constants';
import { normalizeCompanyName } from '@/lib/backfill/matching';
import {
    shiftYearMonth,
    summarizeSalesPerManDay,
    type SalesPerManDayFact,
    type SalesPerManDayGranularity,
} from '@/lib/salesPerManDay';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 日別で出せる最長の期間（1 日 1 行なので長すぎると読めない） */
const MAX_DAY_RANGE_DAYS = 120;

/** JST の 'YYYY-MM-DD' */
function jstDateOf(date: Date): string {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** JST の 'YYYY-MM-DD' 0 時を表す UTC 時刻 */
function jstDayStart(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, -9, 0, 0, 0));
}

/**
 * GET /api/profit-dashboard/sales-per-manday
 *   ?from=2024-01-01&to=2026-09-30&granularity=month|day
 *   &assigneeId=&customerKey=&content=
 *
 * 期別・月別・日別の「売上 ÷ 人工」と、顧客別・工事内容別・担当者別（過去データ取込 仕様 3-4）。
 * 2026-04 までは過去データ、2026-05 からは DandoLink のデータで数える（countsInPeriodAggregate と同じ考え方）。
 *
 * 期別・月別・日別は会社全体の数字なので、土場・研修など非現場の人工と売上も含める
 * （仕様の完了条件＝決算・売上入金表と突き合わせる数字が、非現場を含めて計算されているため）。
 * 顧客別・工事内容別・担当者別は現場の比較なので非現場を外す。
 */
export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const sp = new URL(request.url).searchParams;
        const todayJst = jstDateOf(new Date());
        const from = DATE_RE.test(sp.get('from') ?? '') ? sp.get('from')! : '2024-01-01';
        const toRaw = DATE_RE.test(sp.get('to') ?? '') ? sp.get('to')! : todayJst;
        const to = toRaw < from ? from : toRaw;
        const granularity: SalesPerManDayGranularity = sp.get('granularity') === 'day' ? 'day' : 'month';
        const assigneeId = sp.get('assigneeId') ?? '';
        const customerKey = sp.get('customerKey') ?? '';
        const content = sp.get('content') ?? '';

        if (granularity === 'day') {
            const days = (jstDayStart(to).getTime() - jstDayStart(from).getTime()) / 86400000 + 1;
            if (days > MAX_DAY_RANGE_DAYS) {
                return validationErrorResponse(`日別で出せるのは ${MAX_DAY_RANGE_DAYS} 日までです。期間を短くするか月別にしてください`);
            }
        }

        // 3 か月移動平均のため、表示する期間の 2 か月前から集める
        const fetchFromMonth = shiftYearMonth(from.slice(0, 7), -2);
        const fromInstant = jstDayStart(`${fetchFromMonth}-01`);
        const toInstant = new Date(jstDayStart(to).getTime() + 86400000); // 排他上限（to の翌日 0 時）

        const facts: SalesPerManDayFact[] = [];
        const salesStatuses = [...SALES_INVOICE_STATUSES];
        /** 担当者ID → 表示名 */
        const assigneeNameById = new Map<string, string>();

        const pushFact = (f: SalesPerManDayFact) => facts.push(f);

        // ---- 2026-04 まで: 過去データ ----
        if (fetchFromMonth < LIVE_DATA_START_MONTH) {
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
                    where: { yearMonth: { gte: fetchFromMonth, lte: to.slice(0, 7), lt: LIVE_DATA_START_MONTH } },
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
            // 過去データの案件は担当者を持たない（CSV に無い）
            for (const i of invoices) {
                const pm = i.projectMasterId ? pmById.get(i.projectMasterId) : undefined;
                pushFact({
                    date: jstDateOf(i.createdAt), yearMonth: jstYearMonthOf(i.createdAt),
                    sales: Number(i.subtotal), manDays: 0,
                    customerName: pm?.customerName ?? null, content: null,
                    assigneeId: null, assigneeName: null, excludeFromGroups: pm?.isNonSite,
                });
            }
            for (const a of assignments) {
                const pm = pmById.get(a.projectMasterId);
                pushFact({
                    date: jstDateOf(a.date), yearMonth: jstYearMonthOf(a.date),
                    sales: 0, manDays: a.memberCount,
                    customerName: pm?.customerName ?? null, content: null,
                    assigneeId: null, assigneeName: null, excludeFromGroups: pm?.isNonSite,
                });
            }
            for (const a of adjustments) {
                // 売上調整は顧客別・月別。日が分からないので日別には出さない（date=null）
                pushFact({
                    date: null, yearMonth: a.yearMonth, sales: a.amountExclTax, manDays: 0,
                    customerName: a.customerName, content: null, assigneeId: null, assigneeName: null,
                });
            }
        }

        // ---- 2026-05 から: DandoLink のデータ ----
        if (to.slice(0, 7) >= LIVE_DATA_START_MONTH) {
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
                        select: { id: true, customerName: true, constructionContent: true, createdBy: true },
                    })
                    : Promise.resolve([]),
                prisma.customer.findMany({
                    where: { id: { in: invoices.map((i) => i.customerId).filter((v): v is string => !!v) } },
                    select: { id: true, name: true },
                }),
            ]);
            const pmById = new Map(pms.map((p) => [p.id, p]));
            const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

            const assigneeIds = new Set<string>();
            const assigneeByProject = new Map<string, string>();
            for (const p of pms) {
                const first = extractAssigneeIds(p.createdBy ?? undefined)[0];
                if (first) { assigneeByProject.set(p.id, first); assigneeIds.add(first); }
            }
            if (assigneeIds.size > 0) {
                const users = await prisma.user.findMany({
                    where: { id: { in: [...assigneeIds] } },
                    select: { id: true, displayName: true },
                });
                for (const u of users) assigneeNameById.set(u.id, u.displayName);
            }
            const metaOf = (pid: string | null) => {
                const pm = pid ? pmById.get(pid) : undefined;
                const aid = pid ? assigneeByProject.get(pid) ?? null : null;
                return {
                    customerName: pm?.customerName ?? null,
                    content: normalizeConstructionContent(pm?.constructionContent),
                    assigneeId: aid,
                    assigneeName: aid ? assigneeNameById.get(aid) ?? null : null,
                };
            };

            for (const { inv, shares } of invoiceShares) {
                const date = jstDateOf(inv.createdAt);
                const yearMonth = jstYearMonthOf(inv.createdAt);
                const subtotal = Number(inv.subtotal);
                if (shares.size === 0) {
                    // 案件なし請求は請求書の顧客で数える
                    pushFact({
                        date, yearMonth, sales: subtotal, manDays: 0,
                        customerName: inv.customerId ? customerNameById.get(inv.customerId) ?? null : null,
                        content: null, assigneeId: null, assigneeName: null,
                    });
                    continue;
                }
                for (const [pid, share] of shares) {
                    pushFact({ date, yearMonth, sales: subtotal * share, manDays: 0, ...metaOf(pid) });
                }
            }
            for (const pid of workIds) {
                const meta = metaOf(pid);
                const laborRows = costMap.get(pid)?.detail?.labor ?? [];
                for (const row of laborRows) {
                    const ym = row.date.slice(0, 7);
                    // 試用期間（〜2026-04）の日報は過去データと重なるので数えない
                    if (ym < LIVE_DATA_START_MONTH) continue;
                    if (!row.workerCount) continue;
                    pushFact({ date: row.date, yearMonth: ym, sales: 0, manDays: row.workerCount, ...meta });
                }
            }
        }

        // ---- 絞り込みの選択肢（絞り込む前の全体から作る＝選ぶと候補が消えない） ----
        const fromMonth = from.slice(0, 7);
        const toMonth = to.slice(0, 7);
        const inRange = facts.filter((f) =>
            f.date ? f.date >= from && f.date <= to : f.yearMonth >= fromMonth && f.yearMonth <= toMonth,
        );
        const customerOptions = new Map<string, string>();
        const contentOptions = new Set<string>();
        const assigneeOptions = new Map<string, string>();
        for (const f of inRange) {
            if (f.excludeFromGroups) continue;
            const cname = (f.customerName ?? '').trim();
            if (cname) customerOptions.set(normalizeCompanyName(cname) || cname, cname);
            if (f.content) contentOptions.add(f.content);
            if (f.assigneeId) assigneeOptions.set(f.assigneeId, f.assigneeName || '(不明)');
        }

        // ---- 絞り込み ----
        const filtered = facts.filter((f) => {
            if (assigneeId && f.assigneeId !== assigneeId) return false;
            if (content && f.content !== content) return false;
            if (customerKey) {
                const cname = (f.customerName ?? '').trim();
                const key = cname ? normalizeCompanyName(cname) || cname : '__none__';
                if (key !== customerKey) return false;
            }
            return true;
        });

        const summary = summarizeSalesPerManDay(filtered, { from, to, granularity });
        return NextResponse.json(
            {
                ...summary,
                filter: { assigneeId, customerKey, content },
                options: {
                    customers: [...customerOptions].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
                    contents: [...contentOptions].sort((a, b) => a.localeCompare(b, 'ja')),
                    assignees: [...assigneeOptions].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
                },
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('売上÷人工の集計', error);
    }
}
