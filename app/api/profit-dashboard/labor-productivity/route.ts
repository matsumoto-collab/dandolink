import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';
import { SALES_INVOICE_STATUSES, invoiceProjectShares } from '@/lib/profitDashboard';
import { computeValueAdded } from '@/lib/valueAdded';
import { loadValueAddedSettings } from '@/lib/valueAddedSettings';
import { normalizeConstructionContent } from '@/lib/constructionContent';
import { summarizeLaborProductivity, type LaborProductivityProject } from '@/lib/laborProductivity';
import { normalizeCompanyName } from '@/lib/backfill/matching';
import { LIVE_DATA_START } from '@/lib/backfill/constants';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** JST の 'YYYY-MM-DD' 0 時を表す UTC 時刻 */
function jstDayStart(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, -9, 0, 0, 0));
}

/** 顧客名の突き合わせキー（法人格の有無を寄せる。売上÷人工の区分と同じ規則） */
function customerKeyOf(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return '__none__';
    return normalizeCompanyName(trimmed) || trimmed;
}

/**
 * GET /api/profit-dashboard/labor-productivity
 *   ?from=2026-05-01&to=2026-09-30&assigneeId=&customerKey=&content=
 *   （from/to 省略時は直近 12 か月。months=6|12|24 でも指定できる＝従来の呼び方）
 *
 * 「一人当たりの稼ぎ」タブ（仕様3-4）。期間内に請求(送付済み以降)がある案件を対象に、
 * 案件単位の稼ぎ・総人数を区分別（工事内容・顧客・担当者）へ集計する。
 *
 * 稼ぎは案件単位で通算する（月按分はしない＝仕様4）。対象に入るかどうかだけを
 * 「その期間に請求があるか」で決める。担当者・顧客・工事内容の絞り込みは案件に対してかける
 * （kei 要望 2026-09-12。タブ上部の絞り込みが売上÷人工と共通）。
 *
 * 過去データ（DandoLink 導入前）の案件は原価が無いので対象にしない。期間が 2026-04 以前だけのときは
 * 対象 0 件で返る（画面側で「原価が無いので出せません」と案内する）。
 *
 * 権限は requireManagerOrAbove（既存のダッシュボードと同じ）。職長・協力業者は 403 で
 * レスポンス自体が返らない。
 */
