# DandoLink - 施工管理システム

建設・施工管理向けの業務管理システムのフロントエンド

## 技術スタック

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Language**: TypeScript

## セットアップ

### 前提条件

Node.js 18.17以降がインストールされている必要があります。

### インストール

```bash
npm install
```

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてアプリケーションを確認できます。

### ビルド

```bash
npm run build
npm start
```

## 機能

### 実装済み

- ✅ サイドバーナビゲーション（3セクション構成）
  - 業務管理（スケジュール管理、案件一覧、日報一覧）
  - 書類・経理（見積書、請求書、発注書）
  - マスター・設定（協力会社、自社情報、設定）
- ✅ ヘッダー
  - セクション名表示
  - 日付ナビゲーション（月次切り替え）
  - 検索バー
  - 通知ベル
  - ユーザープロフィール
- ✅ メインコンテンツエリア
- ✅ レスポンシブデザイン
- ✅ アクティブメニューのハイライト

### 今後の実装予定

- ガントチャート表示
- 各ページの詳細実装
- データ管理機能
- 認証機能

## プロジェクト構成

```
dandolink/
├── app/
│   ├── layout.tsx          # ルートレイアウト
│   ├── page.tsx            # メインページ
│   └── globals.css         # グローバルスタイル
├── components/
│   ├── Sidebar.tsx         # サイドバーコンポーネント
│   ├── Header.tsx          # ヘッダーコンポーネント
│   └── MainContent.tsx     # メインコンテンツコンポーネント
├── public/                 # 静的ファイル
├── tailwind.config.ts      # Tailwind設定
├── tsconfig.json           # TypeScript設定
└── package.json            # 依存関係
```

## デザインコンセプト

CraftBankのような建設・施工管理向けの清潔感のあるBtoB SaaSデザインを採用。

- 白ベースの清潔なUI
- 薄いボーダーで視認性を確保
- アクティブメニューは青色でハイライト
- スムーズなホバーエフェクト
