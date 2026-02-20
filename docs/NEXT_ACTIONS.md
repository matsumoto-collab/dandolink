# DandoLink 改善・修正アクションリスト

> **最終更新**: 2026-02-12
> **現状**: 76.73% Lines Coverage / 1,188テスト / 125スイート / CI設定済み
> **対象**: AIまたはエンジニアが本ドキュメントを読んで作業を引き継げることを目的とする

---

## プロジェクト概要

建設会社向け業務管理システム（Next.js 14 App Router）。
スケジュール管理、見積・請求PDF、日報、収益ダッシュボード、マスターデータ管理を統合。

**技術スタック**: Next.js 14 / TypeScript (strict) / Zustand / Prisma / Supabase / Tailwind CSS

**デプロイ**: `git push origin main` → Vercel自動デプロイ
**CI**: GitHub Actions（Lint → TypeCheck → Test → Build）

---

## 環境セットアップ

```bash
npm install
npm run dev          # 開発サーバー（localhost:3001）
npm test             # テスト実行
npm run build        # ビルド確認
npm run test:coverage # カバレッジ付きテスト
```

**必要な環境変数**:
- `DATABASE_URL` — Supabase PostgreSQL接続文字列
- `DIRECT_URL` — Prismaマイグレーション用（DATABASE_URLと同じ値）
- `NEXT_PUBLIC_SUPABASE_URL` — SupabaseプロジェクトURL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase匿名キー
- `NEXTAUTH_SECRET` — NextAuth暗号化キー
- `NEXTAUTH_URL` — アプリのベースURL

---

## 既存ドキュメント一覧

| ファイル | 内容 |
|---------|------|
| `docs/TESTING_HANDOFF.md` | テストパターン・規約・モック設定の詳細 |
| `docs/TEST_COVERAGE_PLAN.md` | テストカバレッジ改善の元計画 |
| `docs/TEST_COVERAGE_FINAL_PHASE.md` | Batch別テスト作業指示書 |
| `docs/BUG_FIX_PLAN.md` | バグ修正計画と完了状況 |
| `docs/TEST_FIX_GUIDE.md` | テスト失敗時のトラブルシューティング |
| `docs/PRODUCT_ROADMAP.md` | 製品ロードマップ（サブスク販売計画） |
| `docs/PROJECT_EVALUATION.md` | プロジェクト辛口評価レポート |
| `docs/MOBILE_IMPROVEMENT.md` | **モバイル改善の設計・進捗** ← NEW |

---

## 🔥 進行中: モバイルスケジュールビュー改善

### 背景
現場管理者（マネージャー）がスマホで以下を行えるようにする:
- 今日・明日のスケジュール確認
- 案件の編集・移動・コピー
- 見積書の現場作成（将来）

### 完了: Step 1（基本表示）— 2026-02-12

| コンポーネント | ファイル | 内容 |
|--------------|---------|------|
| useMediaQuery | `hooks/useMediaQuery.ts` | lg未満(1024px)でモバイル判定 |
| WeeklyCalendar | `components/Calendar/WeeklyCalendar.tsx` | 状態管理+PC/モバイル分岐のみに整理 |
| DesktopCalendarView | `components/Calendar/DesktopCalendarView.tsx` | 既存PC表示をそのまま抽出（変更なし） |
| WeekOverviewBar | `components/Calendar/WeekOverviewBar.tsx` | 週俯瞰バー（曜日・件数・充足率バー） |
| MobileCalendarView | `components/Calendar/MobileCalendarView.tsx` | モバイル専用ビュー本体 |
| globals.css | `app/globals.css` | scale()ハック削除、アニメーション追加 |

**現在のモバイルビュー機能**:
- ✅ 週俯瞰バー（7曜日 + 件数 + 人員充足率バー）
- ✅ 曜日タップで日切替
- ✅ 日別の職長カード形式表示（現場名・元請・人数・備考が読める）
- ✅ アクションシート（カードタップ → 編集・コピー・手配確定）
- ✅ 下部フローティング日付ナビ（前日/翌日）
- ✅ FAB追加ボタン（右下＋）
- ✅ iPhone safe area対応

