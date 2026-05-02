'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/logger';

/**
 * ログイン中ユーザーの既存プッシュ購読を /api/push/subscribe に再送し、
 * Server側 PushSubscription.userId を現在のログインユーザーに同期する。
 *
 * 背景: 同一端末で別アカウントに切替えた場合、ServiceWorker の既存
 * subscription は維持されるが、DB上の userId は前ユーザーのまま残る。
 * 結果として「自分宛でない通知が届くが、通知履歴には表示されない」状態に。
 * このコンポーネントがログイン直後にエンドポイントを再upsertしてその不整合を解消する。
 */
export default function PushSubscriptionSync() {
    const { data: session, status } = useSession();
    const userId = session?.user?.id;

    useEffect(() => {
        if (status !== 'authenticated' || !userId) return;
        if (typeof window === 'undefined') return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        let cancelled = false;
        (async () => {
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (!sub || cancelled) return;
                const json = sub.toJSON() as PushSubscriptionJSON;
                if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
                await fetch('/api/push/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subscription: {
                            endpoint: json.endpoint,
                            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
                        },
                    }),
                });
            } catch (e) {
                logger.error('[PushSync] failed', e);
            }
        })();
        return () => { cancelled = true; };
    }, [status, userId]);

    return null;
}
