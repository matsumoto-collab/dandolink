import { prisma } from '@/lib/prisma';
import { toJstDateOnly, jstDayStartUtc } from '@/lib/dateUtils';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { notifyUsers } from '@/lib/notifications';
import { formatJpShortDate } from '@/lib/scheduleChangeNotify';
import { logger } from '@/lib/logger';

/**
 * 「朝の見張りまとめ」（設計書 §7・Phase 2）。
 *
 * 毎朝の定期実行（Vercel Cron）で以下をルールベースのDBクエリで検知し、
 * 宛先ユーザーごとに **1日1通のダイジェスト** として通知する。
 *  1. 確認漏れの仮予定: confirmDueDate ≦ 今日 なのに tentative のまま → 案件担当者へ
 *  2. 期日が迫る浮き: 予定日まで7日以内（当日超過も残す）で未解消 → 案件担当者＋管理者へ
 *
 * 統合規則（§10-A #16）: 同一配置が両方にヒットする「仮の浮き」は必ず1項目に統合し、
 * 浮き（未解消需要）側を主文・先方確認を従文にする。日付も仮であることを「(日付も仮)」で明示。
 * 0件のユーザーには送らない。重複送信は見張り機能の信頼を壊すため仕様として禁止。
 */

export const SCHEDULE_WATCH_TYPE = 'schedule-watch';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** 浮きを「期日接近」として通知する先読み日数 */
const FLOATING_AHEAD_DAYS = 7;
/** 当日超過の浮きを通知し続ける上限（これより古いものは放置データとみなし通知しない） */
const FLOATING_BEHIND_DAYS = 30;
/** ダイジェスト本文に載せる最大項目数（超過分は「ほかN件」） */
const MAX_BODY_ITEMS = 6;

interface WatchItem {
    /** 並び順・統合用 */
    assignmentId: string;
    kind: 'floating' | 'tentative-overdue';
    text: string;
    /** 宛先（案件担当者のID。floating はこれに管理者が加わる） */
    assigneeIds: string[];
}

type PmSelect = { name: string | null; title: string; createdBy: string | null } | null;

function siteOf(pm: PmSelect): string {
    return pm?.name || pm?.title || '案件';
}

function daysFromToday(date: Date, today: Date): number {
    return Math.round((toJstDateOnly(date).getTime() - today.getTime()) / MS_PER_DAY);
}

/** 「あと3日」「明日」「今日」「2日超過」の言い分け */
function dueLabel(diffDays: number): string {
    if (diffDays > 1) return `あと${diffDays}日`;
    if (diffDays === 1) return '明日';
    if (diffDays === 0) return '今日';
    return `${-diffDays}日超過`;
}

/**
 * 見張りを実行し、宛先ごとにダイジェスト通知を送る。
 * 戻り値は検知件数と送信ユーザー数（cron のログ用）。
 */
