const CACHE_NAME = 'dandlink-v2';
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
