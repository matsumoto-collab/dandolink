# PWA 対応実装計画（v2 — フィードバック反映済み）

DandoLink を PWA（Progressive Web App）対応にし、iPhone Safari の「ホーム画面に追加」でネイティブアプリのように動作させる。

---

## 現状

| 項目 | 状態 |
|------|------|
| `manifest.json` | ❌ 未作成 |
| Service Worker | ❌ 未作成 |
| PWA アイコン | ❌ 未作成 |
| Apple メタタグ | ❌ 未設定 |
| `safe-area-bottom` CSS | ✅ 既存 |
| viewport meta | ✅ Next.js デフォルト |

---

## Proposed Changes

### PWA アイコン

#### [NEW] [icon-192.png](file:///c:/Users/yushink/Desktop/yusystem/public/icon-192.png)
#### [NEW] [icon-512.png](file:///c:/Users/yushink/Desktop/yusystem/public/icon-512.png)
#### [NEW] [apple-touch-icon.png](file:///c:/Users/yushink/Desktop/yusystem/public/apple-touch-icon.png)

`generate_image` ツールで DandoLink のアプリアイコンを生成し、各サイズにリサイズ。

- `icon-192.png` — 192×192（Android / manifest 用）
- `icon-512.png` — 512×512（Android スプラッシュ / manifest 用）
- `apple-touch-icon.png` — 180×180（iOS ホーム画面用）

---

### Web App Manifest

#### [NEW] [manifest.json](file:///c:/Users/yushink/Desktop/yusystem/public/manifest.json)

```json
{
  "name": "DandoLink - 施工管理システム",
  "short_name": "DandoLink",
  "description": "建設・施工管理向けの業務管理システム",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#0f172a",
  "orientation": "any",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

> **修正**: `purpose: "any maskable"` を分離。一部ブラウザでの解釈不具合を回避。

- `display: standalone` → Safari のツールバーなし、フルスクリーン動作
- `theme_color: #0f172a` → Navy（既存デザインの `--color-navy-primary` に合わせる）
- `background_color: #f8fafc` → Pearl White（既存の `--color-pearl-white` に合わせる）

---

### Layout メタタグ

#### [MODIFY] [layout.tsx](file:///c:/Users/yushink/Desktop/yusystem/app/layout.tsx)

`metadata` オブジェクトと `<head>` に以下を追加：

```typescript
import type { Metadata, Viewport } from "next";

// ⚠️ viewport は metadata とは別に定義（Next.js 14+ 推奨）
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    viewportFit: "cover",
};

export const metadata: Metadata = {
    title: "施工管理システム - DandoLink",
    description: "建設・施工管理向けの業務管理システム",
    manifest: "/manifest.json",
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "DandoLink",
    },
    icons: {
        icon: "/icon-192.png",
        apple: "/apple-touch-icon.png",
    },
    themeColor: "#0f172a",
};
```

> **修正**: `viewport` を `metadata` から分離し `export const viewport` で定義。Next.js 14+ の推奨パターンに準拠。

> **重要**: `viewport-fit=cover` により、ノッチ付きモデルで safe area に対応。

---

### Service Worker

#### [NEW] [sw.js](file:///c:/Users/yushink/Desktop/yusystem/public/sw.js)

最小限の Service Worker を作成。キャッシュ戦略は「Network First + Offline Fallback」。

```javascript
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
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
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
```

**設計判断**: 積極的なアセットキャッシュは行わない。理由：
1. Next.js が `_next/static` のキャッシュを自動管理している
2. 業務データはリアルタイム性が重要なため、オフラインキャッシュは混乱の元
3. Service Worker + Supabase Realtime の競合を避ける

---

### オフラインページ

#### [NEW] [offline.html](file:///c:/Users/yushink/Desktop/yusystem/public/offline.html)

ネットワーク切断時に表示するシンプルなページ。「再接続を試みてください」メッセージ。

---

### CSS 追加

#### [MODIFY] [globals.css](file:///c:/Users/yushink/Desktop/yusystem/app/globals.css)

PWA standalone モードでの表示最適化を追加：

```css
/* PWA standalone mode */
@media (display-mode: standalone) {
  body {
    /* ノッチ付きデバイスの safe area */
    padding-top: env(safe-area-inset-top, 0px);
  }
}
```

---

### Service Worker 登録

#### [MODIFY] [layout.tsx](file:///c:/Users/yushink/Desktop/yusystem/app/layout.tsx)

`<body>` 末尾に Service Worker 登録スクリプトを追加：

```html
<script dangerouslySetInnerHTML={{
  __html: `
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js');
      });
    }
  `
}} />
```

---

## Verification Plan

### Automated Tests

```bash
# ビルド成功確認
npm run build
```

- ビルドが成功し、`manifest.json` が正しく配信されることを確認

### Manual Verification

1. `npm run dev` で開発サーバー起動後、`http://localhost:3001` にアクセス
2. ブラウザ DevTools → Application タブ → Manifest セクションで正しく読み込まれることを確認
3. ブラウザ DevTools → Application タブ → Service Workers セクションで登録されていることを確認
4. **iPhone テスト（最優先 — ユーザーに依頼）**:
   - Safari で DandoLink を開く
   - DevTools / ソース表示で `apple-mobile-web-app-capable` メタタグが出力されていることを確認
   - 共有ボタン → 「ホーム画面に追加」
   - ホーム画面のアイコンが正しく表示されることを確認
   - タップして起動 → ブラウザのツールバーなしで全画面表示されること
   - ステータスバーの色が `black-translucent` になっていること

> **注意**: iOS Safari は `manifest.json` の完全サポートが不十分。PWA 動作は Apple メタタグ（`appleWebApp` 設定）に依存するため、iOS テストでは **メタタグの出力確認を最優先** にする。