export async function runScheduleWatch(): Promise<{ detected: number; notifiedUsers: number }> {
    // today は「JST日の印」（@db.Date の confirmDueDate や daysFromToday の比較用）、
    // todayStart は実時刻（時分秒を含む ProjectAssignment.date との範囲比較用）
    const today = toJstDateOnly(new Date());
    const todayStart = jstDayStartUtc(new Date());
    const floatingUntil = new Date(todayStart.getTime() + (FLOATING_AHEAD_DAYS + 1) * MS_PER_DAY);
    const floatingSince = new Date(todayStart.getTime() - FLOATING_BEHIND_DAYS * MS_PER_DAY);

    const [overdueTentative, floating] = await Promise.all([
        // 1) 確認漏れの仮予定（今後の配置のみ。浮きは 2) 側で統合して扱う）
        prisma.projectAssignment.findMany({
            where: {
                dateStatus: 'tentative',
                confirmDueDate: { lte: today },
                date: { gte: todayStart },
            },
            select: {
                id: true,
                date: true,
                confirmDueDate: true,
                assignedEmployeeId: true,
                projectMaster: { select: { name: true, title: true, createdBy: true } },
            },
        }),
        // 2) 期日接近＋当日超過の浮き
        prisma.projectAssignment.findMany({
            where: {
                assignedEmployeeId: 'unassigned',
                date: { gte: floatingSince, lt: floatingUntil },
            },
            select: {
                id: true,
                date: true,
                memberCount: true,
                dateStatus: true,
                confirmDueDate: true,
                projectMaster: { select: { name: true, title: true, createdBy: true } },
            },
            orderBy: { date: 'asc' },
        }),
    ]);

    const items: WatchItem[] = [];

    // 浮き（仮の浮きの確認漏れはここに統合＝1項目1通）
    for (const f of floating) {
        const site = siteOf(f.projectMaster);
        const diff = daysFromToday(f.date, today);
        const isTentative = f.dateStatus === 'tentative';
        const memberPart = `${f.memberCount ?? 0}人${isTentative ? '・日付も仮' : ''}`;
        const confirmOverdue =
            isTentative && f.confirmDueDate && toJstDateOnly(f.confirmDueDate).getTime() <= today.getTime();

        let text = `${formatJpShortDate(f.date)}の浮き「${site}」(${memberPart})が未解消です（${dueLabel(diff)}）`;
        if (confirmOverdue) {
            text += '。先方への日程確認も予定日を過ぎています';
        }
        items.push({
            assignmentId: f.id,
            kind: 'floating',
            text,
            assigneeIds: extractAssigneeIds(f.projectMaster?.createdBy ?? undefined),
        });
    }

    // 確認漏れの仮予定（浮きに統合済みの配置＝unassigned は上の where で既に除外されている）
    for (const t of overdueTentative) {
        const site = siteOf(t.projectMaster);
        items.push({
            assignmentId: t.id,
            kind: 'tentative-overdue',
            text: `「${site}」の仮予定(${formatJpShortDate(t.date)})、確認予定日(${t.confirmDueDate ? formatJpShortDate(t.confirmDueDate) : '-'})を過ぎています`,
            assigneeIds: extractAssigneeIds(t.projectMaster?.createdBy ?? undefined),
        });
    }

    if (items.length === 0) {
        return { detected: 0, notifiedUsers: 0 };
    }

    // 宛先解決: 浮きは案件担当者＋管理者、仮の確認漏れは案件担当者のみ
    const managers = await prisma.user.findMany({
        where: { isActive: true, role: { in: ['admin', 'manager', 'ADMIN', 'MANAGER'] } },
        select: { id: true },
    });
    const managerIds = managers.map((m) => m.id);

    const allAssigneeIds = new Set<string>();
    items.forEach((it) => it.assigneeIds.forEach((id) => allAssigneeIds.add(id)));
    const activeAssignees = allAssigneeIds.size
        ? await prisma.user.findMany({
              where: { id: { in: Array.from(allAssigneeIds) }, isActive: true },
              select: { id: true },
          })
        : [];
    const activeAssigneeSet = new Set(activeAssignees.map((u) => u.id));

    // ユーザーごとに担当項目を集める
    const itemsByUser = new Map<string, WatchItem[]>();
    const push = (userId: string, item: WatchItem) => {
        const arr = itemsByUser.get(userId);
        if (arr) {
            if (!arr.some((x) => x.assignmentId === item.assignmentId)) arr.push(item);
        } else {
            itemsByUser.set(userId, [item]);
        }
    };
    for (const item of items) {
        const assignees = item.assigneeIds.filter((id) => activeAssigneeSet.has(id));
        for (const id of assignees) push(id, item);
        if (item.kind === 'floating') {
            for (const id of managerIds) push(id, item);
        }
    }

    // 1ユーザー1通のダイジェスト（0件のユーザーには送らない）
    let notifiedUsers = 0;
    for (const [userId, userItems] of Array.from(itemsByUser.entries())) {
        const floatingCount = userItems.filter((i) => i.kind === 'floating').length;
        const tentativeCount = userItems.length - floatingCount;
        const summaryParts: string[] = [];
        if (floatingCount > 0) summaryParts.push(`浮き${floatingCount}件`);
        if (tentativeCount > 0) summaryParts.push(`確認漏れ${tentativeCount}件`);

        const shown = userItems.slice(0, MAX_BODY_ITEMS);
        const lines = shown.map((i) => `・${i.text}`);
        if (userItems.length > shown.length) {
            lines.push(`…ほか${userItems.length - shown.length}件`);
        }

        try {
            await notifyUsers({
                userIds: [userId],
                type: SCHEDULE_WATCH_TYPE,
                title: `朝の見張りまとめ（${summaryParts.join('・')}）`,
                body: lines.join('\n'),
                url: '/?page=schedule&view=assignment',
                // 同日再実行しても端末上の push は1つに上書きされる
                pushTag: 'schedule-watch',
                data: {
                    kind: 'schedule-watch',
                    assignmentIds: userItems.map((i) => i.assignmentId),
                },
            });
            notifiedUsers += 1;
        } catch (e) {
            logger.error(`[scheduleWatch] 通知送信に失敗 (userId=${userId})`, e);
        }
    }

    return { detected: items.length, notifiedUsers };
}
