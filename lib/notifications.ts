import { prisma } from '@/lib/prisma';
import { sendPushToUsers, type PushPayload } from '@/lib/push';
import { logger } from '@/lib/logger';

export interface NotifyInput {
    userIds: string[];
    type?: string;
    title: string;
    body: string;
    url?: string;
    data?: Record<string, unknown>;
    /**
     * プッシュ通知のtag（同一tagは端末上で上書き表示される）。
     * 省略時はtypeをフォールバック値として使う。
     */
    pushTag?: string;
    /** pushのrequireInteraction */
    requireInteraction?: boolean;
}

export interface NotifyResult {
    notificationIds: string[];
    push: { sent: number; removed: number; failed: number };
}

/**
 * ユーザー群へ通知を送る統一ヘルパー。
 * - DB（Notification）に履歴を残す（ヘッダーの🔔で参照）
 * - Web Push を送る（端末OSの通知領域に表示）
 * どちらかが失敗してももう片方は可能な限り継続する。
 */
export async function notifyUsers(input: NotifyInput): Promise<NotifyResult> {
    const uniqueUserIds = Array.from(new Set(input.userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
        return { notificationIds: [], push: { sent: 0, removed: 0, failed: 0 } };
    }

    const type = input.type || 'general';
    const now = new Date();

    // DBレコード作成（同一payloadで各ユーザー分）
    let notificationIds: string[] = [];
    try {
        const created = await prisma.$transaction(
            uniqueUserIds.map((userId) =>
                prisma.notification.create({
                    data: {
                        userId,
                        type,
                        title: input.title,
                        body: input.body,
                        url: input.url,
                        data: (input.data as object | undefined) ?? undefined,
                        createdAt: now,
                    },
                    select: { id: true },
                })
            )
        );
        notificationIds = created.map((n) => n.id);
    } catch (e) {
        logger.error('[Notify] DB insert failed', e);
    }

    // Web Push送信
    const pushPayload: PushPayload = {
        title: input.title,
        body: input.body,
        url: input.url || '/',
        tag: input.pushTag || type,
        requireInteraction: input.requireInteraction,
        data: { type, ...(input.data || {}) },
    };
    const push = await sendPushToUsers(uniqueUserIds, pushPayload);

    return { notificationIds, push };
}
