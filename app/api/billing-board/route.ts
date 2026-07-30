import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAccountant,
    serverErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';
import {
    computeInvoicedByProject,
    invoicedAmountForProject,
    getBillingStatus,
    type InvoiceForBillingSummary,
} from '@/lib/billing/billingStatus';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { closingPeriod } from '@/lib/closingDay';
import type { BillingBoardRow, BillingBoardWorkItem, BillingDecision } from '@/types/billingBoard';

/** 1 案件あたりに返す作業履歴の上限（超過分は workCount で総数を示す）。 */
const MAX_WORK_ITEMS = 60;
const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD 判定。 */
function isYmd(s: string | null): s is string {
    return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
/** YYYY-MM 判定。 */
function isYm(s: string | null): s is string {
    return !!s && /^\d{4}-\d{2}$/.test(s);
}

/** YYYY-MM-DD（JST 日付）を UTC instant に直す（開始=0時 / 終了=23:59:59.999）。 */
function jstInstant(ymd: string, end = false): Date {
    return new Date(`${ymd}T${end ? '23:59:59.999' : '00:00:00'}+09:00`);
}

/**
 * GET /api/billing-board
 *
 * 請求判断ボードの行を集約して返す（admin / manager 限定）。金額はすべて税抜。
 *
 * 2 つの期間モード：
 *   - 締め分モード（既定）：`?month=YYYY-MM`。各顧客を「自分の請求締め日」で当該月分に集計する
 *     （例: 15日締めの顧客の 2026-06 分＝5/16〜6/15、末締め＝6/1〜6/30）。
 *     全締め日の窓を内包する superset（前月初〜当月末）で配置を取得し、顧客ごとの窓で絞る。
 *   - 任意範囲モード：`?from=YYYY-MM-DD&to=YYYY-MM-DD` が両方有効なとき。全顧客同一期間で集計（手入力用）。
 *
 * 掲載条件：対象期間内に配置(ProjectAssignment)があり、status≠cancelled の案件。
 *           全額請求済み(full)も含めて返し、クライアントの「請求済み」タブで請求額を確認できる。
 *
 * 日付境界：ProjectAssignment.date は「JST 0時 = UTC前日15時」で保存されるため、
 *           JST 日付を `T00:00:00+09:00` / `T23:59:59.999+09:00` の UTC instant に直して比較する
 *           （feedback: assignment_date_jst_boundary）。
 */
export async function GET(req: NextRequest) {
    try {
        // 閲覧は税理士(accountant)にも開放（このルートは GET のみ。請求判断の更新は別ルート）
        const { error } = await requireManagerOrAccountant();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const monthParam = searchParams.get('month');
        const fromParam = searchParams.get('from');
        const toParam = searchParams.get('to');

        // from/to が両方有効＝任意範囲モード。それ以外＝締め分モード（month、既定=当月JST）。
        const rangeMode = isYmd(fromParam) && isYmd(toParam);

        let refYear: number;
        let refMonth0: number;
        if (isYm(monthParam)) {
            const [y, m] = (monthParam as string).split('-').map(Number);
            refYear = y;
            refMonth0 = m - 1;
        } else {
            const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
            refYear = jst.getUTCFullYear();
            refMonth0 = jst.getUTCMonth();
        }

        // 締め分モードの判断キー（periodKey="YYYY-MM"＝基準月）。案件×締め月ごとの請求判断の解決に使う。
        const periodKey = `${refYear}-${pad(refMonth0 + 1)}`;

        // 取得対象（superset）：締め分は前月初〜当月末（全締め日の窓を内包）、任意範囲は from〜to。
        let supersetFrom: string;
        let supersetTo: string;
        if (rangeMode) {
            supersetFrom = fromParam as string;
            supersetTo = toParam as string;
        } else {
            const prev = new Date(Date.UTC(refYear, refMonth0 - 1, 1));
            const lastOfRef = new Date(Date.UTC(refYear, refMonth0 + 1, 0)).getUTCDate();
            supersetFrom = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-01`;
            supersetTo = `${refYear}-${pad(refMonth0 + 1)}-${pad(lastOfRef)}`;
        }
        const start = jstInstant(supersetFrom);
        const end = jstInstant(supersetTo, true);

        // 顧客の締め日マップ（締め分モードで顧客ごとの窓を出すため）
        const customers = await prisma.customer.findMany({ select: { id: true, closingDay: true } });
        const closingByCustomer = new Map<string, number>(customers.map((c) => [c.id, c.closingDay ?? 0]));

        // superset 内に配置のある案件
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
                billingEstimateIds: true,
                createdBy: true,
            },
        });

        const projectIds = projects.map((p) => p.id);
        if (projectIds.length === 0) {
            return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
        }

        const [invoices, assignments, estimates, pendingDrafts, decisions] = await Promise.all([
            prisma.invoice.findMany({
                select: { status: true, subtotal: true, items: true, projectMasterId: true, createdAt: true },
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
                select: { id: true, projectMasterId: true, status: true, subtotal: true },
            }),
            prisma.billingDraft.findMany({
                where: { projectId: { in: projectIds }, status: 'pending', deletedAt: null },
                select: { projectId: true },
            }),
            // 締め分モードのみ：当月(periodKey)の請求判断を引く。任意範囲モードは判断を出さない（pending固定）。
            rangeMode
                ? Promise.resolve([] as { projectMasterId: string; decision: string }[])
                : prisma.projectBillingDecision.findMany({
                      where: { projectMasterId: { in: projectIds }, periodKey },
                      select: { projectMasterId: true, decision: true },
                  }),
        ]);

        // 請求書を集計用の形に正規化（明細 parse 済み・createdAt 付き）。
        // 案件トータルの請求済み（invoicedByProject）と、月ごとの請求実績（後述）の両方で再利用する。
        const normalizedInvoices = invoices.map((inv) => ({
            status: inv.status,
            subtotal: Number(inv.subtotal),
            items: parseJsonField<InvoiceForBillingSummary['items']>(inv.items, []),
            projectMasterId: inv.projectMasterId,
            createdAt: inv.createdAt,
        }));
        const invoicedByProject = computeInvoicedByProject(normalizedInvoices);

        // superset 内の配置を案件ごとに（asc 取得済み）
        type Asg = (typeof assignments)[number];
        const asgByProject = new Map<string, Asg[]>();
        for (const a of assignments) {
            const arr = asgByProject.get(a.projectMasterId);
            if (arr) arr.push(a);
            else asgByProject.set(a.projectMasterId, [a]);
        }

        const estimateCountByProject = new Map<string, number>();
        const approvedProjects = new Set<string>();
        const firstEstimateSubtotal = new Map<string, number>(); // 見積1件のときの基準額（税抜）
        const subtotalByEstimateId = new Map<string, number>(); // 見積ID → 税抜小計（現在値）
        for (const e of estimates) {
            subtotalByEstimateId.set(e.id, Number(e.subtotal) || 0);
            if (!e.projectMasterId) continue;
            estimateCountByProject.set(e.projectMasterId, (estimateCountByProject.get(e.projectMasterId) ?? 0) + 1);
            if (e.status === 'approved') approvedProjects.add(e.projectMasterId);
            if (!firstEstimateSubtotal.has(e.projectMasterId)) {
                firstEstimateSubtotal.set(e.projectMasterId, Number(e.subtotal) || 0);
            }
        }

        const draftProjectIds = new Set(pendingDrafts.map((d) => d.projectId));

        // 案件ID → 当月の請求判断（pending はレコード無し＝Map に現れない）。任意範囲モードは decisions=[] で常に空。
        const decisionByProject = new Map<string, BillingDecision>(
            decisions.map((d) => [d.projectMasterId, d.decision as BillingDecision]),
        );

        const rows: BillingBoardRow[] = [];
        for (const p of projects) {
            const cd = p.customerId ? (closingByCustomer.get(p.customerId) ?? 0) : 0;

            // この行の集計対象期間：締め分＝顧客の締め日ウィンドウ、任意範囲＝指定 from/to。
            const win = rangeMode ? { from: supersetFrom, to: supersetTo } : closingPeriod(refYear, refMonth0, cd);
            const winStart = rangeMode ? start : jstInstant(win.from);
            const winEnd = rangeMode ? end : jstInstant(win.to, true);

            const all = asgByProject.get(p.id) ?? [];
            const inWin = rangeMode ? all : all.filter((a) => a.date >= winStart && a.date <= winEnd);
            if (inWin.length === 0) continue; // この期間に作業が無い案件は出さない

            // 作業履歴・最終作業日・工事種別（初出順）を窓内の配置から組み立てる
            const work: BillingBoardWorkItem[] = [];
            const ctypes: string[] = [];
            let lastWorkDate: string | null = null;
            for (const a of inWin) {
                const iso = a.date.toISOString();
                work.push({
                    date: iso,
                    constructionType: a.constructionType ?? null,
                    foremanId: a.assignedEmployeeId ?? null,
                    memberCount: a.memberCount,
                });
                lastWorkDate = iso; // asc 取得なので最後＝最大日
                if (a.constructionType && !ctypes.includes(a.constructionType)) ctypes.push(a.constructionType);
            }

            const invoiced = invoicedByProject[p.id] ?? 0;

            // 月ごとの請求実績：この締め月（win）内に発行された請求書の、この案件ぶんの請求額（税抜）。
            // 「請求済み」タブはこの月内の請求で判定する（案件トータルの billingStatus とは別＝月をまたがない）。
            let monthlyInvoiced = 0;
            for (const inv of normalizedInvoices) {
                if (inv.status === 'cancelled') continue;
                if (inv.createdAt < winStart || inv.createdAt > winEnd) continue;
                monthlyInvoiced += invoicedAmountForProject(inv, p.id);
            }

            const contract = p.contractAmount ?? null;
            const eCount = estimateCountByProject.get(p.id) ?? 0;

            // 見積金額の解決（優先順）。金額のスナップショットは持たず、常に見積書の現在値（subtotal・税抜）から
            // 計算する＝見積書を修正したらボードの見積金額も即追従する。
            //   a. billingEstimateIds（選んだ見積のID配列）が非空 → その見積の subtotal 合算（存在しないIDは無視）。
            //      全滅（1件も見つからない）なら未選択扱いで b 以降にフォールバックする。
            //   b. 見積が1件 → その見積の subtotal（ライブ値）。※contractAmount より優先する（不具合修正の本体）。
            //   c. 見積が複数 → contractAmount があればそれ（旧スナップショット互換・再選択すれば a に移行）、
            //      無ければ null ＋ needsEstimatePick=true（画面で「見積を選択」を促す）。
            //   d. 見積が0件 → contractAmount（手入力の足場工事金額。無ければ null）。
            const pickedIds = Array.isArray(p.billingEstimateIds)
                ? (p.billingEstimateIds as unknown[]).filter((v): v is string => typeof v === 'string')
                : [];
            let pickedSum: number | null = null;
            if (pickedIds.length > 0) {
                let sum = 0;
                let found = 0;
                for (const eid of pickedIds) {
                    const s = subtotalByEstimateId.get(eid);
                    if (s === undefined) continue; // 削除された見積は無視
                    sum += s;
                    found += 1;
                }
                if (found > 0) pickedSum = sum;
            }

            let estimateAmount: number | null;
            let needsEstimatePick = false;
            if (pickedSum != null) {
                estimateAmount = pickedSum;
            } else if (eCount === 1) {
                estimateAmount = firstEstimateSubtotal.get(p.id) ?? 0;
            } else if (eCount > 1) {
                estimateAmount = contract;
                needsEstimatePick = contract == null;
            } else {
                estimateAmount = contract;
            }
            const billingStatus = getBillingStatus(estimateAmount, invoiced);

            rows.push({
                id: p.id,
                title: p.title,
                name: p.name,
                customerId: p.customerId,
                customerName: p.customerName,
                status: p.status,
                contractAmount: contract,
                estimateAmount,
                needsEstimatePick,
                invoicedAmount: invoiced,
                monthlyInvoicedAmount: monthlyInvoiced,
                billingStatus,
                remainingAmount: estimateAmount != null ? estimateAmount - invoiced : null,
                assigneeIds: extractAssigneeIds(p.createdBy ?? undefined),
                lastWorkDate,
                constructionTypeIds: ctypes,
                workHistory: work.slice(-MAX_WORK_ITEMS), // 日付の若い順（昇順）。上限超過時は直近側を残す
                workCount: work.length,
                estimateCount: estimateCountByProject.get(p.id) ?? 0,
                hasApprovedEstimate: approvedProjects.has(p.id),
                hasPendingDraft: draftProjectIds.has(p.id),
                billingDecision: rangeMode ? 'pending' : (decisionByProject.get(p.id) ?? 'pending'),
                customerClosingDay: cd,
                periodFrom: win.from,
                periodTo: win.to,
            });
        }

        return NextResponse.json(rows, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求判断ボードの取得', error);
    }
}
