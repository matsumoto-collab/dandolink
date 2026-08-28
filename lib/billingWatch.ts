import { prisma } from '@/lib/prisma';
import { closingDayLabel, closingPeriod } from '@/lib/closingDay';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { invoicedAmountForProject, type InvoiceForBillingSummary } from '@/lib/billing/billingStatus';
import { parseJsonField } from '@/lib/json-utils';
import { notifyUsers } from '@/lib/notifications';
import { logger } from '@/lib/logger';

/**
 * 「請求漏れの見張り」（請求待ちボードの判断待ちリマインド）。
 *
 * 顧客の締め日（Customer.closingDay）を過ぎたのに、その締め分の案件が請求待ちボードの
 * **判断待ちタブに残っている**（＝請求済み／保留／対象外のどれにもなっていない）ものを検知し、
 * 案件担当者へ 1 通のダイジェストとして通知する（Vercel Cron から 7 時 / 15 時 JST）。
 *
 * 停止条件（＝通知対象から外れる条件）は請求待ちボードの「判断待ち」タブと同じ:
 *   - ProjectBillingDecision に判断（hold / excluded / billed）が入った
 *   - その締め期間内に発行された請求書に、この案件ぶんの明細がある（monthlyInvoiced > 0）
 * どちらかが立てば次回実行から鳴らない。専用の停止フラグは持たない（状態を二重管理しないため）。
 */

export const BILLING_WATCH_TYPE = 'billing-pending';

/** 何ヶ月ぶんの締め期間まで遡って未処理を探すか（これより古い締め分は放置データとみなす）。 */
const LOOKBACK_MONTHS = 3;
/**
 * これより古い締め期間は通知しない（"YYYY-MM"）。
 *
 * middleware の matcher 漏れで Cron が長期間 401 に阻まれており、有効化した瞬間に
 * 溜まっていた過去分が一斉に鳴るのを防ぐための下限。2026-06 以前は通知しない（kei 判断）。
 * 通常運用では LOOKBACK_MONTHS の方が先に効くので、以降は実質無害な定数になる。
 */
const MIN_PERIOD_KEY = '2026-07';
/** ダイジェスト本文に載せる最大件数（超過分は「ほかN件」）。 */
const MAX_BODY_ITEMS = 6;

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD（JST 日付）を UTC instant に直す（開始=0時 / 終了=23:59:59.999）。 */
function jstInstant(ymd: string, end = false): Date {
    return new Date(`${ymd}T${end ? '23:59:59.999' : '00:00:00'}+09:00`);
}

/** YYYY-MM-DD → 「6/15」表記。 */
function mdOf(ymd: string): string {
    const [, m, d] = ymd.split('-').map(Number);
    return `${m}/${d}`;
}

/** 顧客ごとの「すでに締まった」締め期間。 */
interface ClosedWindow {
    customerId: string;
    customerName: string;
    closingDay: number;
    /** 締め基準月 "YYYY-MM"（ProjectBillingDecision.periodKey と対応） */
    periodKey: string;
    from: string;
    to: string;
}

/** 通知1行ぶん（案件単位。複数の締め分が残っていても最古の1件にまとめる）。 */
export interface WatchItem {
    projectId: string;
    text: string;
    /** 並び順用（最も古い締め日） */
    closingYmd: string;
    assigneeIds: string[];
}

/**
 * 判断待ちのまま締め日を過ぎた案件を集める（通知は送らない）。
 * 送信前に内容を確認する dry-run スクリプトからも使う。
 */
