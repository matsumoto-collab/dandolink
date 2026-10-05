/**
 * 評価ポイント「ありがとう」: DB を読む・書く側の共通部品（API の route から呼ぶ）。
 *
 * 決まりごと（だれが何をできるか）は lib/evaluationThanks.ts に書いてある。ここで書き直さない。
 * 「ありがとう」の2つの表（evaluationPointThanks・evaluationPointThanksSetting）に書くのは、このファイルの関数だけ。
 * route は直接書かない。
 *
 * 書く関数は、どれも「トランザクションを開く → 読む → 決まりで確かめる → 書く → 同じトランザクションで EvaluationPointLog を書く」。
 * 送るときだけ、最初に「送る人ごとの鍵」を取る（連打・二重送信で 1日3回を超えないため）。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateKeyToDate, dateToDateKey, todayJstDateKey } from '@/lib/evaluationPoints';
import type { PointActor } from '@/lib/evaluationPointsServer';
import { UNKNOWN_USER_NAME, compareUsers, loadUserNames, type Period } from '@/lib/evaluationPointsReport';
import {
    THANKS_MESSAGES,
    THANKS_SETTING_ID,
    canRemoveThanks,
    canUseThanks,
    decideSendThanks,
    remainingThanksToday,
} from '@/lib/evaluationThanks';

type Db = Prisma.TransactionClient;

/** 設定の行の id（定義は lib/evaluationThanks.ts。ここから読んでいる所のために、同じ値を出しておく） */
export { THANKS_SETTING_ID };

/** 「ありがとう」の書き込みのトランザクションの設定（鍵が空くのを待つ時間も入るので、Prisma の既定より長く） */
export const THANKS_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * 送る人ごとの鍵（トランザクションが終わると自動で外れる）。
 * 同じ人の「送る」を1つずつ順番に行わせる（今日送った数を読んでから書くまでのあいだに、別の送信が割り込まない）。
 */
