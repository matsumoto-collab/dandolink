const CACHE_NAME = 'dandolink-v1';
const OFFLINE_URL = '/offline.html';

// インストール時にオフラインページをキャッシュ
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
    );
    self.skipWaiting();
});

// アクティベーション時に古いキャッシュを削除
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// ナビゲーション失敗時にオフラインページを返す
self.addEventListener('fetch', (event) => {
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(OFFLINE_URL))
        );
    }
});
