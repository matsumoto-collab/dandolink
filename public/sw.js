const CACHE_NAME = 'dandlink-v3';
const STATIC_CACHE_NAME = 'dandlink-static-v1';
const OFFLINE_URL = '/offline.html';

// インストール時にオフラインページとPDF workerをキャッシュ
self.addEventListener('install', (event) => {
    event.waitUntil(
        Promise.all([
            caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)),
            caches.open(STATIC_CACHE_NAME).then((cache) => cache.add('/pdf.worker.min.mjs')),
        ])
    );
    self.skipWaiting();
});

// アクティベーション時に古いキャッシュを削除
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE_NAME).map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // PDF worker: Cache First（1MBの静的ファイルを毎回DLしない）
    if (event.request.url.includes('/pdf.worker.min.mjs')) {
        event.respondWith(
            caches.open(STATIC_CACHE_NAME).then((cache) =>
                cache.match(event.request).then((cached) => {
                    if (cached) return cached;
                    return fetch(event.request).then((response) => {
                        cache.put(event.request, response.clone());
                        return response;
                    });
                })
            )
        );
        return;
    }

    // ナビゲーション失敗時にオフラインページを返す
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(OFFLINE_URL))
        );
    }
});

// アプリアイコンの未読バッジを最新化（PWA Badging API）
// 非対応ブラウザでは silently no-op
async function refreshAppBadge() {
    if (!('setAppBadge' in self.registration) && !('setAppBadge' in self.navigator)) {
        return;
    }
    try {
        const res = await fetch('/api/notifications/unread-count', {
            credentials: 'include',
            cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json();
        const count = Number(json && json.count) || 0;
        if (count > 0) {
            if (self.registration.setAppBadge) {
                await self.registration.setAppBadge(count);
            } else if (self.navigator.setAppBadge) {
                await self.navigator.setAppBadge(count);
            }
        } else {
            if (self.registration.clearAppBadge) {
                await self.registration.clearAppBadge();
            } else if (self.navigator.clearAppBadge) {
                await self.navigator.clearAppBadge();
            }
        }
    } catch (e) {
        // ignore: ログイン切れ・オフライン等
    }
}

// Web Push: プッシュ受信時に通知を表示
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (e) {
        payload = { title: 'DandoLink', body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'DandoLink';
    const options = {
        body: payload.body || '',
        icon: payload.icon || '/icon-192.png',
        badge: payload.badge || '/icon-192.png',
        tag: payload.tag || undefined,
        data: {
            url: payload.url || '/',
            ...(payload.data || {}),
        },
        requireInteraction: payload.requireInteraction || false,
    };

    event.waitUntil(
        Promise.all([
            self.registration.showNotification(title, options),
            refreshAppBadge(),
        ])
    );
});

// 通知タップ時: 既存タブにフォーカス、なければ新規オープン
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                try {
                    const clientUrl = new URL(client.url);
                    const targetAbsolute = new URL(targetUrl, self.location.origin);
                    if (clientUrl.origin === targetAbsolute.origin && 'focus' in client) {
                        client.navigate(targetAbsolute.href).catch(() => {});
                        return client.focus();
                    }
                } catch (e) {
                    // ignore
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