export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const sp = new URL(request.url).searchParams;
        const monthsParam = Number(sp.get('months') ?? '12');
        const months = Number.isFinite(monthsParam) ? Math.min(60, Math.max(1, Math.trunc(monthsParam))) : 12;
        const assigneeFilter = sp.get('assigneeId') ?? '';
        const customerFilter = sp.get('customerKey') ?? '';
        const contentFilter = sp.get('content') ?? '';

        const now = new Date();
        const nowJst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const defaultFrom = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth() - (months - 1), 1, -9, 0, 0, 0));
        const fromParam = sp.get('from');
        const toParam = sp.get('to');
        const fromRaw = fromParam && DATE_RE.test(fromParam) ? jstDayStart(fromParam) : defaultFrom;
        // 2026-04 までは過去データを正とする（countsInPeriodAggregate と同じ）。試用期間の請求を数えると
        // すぐ上の「売上 ÷ 人工」と食い違うので、稼ぎの対象は 2026-05 以降の請求だけにする
        const from = fromRaw > LIVE_DATA_START ? fromRaw : LIVE_DATA_START;
        // 期間の終わりは「その日の翌日 0 時」（排他上限）。省略時は上限なし
        const toExclusive = toParam && DATE_RE.test(toParam)
            ? new Date(jstDayStart(toParam).getTime() + 86400000)
            : null;

        // 1) 対象期間に請求がある案件を集める（まとめ請求は明細のシェアで案件へ振り分ける）
        //    請求日は Invoice.createdAt（請求書フォームの請求日がここに入る＝月次売上と同じ扱い）
        // 過去データ（DandoLink 導入前）の案件は原価が無く、どのみち no_cost で集計から外れるので候補にしない
        // （原価エンジンを 1,000 件以上余計に回さないため）。期別・月別の「売上 ÷ 人工」は別の API で過去データも数える
        const recentInvoices = await prisma.invoice.findMany({
            where: {
                status: { in: [...SALES_INVOICE_STATUSES] },
                createdAt: toExclusive ? { gte: from, lt: toExclusive } : { gte: from },
                isBackfilled: false,
            },
            select: { items: true, projectMasterId: true },
        });
        const targetIds = new Set<string>();
        for (const inv of recentInvoices) {
            for (const [pid, share] of invoiceProjectShares(inv)) {
                if (share > 0) targetIds.add(pid);
            }
        }
        const ids = Array.from(targetIds);
        if (ids.length === 0) {
            const settings = await loadValueAddedSettings();
            return NextResponse.json(
                { months, summary: summarizeLaborProductivity([], settings.breakevenPerManday) },
                { headers: { 'Cache-Control': 'no-store' } },
            );
        }

        // 2) 案件の属性・原価・売上（売上は案件全体の確定請求＝期間で切らない）
        const [projectMasters, estimates, allInvoices, costMap, assignmentCounts, settings] = await Promise.all([
            prisma.projectMaster.findMany({
                where: { id: { in: ids } },
                select: {
                    id: true, title: true, name: true, honorific: true,
                    customerName: true, constructionContent: true, createdBy: true,
                },
            }),
            prisma.estimate.findMany({
                where: { projectMasterId: { in: ids } },
                select: { projectMasterId: true, subtotal: true },
            }),
            prisma.invoice.findMany({
                where: { status: { in: [...SALES_INVOICE_STATUSES] }, isBackfilled: false },
                select: { subtotal: true, items: true, projectMasterId: true },
            }),
            computeProjectCosts(ids, { withDetail: true }),
            prisma.projectAssignment.groupBy({
                by: ['projectMasterId'],
                where: { projectMasterId: { in: ids } },
                _count: { _all: true },
            }),
            loadValueAddedSettings(),
        ]);

        const idSet = new Set(ids);
        const estimateSubtotalById = new Map<string, number>();
        for (const e of estimates) {
            if (!e.projectMasterId) continue;
            estimateSubtotalById.set(
                e.projectMasterId,
                (estimateSubtotalById.get(e.projectMasterId) ?? 0) + Number(e.subtotal),
            );
        }
        const invoiceSubtotalById = new Map<string, number>();
        for (const inv of allInvoices) {
            for (const [pid, share] of invoiceProjectShares(inv)) {
                if (share <= 0 || !idSet.has(pid)) continue;
                invoiceSubtotalById.set(pid, (invoiceSubtotalById.get(pid) ?? 0) + Number(inv.subtotal) * share);
            }
        }
        const assignmentCountById = new Map(assignmentCounts.map(r => [r.projectMasterId, r._count._all]));

        // 担当者名（案件の createdBy は JSON 配列。実データは1人だが複数なら先頭を代表にする）
        const assigneeIds = new Set<string>();
        const firstAssigneeByProject = new Map<string, string>();
        for (const pm of projectMasters) {
            let list: string[] = [];
            const raw = pm.createdBy;
            if (typeof raw === 'string') {
                try { list = JSON.parse(raw); } catch { list = raw ? [raw] : []; }
            }
            if (!Array.isArray(list)) list = [];
            if (list.length > 0) {
                firstAssigneeByProject.set(pm.id, list[0]);
                assigneeIds.add(list[0]);
            }
        }
        const assigneeUsers = assigneeIds.size > 0
            ? await prisma.user.findMany({
                where: { id: { in: Array.from(assigneeIds) } },
                select: { id: true, displayName: true },
            })
            : [];
        const assigneeNameById = new Map(assigneeUsers.map(u => [u.id, u.displayName]));

        const projects: LaborProductivityProject[] = projectMasters.map(pm => {
            const cost = costMap.get(pm.id);
            const b = cost?.breakdown ?? {
                laborCost: 0, loadingCost: 0, vehicleCost: 0,
                materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0,
            };
            const laborRows = cost?.detail?.labor ?? [];
            const headcount = laborRows.reduce((s, r) => s + (r.workerCount || 0), 0);
            const manualItems = cost?.detail?.manualItems;
            const hasManualCost =
                (manualItems
                    ? Object.values(manualItems).some(items => items.some(item => Number(item.amount) !== 0))
                    : false) ||
                laborRows.some(r => r.override != null) ||
                (cost?.detail?.vehicle ?? []).some(r => r.override != null) ||
                (cost?.detail?.subcontractor ?? []).some(r => r.override != null);

            const assigneeId = firstAssigneeByProject.get(pm.id) ?? null;
            return {
                projectMasterId: pm.id,
                title: pm.name ? `${pm.name}${pm.honorific ?? ''}` : pm.title,
                customerName: pm.customerName,
                constructionContent: normalizeConstructionContent(pm.constructionContent),
                assigneeId,
                assigneeName: assigneeId ? assigneeNameById.get(assigneeId) ?? null : null,
                valueAdded: computeValueAdded(
                    {
                        sales: Math.round(invoiceSubtotalById.get(pm.id) ?? 0),
                        cost: b,
                        headcount,
                        estimateSubtotal: Math.round(estimateSubtotalById.get(pm.id) ?? 0),
                        hasManualCost,
                        hasAssignments: (assignmentCountById.get(pm.id) ?? 0) > 0,
                    },
                    settings,
                ),
            };
        });

        // 担当者・顧客・工事内容の絞り込み（タブ上部の絞り込みと同じ条件を案件にかける）
        const filtered = projects.filter((p) => {
            if (assigneeFilter && p.assigneeId !== assigneeFilter) return false;
            if (contentFilter && p.constructionContent !== contentFilter) return false;
            if (customerFilter && customerKeyOf(p.customerName) !== customerFilter) return false;
            return true;
        });

        return NextResponse.json(
            {
                months,
                summary: summarizeLaborProductivity(filtered, settings.breakevenPerManday),
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('人工生産性集計', error);
    }
}
