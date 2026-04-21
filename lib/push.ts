import webpush from 'web-push';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

let vapidConfigured = false;

function ensureVapidConfigured() {
    if (vapidConfigured) return true;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
        logger.warn('[Push] VAPID keys not configured. Push notifications disabled.');
        return false;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
}

export interface PushPayload {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    icon?: string;
    badge?: string;
    requireInteraction?: boolean;
    data?: Record<string, unknown>;
}

/**
 * 指定ユーザー群（userIds）の全端末に通知を送信する。
 * 410 Gone / 404 が返ってきた購読は自動削除する。
 * 冪等: 同じpayload.tagを指定すれば端末側で上書き表示される。
 */
export async function sendPushToUsers(
    userIds: string[],
    payload: PushPayload
): Promise<{ sent: number; removed: number; failed: number }> {
    if (!ensureVapidConfigured() || userIds.length === 0) {
        return { sent: 0, removed: 0, failed: 0 };
    }

    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    const subs = await prisma.pushSubscription.findMany({
        where: { userId: { in: uniqueUserIds } },
    });

    if (subs.length === 0) {
        return { sent: 0, removed: 0, failed: 0 };
    }

    const jsonPayload = JSON.stringify(payload);
    let sent = 0;
    let removed = 0;
    let failed = 0;
    const staleEndpoints: string[] = [];

    await Promise.all(
        subs.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    {
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth },
                    },
                    jsonPayload
                );
                sent += 1;
            } catch (err: unknown) {
                const statusCode = (err as { statusCode?: number })?.statusCode;
                if (statusCode === 404 || statusCode === 410) {
                    staleEndpoints.push(sub.endpoint);
                } else {
                    failed += 1;
                    logger.error('[Push] send failed', {
                        endpoint: sub.endpoint.substring(0, 50),
                        statusCode,
                        message: (err as Error)?.message,
                    });
                }
            }
        })
    );

    if (staleEndpoints.length > 0) {
        const del = await prisma.pushSubscription.deleteMany({
            where: { endpoint: { in: staleEndpoints } },
        });
        removed = del.count;
    }

    return { sent, removed, failed };
}