### 次にやること: Step 2（操作性強化）— 約2日

#### S2-1. アクションシートをVaulライブラリに置き換え
- **現状**: 自作のdiv+アニメーション。ネストスクロール・iOS Safariバウンスの問題あり
- **方針**: `vaul`パッケージ（3KB）を導入してボトムシートを置き換え
  ```bash
  npm install vaul
  ```
- **対象ファイル**: `components/Calendar/MobileCalendarView.tsx` のアクションシート部分

#### S2-2. モバイル用案件移動UI
- **現状**: アクションシートに「移動」ボタンがない（編集モーダルからのみ可能）
- **方針**: ミニカレンダーグリッド式の移動UI
  ```
  移動先を選択:
       月  火  水  木  金
  田中  □  □  ■  □  □    ← ■は現在位置
  佐藤  □  □  □  □  □    ← □をタップで移動
  ```
- **新規ファイル**: `components/Calendar/MobileMoveGrid.tsx`
- **接続先**: 既存の `updateProject` で日付・職長を変更

#### S2-3. モーダルのモバイル最適化
- **対象**: ProjectModal, EstimateModal 等
- **問題**: PCサイズ前提のモーダルがスマホでは画面からはみ出す
- **方針**: lg未満では `max-h-[90vh] overflow-auto` + フルスクリーンに近い表示

### 将来: Step 3（快適さ向上）— 約2日

#### S3-1. フローティング日付ナビの改善
- 週俯瞰バーをstickyにして、どこまでスクロールしても曜日タップ可能にする（現在は実装済み）
- 追加: スワイプは採用しない（手袋操作を考慮）

#### S3-2. MobileCalendarView のテスト追加
- `__tests__/components/Calendar/MobileCalendarView.test.tsx`
- WeekOverviewBar, アクションシートの動作テスト

#### S3-3. 見積書のモバイル対応
- 見積フォームの入力項目をモバイル向けに簡略化（「簡易見積」モード）
- 見積プレビューのモバイル最適化（PDF縮小ではなくHTMLリフロー表示）

---

## 残りのアクション一覧

### 優先度: ★★★（すぐやるべき）— すべて完了 ✅

| ID | 内容 | 状態 |
|----|------|------|
| A-1 | CI lint/typecheck エラー解消 | ✅ |
| A-2 | calendarStore.ts 分割 | ✅ |
| A-3 | モーダルキーボード操作対応 | ✅ |

### 優先度: ★★☆（早めにやるべき）

| ID | 内容 | 状態 |
|----|------|------|
| B-1 | 見積編集機能 | ✅ |
| B-2 | パスワードリセット機能 | ✅ |
| B-3 | PDF共通化 | ✅ |
| B-4 | レート制限の改善（Upstash Redis） | 未着手 |
| B-5 | APIテスト確認 | ✅ |

### 優先度: ★☆☆（余裕があればやる）

| ID | 内容 | 状態 |
|----|------|------|
| C-1 | aria属性追加 | ✅ |
| C-2 | next/Image | ⏭️ スキップ |
| C-3 | 動的インポート | ✅ |
| C-4 | financeStoreテスト強化 | ✅ |
| C-5 | 予算書機能 | 未着手（仕様確認待ち） |

---

## 作業時の注意事項

### コミット・デプロイ
1. 修正後は必ず `npm run build` と `npm test` を実行
2. コミットメッセージ形式: `fix:`, `feat:`, `refactor:`, `test:`, `ci:` のプレフィックスを使う
3. `git push origin main` で自動デプロイ
4. GitHub Actions の結果を確認する

### テストの書き方
- `docs/TESTING_HANDOFF.md` を必ず読む
- テスト名は日本語
- `jest.setup.ts` のグローバルモックを活用
- `beforeEach` で `jest.clearAllMocks()`

### やってはいけないこと
- `calendarStore.ts` の state 構造を変更する際は、それを参照している全 hook を確認する
- `mockEmployees`（ID: "1"〜"6"）を使わない — 必ず実データ（UUID）を使う
- Prisma スキーマを変更したら `npx prisma generate` を忘れない
- `.env` ファイルをコミットしない

