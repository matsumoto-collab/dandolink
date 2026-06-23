import { prisma } from '@/lib/prisma';
import { notifyUsers } from '@/lib/notifications';
import { toJstDateOnly } from '@/lib/dateUtils';
import { logger } from '@/lib/logger';

/**
 * 週間カレンダーの予定(ProjectAssignment)が変更されたとき、担当職長へ即時通知するヘルパー。
 *
 * 設計方針:
 *  - 変更が起きる各APIルートからその場で呼ぶ（変更履歴テーブルを後から読まない）。
 *  - 宛先は assignment.assignedEmployeeId（= 担当職長の User.id）1人。
 *  - 「今日〜7日後(JST)」の予定変更のみ通知。移動は移動元/移動先どちらかが窓内なら通知。
 *  - 操作者本人（actorUserId === foremanId）には通知しない（自分の操作で自分に🔔を出さない）。
 *  - 退職者/孤児ID（User不在 or isActive=false）はスキップ。
 *  - best-effort: 通知の失敗は本処理（更新/削除）に影響させない（内部で握りつぶす）。
 */

export const SCHEDULE_CHANGED_TYPE = 'schedule-changed';
/** 通知対象とする営業日数（日曜を除く）。今日を含め向こう4営業日（日曜を挟むと暦日では5日先まで）。 */
const NOTIFY_BUSINESS_DAYS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ScheduleChangeKind =
    | 'moved'
    | 'reassigned-in'
    | 'reassigned-out'
    | 'deleted'
    | 'created';

export interface BuildMessageInput {
    kind: ScheduleChangeKind;
    siteName: string;
    suffix?: string | null;
    /** moved の旧日付 / created集約の最小日 */
    fromDate?: Date | null;
    /** moved/reassigned/deleted/created の対象日 / created集約の最大日 */
    toDate?: Date | null;
    /** reassigned-out で「→ 誰へ移ったか」を載せる新職長名 */
    otherForemanName?: string | null;
    /** created の集約件数（>1 で範囲表記） */
    createdCount?: number;
}

export interface CreatedItem {
    assignmentId: string;
    foremanId: string;
    projectMasterId: string;
    date: Date;
}

type PmLite = { name: string | null; title: string; constructionSuffixId: string | null };

// ───────────────────────── 純関数（テスト対象） ─────────────────────────

/** Date/ISO文字列/数値を安全に Date へ正規化（無効値は null）。 */
function toValidDate(value: Date): Date | null {
    const d = value instanceof Date ? value : new Date(value as unknown as string | number);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** JST で日付キー (YYYY-MM-DD)。サーバTZ非依存。無効値は空文字。 */
export function dateKeyJst(date: Date): string {
    const d = toValidDate(date);
    if (!d) return '';
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Tokyo',
    }).format(d);
}

/** JST で日本語短表記 (M/D(曜))。 */
export function formatJpShortDate(date: Date): string {
    const d = toValidDate(date);
    if (!d) return '';
    return new Intl.DateTimeFormat('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'Asia/Tokyo',
    }).format(d);
}

/**
 * now(JST起点)から、日曜を除いて NOTIFY_BUSINESS_DAYS 営業日分の JST日キー集合を返す。
 * 例) 金曜起点 → {金, 土, 月, 火}（日曜を飛ばすので暦日では火曜=5日先まで）。
 * 起点が日曜なら起点は含めず翌日以降から数える。
 */