export async function lockThanksSender(tx: Db, senderId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'dandolink-thanks:' + senderId}))`;
}

/** Prisma の一意の制約に当たったエラーか（同じ人から同じ人へ、同じ日に2行目を入れようとした） */
function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 今日（日本時間）の 'YYYY-MM-DD' と、@db.Date の列に入れる Date（UTC 0時の印） */
function today(): { key: string; date: Date } {
    const key = todayJstDateKey();
    const date = dateKeyToDate(key);
    if (!date) throw new Error(`evaluationThanksServer: 今日の日付が作れません: ${key}`);
    return { key, date };
}

// ---------------------------------------------------------------- 設定

export interface ThanksSettingValue {
    /** true = 使う（送れる） */
    isActive: boolean;
    /** 1回あたりの点数 */
    pointsPerThanks: number;
}

const DEFAULT_SETTING: ThanksSettingValue = { isActive: false, pointsPerThanks: 1 };

async function readSetting(db: Db): Promise<{ exists: boolean; value: ThanksSettingValue }> {
    const row = await db.evaluationPointThanksSetting.findUnique({
        where: { id: THANKS_SETTING_ID },
        select: { isActive: true, pointsPerThanks: true },
    });
    if (!row) return { exists: false, value: { ...DEFAULT_SETTING } };
    return { exists: true, value: { isActive: row.isActive === true, pointsPerThanks: row.pointsPerThanks } };
}

/** 設定を返す。行が無ければ「使わない・1回 1点」（送れてしまう側には倒さない） */
export async function getThanksSetting(): Promise<ThanksSettingValue> {
    return (await readSetting(prisma)).value;
}

export interface UpdateThanksSettingParams {
    actor: PointActor;
    isActive?: boolean;
    pointsPerThanks?: number;
}

/**
 * 設定を保存する。値の形（真偽値・0〜9999 の整数）は、呼ぶ側（route）が先に確かめる。
 * 変わった項目だけを、同じトランザクションで EvaluationPointLog（thanks_setting_updated）に残す。
 * 行があって何も変わらなければ、何も書かない。
 */
export async function updateThanksSetting(params: UpdateThanksSettingParams): Promise<ThanksSettingValue> {
    const { actor } = params;
    return prisma.$transaction(async (tx) => {
        const { exists, value: before } = await readSetting(tx);
        const after: ThanksSettingValue = {
            isActive: params.isActive ?? before.isActive,
            pointsPerThanks: params.pointsPerThanks ?? before.pointsPerThanks,
        };
        const changedBefore: Partial<ThanksSettingValue> = {};
        const changedAfter: Partial<ThanksSettingValue> = {};
        if (before.isActive !== after.isActive) {
            changedBefore.isActive = before.isActive;
            changedAfter.isActive = after.isActive;
        }
        if (before.pointsPerThanks !== after.pointsPerThanks) {
            changedBefore.pointsPerThanks = before.pointsPerThanks;
            changedAfter.pointsPerThanks = after.pointsPerThanks;
        }
        const changed = Object.keys(changedAfter).length > 0;
        if (exists && !changed) return before;

        await tx.evaluationPointThanksSetting.upsert({
            where: { id: THANKS_SETTING_ID },
            create: { id: THANKS_SETTING_ID, ...after, updatedBy: actor.id },
            update: { ...after, updatedBy: actor.id },
            select: { id: true },
        });
        if (changed) {
            await tx.evaluationPointLog.create({
                data: {
                    action: 'thanks_setting_updated',
                    actorId: actor.id,
                    actorName: actor.name,
                    detail: { before: changedBefore, after: changedAfter },
                },
            });
        }
        return after;
    }, THANKS_TX_OPTIONS);
}

// ---------------------------------------------------------------- 送る

export interface SendThanksParams {
    /** 送る人。必ずセッションから作ったもの（actorOf(session)） */
    actor: PointActor;
    toUserId: string;
    /** normalizeThanksMessage() を通したあとの値 */
    message: string | null;
}

export type SendThanksResult =
    | {
        ok: true;
        thanks: { id: string; date: string; toUserId: string; toUserName: string; message: string | null };
        remainingToday: number;
    }
    | { ok: false; status: 400 | 403; message: string };

/**
 * 「ありがとう」を1件送る。日付は今日（日本時間）、点数は今の設定の「1回あたりの点数」の写し。
 * 鍵 → 設定・相手・今日送った分を読む → decideSendThanks → 作る → 同じトランザクションでログ。
 * 断るときは何も書かない。一意の制約に当たったとき（同時の二重送信）は「今日は、もうこの人に送っています」。
 */
export async function sendThanks(params: SendThanksParams): Promise<SendThanksResult> {
    const { actor, toUserId, message } = params;
    const { key: todayKey, date: day } = today();

    try {
        return await prisma.$transaction(async (tx): Promise<SendThanksResult> => {
            await lockThanksSender(tx, actor.id);

            const { value: setting } = await readSetting(tx);
            const to = await tx.user.findUnique({
                where: { id: toUserId },
                select: { id: true, displayName: true, role: true, isActive: true },
            });
            const sentToday = await tx.evaluationPointThanks.findMany({
                where: { fromUserId: actor.id, date: day },
                select: { toUserId: true },
            });
            const sentTodayToIds = sentToday.map((r) => r.toUserId);

            const decision = decideSendThanks({
                active: setting.isActive,
                fromId: actor.id,
                fromRole: actor.role,
                to: to ? { id: to.id, role: to.role, isActive: to.isActive } : null,
                sentTodayToIds,
            });
            if (!decision.ok) return decision;

            const created = await tx.evaluationPointThanks.create({
                data: {
                    fromUserId: actor.id,
                    toUserId,
                    date: day,
                    message,
                    points: setting.pointsPerThanks,
                },
            });
            await tx.evaluationPointLog.create({
                data: {
                    action: 'thanks_sent',
                    actorId: actor.id,
                    actorName: actor.name,
                    targetUserId: toUserId,
                    recordId: created.id,
                    recordDate: created.date,
                    detail: { points: created.points },
                },
            });
            return {
                ok: true,
                thanks: {
                    id: created.id,
                    date: todayKey,
                    toUserId: created.toUserId,
                    toUserName: to?.displayName ?? UNKNOWN_USER_NAME,
                    message: created.message,
                },
                remainingToday: remainingThanksToday(sentTodayToIds.length + 1),
            };
        }, THANKS_TX_OPTIONS);
    } catch (err) {
        // トランザクションの中で一意の制約に当たると、そのトランザクションは使えなくなるので、外で受けて 400 にする
        if (isUniqueViolation(err)) return { ok: false, status: 400, message: THANKS_MESSAGES.alreadySentToday };
        throw err;
    }
}

// ---------------------------------------------------------------- 取り消す

export type RemoveThanksResult = { ok: true } | { ok: false; reason: 'not_found' | 'forbidden' };

/**
 * 「ありがとう」を1件取り消す。取り消してよいかは canRemoveThanks()。
 * 実際に消えたとき（deleteMany の件数が 1）だけ、消した行の全部の列をログ（thanks_removed）に残す。
 * 読んだあとで、ほかの人が先に消していたときは「見つからない」にする。
 */
export async function removeThanks(params: { actor: PointActor; id: string }): Promise<RemoveThanksResult> {
    const { actor, id } = params;
    return prisma.$transaction(async (tx): Promise<RemoveThanksResult> => {
        const existing = await tx.evaluationPointThanks.findUnique({ where: { id } });
        if (!existing) return { ok: false, reason: 'not_found' };

        const dateKey = dateToDateKey(existing.date);
        if (!canRemoveThanks(actor, { fromUserId: existing.fromUserId, dateKey }, todayJstDateKey())) {
            return { ok: false, reason: 'forbidden' };
        }

        const deleted = await tx.evaluationPointThanks.deleteMany({ where: { id } });
        if (deleted.count !== 1) return { ok: false, reason: 'not_found' };

        await tx.evaluationPointLog.create({
            data: {
                action: 'thanks_removed',
                actorId: actor.id,
                actorName: actor.name,
                targetUserId: existing.toUserId,
                recordId: existing.id,
                recordDate: existing.date,
                detail: {
                    id: existing.id,
                    fromUserId: existing.fromUserId,
                    toUserId: existing.toUserId,
                    date: dateKey,
                    message: existing.message,
                    points: existing.points,
                    createdAt: existing.createdAt.toISOString(),
                },
            },
        });
        return { ok: true };
    }, THANKS_TX_OPTIONS);
}

// ---------------------------------------------------------------- 読む

export interface ThanksSendContext {
    /** 設定が「使う」か */
    active: boolean;
    remainingToday: number;
    /** 今日（日本時間）もう送った相手 */
    sentTodayToIds: string[];
    /** 送れる相手（在籍していて対象のロールの人。自分は除く）。「使わない」のあいだは空 */
    recipients: { userId: string; displayName: string }[];
}

/**
 * 送る画面に出す材料。setting を渡せば、設定を読み直さない（呼ぶ側が先に読んでいるとき用）。
 */
export async function loadThanksSendContext(userId: string, setting?: ThanksSettingValue): Promise<ThanksSendContext> {
    const { date: day } = today();
    const [current, sentToday] = await Promise.all([
        setting ? Promise.resolve(setting) : getThanksSetting(),
        prisma.evaluationPointThanks.findMany({
            where: { fromUserId: userId, date: day },
            select: { toUserId: true },
        }),
    ]);
    const sentTodayToIds = sentToday.map((r) => r.toUserId);

    let recipients: ThanksSendContext['recipients'] = [];
    if (current.isActive) {
        // ロールは DB の値（大文字が混ざる）なので、where に書かず、読んだあとで判定の関数で絞る
        const users = await prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, displayName: true, role: true, dispatchSortOrder: true },
        });
        recipients = users
            .filter((u) => u.id !== userId && canUseThanks(u.role))
            .sort(compareUsers)
            .map((u) => ({ userId: u.id, displayName: u.displayName }));
    }

    return {
        active: current.isActive,
        remainingToday: remainingThanksToday(sentTodayToIds.length),
        sentTodayToIds,
        recipients,
    };
}

export interface MyThanksReceived {
    id: string;
    date: string;
    fromUserName: string;
    message: string | null;
    /** showPoints が false なら null */
    points: number | null;
}

export interface MyThanksSent {
    id: string;
    date: string;
    toUserId: string;
    toUserName: string;
    message: string | null;
    canRemove: boolean;
}

export interface MyThanks {
    receivedCount: number;
    /** showPoints が false なら null */
    receivedPoints: number | null;
    /** 日付の新しい順（同じ日は送った日時の新しい順） */
    received: MyThanksReceived[];
    sent: MyThanksSent[];
}

/**
 * 本人の「もらった」「送った」。userId は必ずセッションの id を渡す。
 * role は「送った」の取り消しボタン（canRemove）を決めるのに使う（管理者・マネージャーは、前の日の分も取り消せる）。
 */
export async function loadMyThanks(params: {
    userId: string;
    role: string | null | undefined;
    period: Period;
    showPoints: boolean;
}): Promise<MyThanks> {
    const { userId, role, period, showPoints } = params;
    const select = { id: true, fromUserId: true, toUserId: true, date: true, message: true, points: true } as const;
    const orderBy = [{ date: 'desc' as const }, { createdAt: 'desc' as const }];
    const [receivedRows, sentRows] = await Promise.all([
        prisma.evaluationPointThanks.findMany({ where: { toUserId: userId, date: period.range }, orderBy, select }),
        prisma.evaluationPointThanks.findMany({ where: { fromUserId: userId, date: period.range }, orderBy, select }),
    ]);
    const names = await loadUserNames([...receivedRows.map((r) => r.fromUserId), ...sentRows.map((r) => r.toUserId)]);
    const todayKey = todayJstDateKey();
    const operator = { id: userId, role };

    return {
        receivedCount: receivedRows.length,
        receivedPoints: showPoints ? receivedRows.reduce((sum, r) => sum + r.points, 0) : null,
        received: receivedRows.map((r) => ({
            id: r.id,
            date: dateToDateKey(r.date),
            fromUserName: names.get(r.fromUserId) ?? UNKNOWN_USER_NAME,
            message: r.message,
            points: showPoints ? r.points : null,
        })),
        sent: sentRows.map((r) => {
            const date = dateToDateKey(r.date);
            return {
                id: r.id,
                date,
                toUserId: r.toUserId,
                toUserName: names.get(r.toUserId) ?? UNKNOWN_USER_NAME,
                message: r.message,
                canRemove: canRemoveThanks(operator, { fromUserId: r.fromUserId, dateKey: date }, todayKey),
            };
        }),
    };
}

export interface ThanksListRow {
    id: string;
    date: string;
    fromUserId: string;
    fromUserName: string;
    toUserId: string;
    toUserName: string;
    message: string | null;
    points: number;
    createdAt: string;
}

/** 期間の全員分（管理者・マネージャー用）。日付の新しい順 → 送った日時の新しい順 */
export async function loadThanksList(period: Period): Promise<ThanksListRow[]> {
    const rows = await prisma.evaluationPointThanks.findMany({
        where: { date: period.range },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, fromUserId: true, toUserId: true, date: true, message: true, points: true, createdAt: true },
    });
    const names = await loadUserNames(rows.flatMap((r) => [r.fromUserId, r.toUserId]));
    return rows.map((r) => ({
        id: r.id,
        date: dateToDateKey(r.date),
        fromUserId: r.fromUserId,
        fromUserName: names.get(r.fromUserId) ?? UNKNOWN_USER_NAME,
        toUserId: r.toUserId,
        toUserName: names.get(r.toUserId) ?? UNKNOWN_USER_NAME,
        message: r.message,
        points: r.points,
        createdAt: r.createdAt.toISOString(),
    }));
}