export async function collectBillingWatchItems(): Promise<WatchItem[]> {
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayYmd = `${jstNow.getUTCFullYear()}-${pad(jstNow.getUTCMonth() + 1)}-${pad(jstNow.getUTCDate())}`;
    const refYear = jstNow.getUTCFullYear();
    const refMonth0 = jstNow.getUTCMonth();

    const customers = await prisma.customer.findMany({ select: { id: true, name: true, closingDay: true } });

    // 顧客 × 直近 LOOKBACK_MONTHS ヶ月ぶんの締め期間のうち、締め日を迎えたもの（当日を含む）。
    const windows: ClosedWindow[] = [];
    for (const c of customers) {
        const cd = c.closingDay ?? 0;
        for (let back = 0; back < LOOKBACK_MONTHS; back++) {
            const ref = new Date(Date.UTC(refYear, refMonth0 - back, 1));
            const y = ref.getUTCFullYear();
            const m0 = ref.getUTCMonth();
            const { from, to } = closingPeriod(y, m0, cd);
            if (to > todayYmd) continue; // まだ締まっていない期間は対象外（締め日当日から鳴らす）
            const periodKey = `${y}-${pad(m0 + 1)}`;
            if (periodKey < MIN_PERIOD_KEY) continue; // 過去分の一斉通知を避けるための下限
            windows.push({
                customerId: c.id,
                customerName: c.name,
                closingDay: cd,
                periodKey,
                from,
                to,
            });
        }
    }
    if (windows.length === 0) return [];

    // 全ウィンドウを内包する範囲（案件・配置・請求書の取得はこの範囲に絞る）
    const supersetFrom = windows.reduce((min, w) => (w.from < min ? w.from : min), windows[0].from);
    const supersetTo = windows.reduce((max, w) => (w.to > max ? w.to : max), windows[0].to);
    const start = jstInstant(supersetFrom);
    const end = jstInstant(supersetTo, true);

    // 顧客ID → その顧客のウィンドウ群
    const windowsByCustomer = new Map<string, ClosedWindow[]>();
    for (const w of windows) {
        const arr = windowsByCustomer.get(w.customerId);
        if (arr) arr.push(w);
        else windowsByCustomer.set(w.customerId, [w]);
    }

    // 対象範囲に配置がある案件（請求待ちボードと同じ掲載条件）
    const projects = await prisma.projectMaster.findMany({
        where: {
            status: { not: 'cancelled' },
            customerId: { in: Array.from(windowsByCustomer.keys()) },
            assignments: { some: { date: { gte: start, lte: end } } },
        },
        select: { id: true, title: true, name: true, customerId: true, customerName: true, createdBy: true },
    });
    if (projects.length === 0) return [];

    const projectIds = projects.map((p) => p.id);
    const periodKeys = Array.from(new Set(windows.map((w) => w.periodKey)));

    const [assignments, decisions, invoices] = await Promise.all([
        prisma.projectAssignment.findMany({
            where: { projectMasterId: { in: projectIds }, date: { gte: start, lte: end } },
            select: { projectMasterId: true, date: true },
        }),
        prisma.projectBillingDecision.findMany({
            where: { projectMasterId: { in: projectIds }, periodKey: { in: periodKeys } },
            select: { projectMasterId: true, periodKey: true, decision: true },
        }),
        // 判定に必要なのは「その締め期間内に発行された請求書」だけなので範囲で絞る
        prisma.invoice.findMany({
            where: { createdAt: { gte: start, lte: end } },
            select: { status: true, subtotal: true, items: true, projectMasterId: true, createdAt: true },
        }),
    ]);

    const asgByProject = new Map<string, Date[]>();
    for (const a of assignments) {
        const arr = asgByProject.get(a.projectMasterId);
        if (arr) arr.push(a.date);
        else asgByProject.set(a.projectMasterId, [a.date]);
    }

    // 判断済み（pending 以外）のペア。ProjectBillingDecision は pending なら行が無い。
    const decidedPairs = new Set<string>();
    for (const d of decisions) {
        if (d.decision && d.decision !== 'pending') decidedPairs.add(`${d.projectMasterId}|${d.periodKey}`);
    }

    const normalizedInvoices = invoices.map((inv) => ({
        status: inv.status,
        subtotal: Number(inv.subtotal),
        items: parseJsonField<InvoiceForBillingSummary['items']>(inv.items, []),
        projectMasterId: inv.projectMasterId,
        createdAt: inv.createdAt,
    }));

    // 案件×締め期間ごとに「判断待ちのまま」かを判定し、案件単位（最古の締め分）にまとめる
    const items: WatchItem[] = [];
    for (const p of projects) {
        const wins = p.customerId ? (windowsByCustomer.get(p.customerId) ?? []) : [];
        if (wins.length === 0) continue;
        const dates = asgByProject.get(p.id) ?? [];
        if (dates.length === 0) continue;

        let oldest: ClosedWindow | null = null;
        let pendingCount = 0;
        for (const w of wins) {
            if (decidedPairs.has(`${p.id}|${w.periodKey}`)) continue;
            const winStart = jstInstant(w.from);
            const winEnd = jstInstant(w.to, true);
            if (!dates.some((d) => d >= winStart && d <= winEnd)) continue; // この締め分に作業が無い

            // この締め期間内に発行された請求書で、この案件ぶんが請求されていれば「請求済み」タブへ移る
            let monthlyInvoiced = 0;
            for (const inv of normalizedInvoices) {
                if (inv.status === 'cancelled') continue;
                if (inv.createdAt < winStart || inv.createdAt > winEnd) continue;
                monthlyInvoiced += invoicedAmountForProject(inv, p.id);
            }
            if (monthlyInvoiced > 0) continue;

            pendingCount += 1;
            if (!oldest || w.to < oldest.to) oldest = w;
        }
        if (!oldest) continue;

        const site = p.name || p.title || '案件';
        const customer = oldest.customerName || p.customerName || '顧客未設定';
        const more = pendingCount > 1 ? `ほか${pendingCount - 1}期間` : '';
        items.push({
            projectId: p.id,
            closingYmd: oldest.to,
            text: `・「${site}」${customer}（${closingDayLabel(oldest.closingDay)} ${mdOf(oldest.to)}締め分）${more}`,
            assigneeIds: extractAssigneeIds(p.createdBy ?? undefined),
        });
    }

    return items;
}

