# DandoLink - 施工管理システム

建設・足場施工業向けの業務管理 Web アプリケーション。案件管理、カレンダー手配、見積書・請求書発行、日報管理などをワンストップで提供します。

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | Supabase (PostgreSQL) + Prisma ORM |
| Auth | NextAuth.js |
| State | Zustand (slice パターン) |
| Realtime | Supabase Realtime (Presence / Broadcast) |
| Styling | Tailwind CSS |
| PDF | @react-pdf/renderer, jsPDF |
| Maps | Google Maps (Embed API) |
| Monitoring | Sentry |
| Hosting | Vercel |

## セットアップ

### 前提条件

- Node.js 18.17+
- npm

### インストール & 起動

```bash
# 依存インストール
npm install

# 環境変数を設定（テンプレートをコピー）
cp .env.example .env

# DB マイグレーション
npx prisma migrate deploy

# 開発サーバー起動（http://localhost:3001）
npm run dev
```

### 主なコマンド

```bash
npm run build          # プロダクションビルド
npm run lint           # ESLint
npx tsc --noEmit       # 型チェック
npm test               # Jest テスト
npm run test:e2e       # Playwright E2E テスト
```

## 機能一覧

- **カレンダー手配** — 週次カレンダーで職長ごとの案件配置、ドラッグ&ドロップ並び替え
- **案件マスター** — 案件情報の一元管理、住所ジオコーディング、工事種別マスター
- **手配表** — 日別の手配確認、車両割当、職方への共有ビュー
- **マイ工程** — 個人スケジュール表示、リアルタイム同期
- **見積書 / 請求書** — PDF 生成・プレビュー、原価管理、粗利率計算
- **日報管理** — 作業実績入力、工事種別・人数・作業時間の記録
- **顧客管理** — 元請・協力会社の管理
- **設定** — ユーザー管理、車両マスター、工事名称マスター、休暇管理

## プロジェクト構成

```
dandolink/
├── app/                    # Next.js App Router
│   ├── (calendar)/         #   カレンダー・手配関連ページ
│   ├── (finance)/          #   見積書・請求書ページ
│   ├── (master)/           #   マスター管理ページ
│   ├── (standalone)/       #   認証・スタンドアロンページ
│   ├── api/                #   API Routes (REST)
│   └── providers/          #   Context Providers
├── components/             # UI コンポーネント
│   ├── Calendar/           #   カレンダー (Desktop / Mobile)
│   ├── Estimates/          #   見積書
│   ├── Invoices/           #   請求書
│   ├── ProjectMasters/     #   案件マスター
│   ├── pdf/                #   PDF テンプレート
│   └── ui/                 #   共通 UI (Button, Modal, etc.)
├── stores/                 # Zustand ストア
│   └── calendarSlices/     #   カレンダーストア (6 スライス)
├── hooks/                  # カスタムフック
├── lib/                    # ユーティリティ (Prisma, Supabase, auth)
├── types/                  # TypeScript 型定義
├── prisma/                 # Prisma スキーマ & マイグレーション
├── contexts/               # React Context
└── utils/                  # ヘルパー関数
```

## 環境変数

`.env.example` を参照してください。主要な設定:

- `DATABASE_URL` — Supabase PostgreSQL 接続文字列
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase クライアント
- `NEXTAUTH_URL` / `NEXTAUTH_SECRET` — NextAuth 設定