### モバイルビュー開発時の注意
- **PC表示に影響しないこと**: DesktopCalendarView.tsx は変更しない
- **WeeklyCalendar.tsx は分岐のみ**: 状態管理ロジックの追加はOK、JSXの追加はNG（Mobile/Desktopに分ける）
- **useMediaQuery はnullを返す可能性あり**: SSR時はnull → Loadingで吸収済み
- **タッチ操作を前提に設計**: タップターゲット44px以上、スワイプは不採用（手袋操作考慮）
- **スマホ検証**: ブラウザのDevToolsでiPhone SE（375px）/iPhone 14（390px）で確認

### アーキテクチャ概要
```
ブラウザ
  ↓
Next.js Pages (app/)
  ↓
Custom Hooks (hooks/)  ←→  Zustand Stores (stores/)
  ↓                           ↓
API Routes (app/api/)     Supabase Realtime
  ↓
Prisma ORM
  ↓
Supabase PostgreSQL
```

### カレンダーコンポーネント構成（2026-02-12時点）
```
WeeklyCalendar.tsx          ← 状態管理 + PC/モバイル分岐
  ├─ DesktopCalendarView.tsx  ← PC表示（DndContext + グリッド）
  │    ├─ CalendarHeader.tsx
  │    ├─ EmployeeRowComponent.tsx
  │    ├─ DraggableEventCard.tsx
  │    ├─ DroppableCell.tsx
  │    ├─ RemarksRow.tsx
  │    └─ ForemanSelector.tsx
  ├─ MobileCalendarView.tsx   ← モバイル表示（カード形式）
  │    └─ WeekOverviewBar.tsx  ← 週俯瞰バー
  └─ [共通モーダル群]
       ├─ ProjectModal.tsx
       ├─ ProjectMasterSearchModal.tsx
       ├─ DispatchConfirmModal.tsx
       ├─ CopyAssignmentModal.tsx
       ├─ ProjectSelectionModal.tsx
       └─ ConflictResolutionModal.tsx
```

---

## 完了済み作業の履歴

| 日付 | 作業 | 結果 |
|------|------|------|
| 2026-02-11 | A-1: CI lint/typecheck エラー解消 | GitHub Actions 全グリーン |
| 2026-02-11 | A-2: calendarStore.ts 分割 | 898行 → 6スライス（68行の統合ファイル + 6スライスファイル） |
| 2026-02-11 | A-3: モーダルキーボード操作対応 | 全14モーダルに useModalKeyboard フック適用 |
| 2026-02-11 | テストカバレッジ Batch 1-10 | 44.86% → 76.73% |
| 2026-02-11 | バグ修正 #1-#8 | メモリリーク、収益計算、PDF無限ローディング等 |
| 2026-02-11 | GitHub Actions CI 設定 | Lint→TypeCheck→Test→Build 自動実行 |
| 2026-02-11 | 不要ログファイル削除 + .gitignore 強化 | 37,000行以上のゴミファイル削除 |
| 2026-02-12 | B-1: 見積編集機能の実装 | 詳細ページに EstimateModal 追加、既存 updateEstimate API 活用 |
| 2026-02-12 | B-2: パスワードリセット機能 | UserManagement.tsx に鍵ボタン + 確認/結果ダイアログ追加 |
| 2026-02-12 | B-5: APIテスト確認 | 5ルート全て既にテスト済みであることを確認 |
| 2026-02-12 | B-3: PDF共通化 | フォント登録・toReiwa を styles.ts に集約（44行削減） |
| 2026-02-12 | C-3: 動的インポート | MainContent.tsx の9コンポーネントを next/dynamic に変更 |
| 2026-02-12 | C-4: financeStoreテスト強化 | Branch 31% → 78.75%、テスト数 25 → 55 |
| 2026-02-12 | C-1: aria属性追加 | 8コンポーネント・24箇所にaria-label追加 |
| 2026-02-12 | モバイルビュー Step 1 | 週俯瞰バー+日別詳細+アクションシート+FAB+下部ナビ実装 |