/**
 * 請求漏れの見張りを実行し、案件担当者ごとにダイジェスト通知を送る。
 * 戻り値は検知した案件数と送信ユーザー数（cron のログ用）。
 */
export async function runBillingWatch(): Promise<{ detected: number; notifiedUsers: number }> {
    const items = await collectBillingWatchItems();
    if (items.length === 0) return { detected: 0, notifiedUsers: 0 };

    // 宛先は案件担当者のみ（在籍ユーザーに限る）
    const allAssigneeIds = new Set<string>();
    items.forEach((it) => it.assigneeIds.forEach((id) => allAssigneeIds.add(id)));
    const activeUsers = allAssigneeIds.size
        ? await prisma.user.findMany({
              where: { id: { in: Array.from(allAssigneeIds) }, isActive: true },
              select: { id: true },
          })
        : [];
    const activeSet = new Set(activeUsers.map((u) => u.id));

    const itemsByUser = new Map<string, WatchItem[]>();
    for (const item of items) {
        for (const uid of item.assigneeIds) {
            if (!activeSet.has(uid)) continue;
            const arr = itemsByUser.get(uid);
            if (arr) arr.push(item);
            else itemsByUser.set(uid, [item]);
        }
    }

    let notifiedUsers = 0;
    for (const [userId, userItems] of Array.from(itemsByUser.entries())) {
        // 締め日が古い順（放置が長いものを上に）
        userItems.sort((a, b) => a.closingYmd.localeCompare(b.closingYmd));
        const shown = userItems.slice(0, MAX_BODY_ITEMS);
        const lines = shown.map((i) => i.text);
        if (userItems.length > shown.length) lines.push(`…ほか${userItems.length - shown.length}件`);

        try {
            await notifyUsers({
                userIds: [userId],
                type: BILLING_WATCH_TYPE,
                title: `請求の判断待ちが${userItems.length}件あります`,
                body: lines.join('\n'),
                url: '/?page=billing-board',
                // 7時・15時の2回で端末上の push は1つに上書きされる
                pushTag: 'billing-watch',
                data: {
                    kind: 'billing-watch',
                    projectIds: userItems.map((i) => i.projectId),
                },
            });
            notifiedUsers += 1;
        } catch (e) {
            logger.error(`[billingWatch] 通知送信に失敗 (userId=${userId})`, e);
        }
    }

    return { detected: items.length, notifiedUsers };
}