export function notifyWindowKeys(now: Date = new Date()): Set<string> {
    const keys = new Set<string>();
    let cursor = toJstDateOnly(now);
    let collected = 0;
    let guard = 0;
    while (collected < NOTIFY_BUSINESS_DAYS && guard < 14) {
        guard += 1;
        // toJstDateOnly は JST日の UTC 0時。getUTCDay() が JST の曜日（0=日曜）。
        if (cursor.getUTCDay() !== 0) {
            keys.add(dateKeyJst(cursor));
            collected += 1;
        }
        cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
    return keys;
}

/**
 * 通知すべき日付窓（日曜を除く、今日を含む向こう4営業日・JST）に入っているか。
 * moved は from/to どちらかが窓内なら true。新規/削除は同一日を両方に渡す。
 * 日曜は窓に含まれないため、日曜の予定は通知対象外。
 */
export function isWithinNotifyWindow(
    fromDate: Date | null | undefined,
    toDate: Date | null | undefined,
    now: Date = new Date(),
): boolean {
    const keys = notifyWindowKeys(now);
    const inWindow = (d: Date | null | undefined): boolean => {
        if (!d) return false;
        const k = dateKeyJst(d);
        return k !== '' && keys.has(k);
    };
    return inWindow(fromDate) || inWindow(toDate);
}

/** 通知の件名・本文を組み立てる（純関数）。 */
export function buildScheduleChangeMessage(input: BuildMessageInput): { title: string; body: string } {
    const site = input.suffix ? `${input.siteName}（${input.suffix}）` : input.siteName;
    const fmt = (d?: Date | null) => (d ? formatJpShortDate(d) : '');

    switch (input.kind) {
        case 'moved':
            return {
                title: `【予定変更】${site}`,
                body: `日程変更: ${fmt(input.fromDate)} → ${fmt(input.toDate)}`,
            };
        case 'reassigned-in':
            return {
                title: `【担当変更】${site}`,
                body: `あなたの担当になりました（${fmt(input.toDate)}）`,
            };
        case 'reassigned-out':
            return {
                title: `【担当変更】${site}`,
                body: `担当から外れました（${fmt(input.toDate)}${input.otherForemanName ? ` → ${input.otherForemanName}` : ''}）`,
            };
        case 'deleted':
            return {
                title: `【予定削除】${site}`,
                body: `${fmt(input.toDate)} の予定が削除されました`,
            };
        case 'created': {
            const count = input.createdCount ?? 1;
            if (count > 1) {
                return {
                    title: `【新規予定】${site} ほか`,
                    body: `${fmt(input.fromDate)}〜${fmt(input.toDate)} に ${count}件の予定が追加されました`,
                };
            }
            return {
                title: `【新規予定】${site}`,
                body: `${fmt(input.toDate)} に予定が追加されました`,
            };
        }
        default: {
            const _exhaustive: never = input.kind;
            throw new Error(`unknown schedule change kind: ${String(_exhaustive)}`);
        }
    }
}

// ───────────────────────── 副作用（各APIルートが呼ぶ） ─────────────────────────

async function resolveSite(
    projectMasterId: string,
    pm?: PmLite | null,
): Promise<{ siteName: string; suffix: string | null }> {
    let p: PmLite | null = pm ?? null;
    if (!p) {
        p = await prisma.projectMaster.findUnique({
            where: { id: projectMasterId },
            select: { name: true, title: true, constructionSuffixId: true },
        });
    }
    const siteName = p?.name || p?.title || '案件';
    let suffix: string | null = null;
    if (p?.constructionSuffixId) {
        const cs = await prisma.constructionSuffix.findUnique({
            where: { id: p.constructionSuffixId },
            select: { name: true },
        });
        suffix = cs?.name ?? null;
    }
    return { siteName, suffix };
}

async function dispatch(opts: {
    actorUserId: string;
    foremanId: string;
    windowFrom: Date | null;
    windowTo: Date | null;
    projectMasterId: string;
    projectMaster?: PmLite | null;
    message: Omit<BuildMessageInput, 'siteName' | 'suffix'>;
    pushTag: string;
    data?: Record<string, unknown>;
}): Promise<void> {
    try {
        // 1. 自己除外（自分の操作で自分に通知しない）
        if (opts.actorUserId && opts.actorUserId === opts.foremanId) return;
        // 2. 窓判定（今日〜7日後JST）
        if (!isWithinNotifyWindow(opts.windowFrom, opts.windowTo)) return;
        // 3. 職長の存在＆有効性（孤児ID/退職者はスキップ。FK制約が無いため必須）
        const user = await prisma.user.findUnique({
            where: { id: opts.foremanId },
            select: { id: true, isActive: true },
        });
        if (!user || user.isActive === false) return;
        // 4. 現場名の解決（呼び出し側が pm を持っていれば再クエリしない）
        const { siteName, suffix } = await resolveSite(opts.projectMasterId, opts.projectMaster);
        // 5. 文面
        const { title, body } = buildScheduleChangeMessage({ ...opts.message, siteName, suffix });
        // 6. 送信（アプリ内🔔 + Web Push）。scope 絞り込みを避けるため projectMasterId は渡さない。
        await notifyUsers({
            userIds: [opts.foremanId],
            type: SCHEDULE_CHANGED_TYPE,
            title,
            body,
            url: '/?page=schedule&view=assignment',
            pushTag: opts.pushTag,
            data: opts.data,
        });
    } catch (e) {
        logger.error('[scheduleChangeNotify] 通知に失敗（処理は継続）', e);
    }
}

/** ① 日付移動 */
export async function notifyAssignmentMoved(p: {
    actorUserId: string;
    assignmentId: string;
    foremanId: string;
    fromDate: Date;
    toDate: Date;
    projectMasterId: string;
    projectMaster?: PmLite | null;
}): Promise<void> {
    // 同一JST日（時刻だけの変更）は「移動」として通知しない
    if (dateKeyJst(p.fromDate) === dateKeyJst(p.toDate)) return;
    await dispatch({
        actorUserId: p.actorUserId,
        foremanId: p.foremanId,
        windowFrom: p.fromDate,
        windowTo: p.toDate,
        projectMasterId: p.projectMasterId,
        projectMaster: p.projectMaster,
        message: { kind: 'moved', fromDate: p.fromDate, toDate: p.toDate },
        pushTag: `schedule-${p.assignmentId}`,
        data: { assignmentId: p.assignmentId, kind: 'moved' },
    });
}

/** ② 担当職長変更（旧職長へ「外れた」＋新職長へ「担当に」を別々に送る） */
export async function notifyAssignmentReassigned(p: {
    actorUserId: string;
    assignmentId: string;
    fromForemanId: string;
    toForemanId: string;
    date: Date;
    projectMasterId: string;
    projectMaster?: PmLite | null;
}): Promise<void> {
    // 新職長宛
    await dispatch({
        actorUserId: p.actorUserId,
        foremanId: p.toForemanId,
        windowFrom: p.date,
        windowTo: p.date,
        projectMasterId: p.projectMasterId,
        projectMaster: p.projectMaster,
        message: { kind: 'reassigned-in', toDate: p.date },
        pushTag: `schedule-${p.assignmentId}`,
        data: { assignmentId: p.assignmentId, kind: 'reassigned-in' },
    });

    // 旧職長宛（誰に移ったかを併記するため新職長名を解決）
    let otherName: string | null = null;
    try {
        const u = await prisma.user.findUnique({
            where: { id: p.toForemanId },
            select: { displayName: true },
        });
        otherName = u?.displayName ?? null;
    } catch {
        // best-effort（名前が引けなくても通知は出す）
    }
    await dispatch({
        actorUserId: p.actorUserId,
        foremanId: p.fromForemanId,
        windowFrom: p.date,
        windowTo: p.date,
        projectMasterId: p.projectMasterId,
        projectMaster: p.projectMaster,
        message: { kind: 'reassigned-out', toDate: p.date, otherForemanName: otherName },
        pushTag: `schedule-${p.assignmentId}`,
        data: { assignmentId: p.assignmentId, kind: 'reassigned-out' },
    });
}

/** ③ 削除 */
export async function notifyAssignmentDeleted(p: {
    actorUserId: string;
    assignmentId: string;
    foremanId: string;
    date: Date;
    projectMasterId: string;
    projectMaster?: PmLite | null;
}): Promise<void> {
    await dispatch({
        actorUserId: p.actorUserId,
        foremanId: p.foremanId,
        windowFrom: p.date,
        windowTo: p.date,
        projectMasterId: p.projectMasterId,
        projectMaster: p.projectMaster,
        message: { kind: 'deleted', toDate: p.date },
        pushTag: `schedule-del-${p.assignmentId}`,
        data: { assignmentId: p.assignmentId, kind: 'deleted' },
    });
}

/** ④ 新規追加（同一職長は1通に集約） */
export async function notifyAssignmentsCreated(p: {
    actorUserId: string;
    items: CreatedItem[];
}): Promise<void> {
    // 窓内のみ
    const inWindow = p.items.filter((it) => isWithinNotifyWindow(it.date, it.date));
    if (inWindow.length === 0) return;

    // 職長単位でグループ化（同一職長への複数件は1通にまとめる）
    const byForeman = new Map<string, CreatedItem[]>();
    for (const it of inWindow) {
        const arr = byForeman.get(it.foremanId);
        if (arr) arr.push(it);
        else byForeman.set(it.foremanId, [it]);
    }

    for (const items of Array.from(byForeman.values())) {
        const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
        const minDate = sorted[0].date;
        const maxDate = sorted[sorted.length - 1].date;
        const rep = sorted[0];
        await dispatch({
            actorUserId: p.actorUserId,
            foremanId: rep.foremanId,
            windowFrom: minDate,
            windowTo: maxDate,
            projectMasterId: rep.projectMasterId,
            projectMaster: null,
            message: {
                kind: 'created',
                fromDate: minDate,
                toDate: maxDate,
                createdCount: items.length,
            },
            pushTag: `schedule-create-${rep.foremanId}-${dateKeyJst(minDate)}`,
            data: { kind: 'created', assignmentIds: items.map((it) => it.assignmentId) },
        });
    }
}
