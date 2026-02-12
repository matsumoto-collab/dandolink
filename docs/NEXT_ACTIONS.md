# YuSystem 改善・修正アクションリスト

> **最終更新**: 2026-02-11
> **現状**: 76.73% Lines Coverage / 1,158テスト / 125スイート / CI設定済み
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
| `docs/PRODUCT_ROADMAP.md` | 製品ロードマップ |

---

## アクション一覧

### 優先度: ★★★（すぐやるべき）

#### A-1. CI の lint/typecheck エラーを解消する
- **背景**: GitHub Actions を設定したが、lint や typecheck でエラーが出る可能性がある
- **確認方法**: https://github.com/matsumoto-collab/yusystem/actions を確認
- **作業内容**: エラーが出ている場合、該当ファイルを修正する
- **完了条件**: GitHub Actions が全てグリーン（✓）になる

#### A-2. calendarStore.ts の分割（898行 → 機能別に分割）
- **ファイル**: `stores/calendarStore.ts`（898行）
- **問題**: 1ファイルに assignments, projectMasters, dailyReports, vacations, remarks の全CRUDが詰まっている。変更時の影響範囲が大きく、テストも書きにくい
- **修正方針**:
  ```
  stores/
  ├── calendarStore.ts        → 共通型定義とstore統合のみ（50行程度）
  ├── assignmentStore.ts      → assignments のCRUD・楽観的更新
  ├── projectMasterStore.ts   → projectMasters のCRUD
  ├── dailyReportStore.ts     → dailyReports のCRUD
  └── calendarSubStore.ts     → vacations, remarks
  ```
- **注意**: 分割後に以下を確認すること
  - `useProjects.ts` が `useCalendarStore` を参照している
  - `useCalendarDisplay.ts` が store のセレクタを使っている
  - 既存テスト `__tests__/stores/calendarStore.test.ts` を分割後のファイルに合わせて修正
- **完了条件**: `npm run build` と `npm test` が全パス

#### A-3. モーダルのキーボード操作対応
- **問題**: モーダルを開いたときにフォーカスが移動しない、Escキーで閉じない、タブキーでフォーカスが外に逃げる
- **対象ファイル**（主要モーダル）:
  - `components/Projects/ProjectModal.tsx`
  - `components/Calendar/DispatchConfirmModal.tsx`
  - `components/Calendar/CopyAssignmentModal.tsx`
  - `components/Settings/UserModal.tsx`
  - `components/Estimates/EstimateModal.tsx`
  - `components/Invoices/InvoiceModal.tsx`
  - `components/Customers/CustomerModal.tsx`
- **修正内容**: 各モーダルに以下を追加
  ```tsx
  // 1. Escキーで閉じる
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // 2. 開いたときにフォーカスを移動
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  // 3. モーダルのルート要素に role="dialog" と aria-modal="true" を追加
  <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1}>
  ```
- **完了条件**: 各モーダルでEscキー閉じ・フォーカス移動が動作する

---

### 優先度: ★★☆（早めにやるべき）

#### B-1. ~~見積編集機能の実装 or ボタン非表示~~ ✅ 完了（2026-02-12）
- **対応**: 編集機能を実装。`EstimateModal` を動的インポートし、既存の `updateEstimate` APIで更新
- **変更ファイル**: `app/(finance)/estimates/[id]/page.tsx`

#### B-2. パスワードリセット機能
- **現状**: ユーザーがパスワードを忘れた場合、管理者がDBを直接操作するしかない
- **修正方針**: 既存の PATCH `/api/users/[id]` がパスワード更新に対応済み（`password` フィールドをオプショナルで受け付ける）。新規APIルートは不要
  1. `components/Settings/UserManagement.tsx` にパスワードリセットボタンを追加
  2. パスワードリセット確認ダイアログを表示（ランダム仮パスワードを生成して表示）
  3. 既存の PATCH API で `{ password: 仮パスワード }` を送信
  4. メール送信は不要（社内ツールのため、画面に仮パスワードを表示して管理者が口頭で伝える）
- **既存コード参考**:
  - API: `app/api/users/[id]/route.ts` 47-55行（bcryptハッシュ化済み）
  - バリデーション: `lib/validations/index.ts` passwordSchema（8文字以上、英字+数字）
  - 権限: `utils/permissions.ts` `canManageUsers()` → admin のみ
  - UI: `components/Settings/UserManagement.tsx`（ユーザー一覧 + 編集/削除ボタン）

#### B-3. ~~PDF コンポーネントの共通化~~ ✅ 完了（2026-02-12）
- **対応**: 既存の `styles.ts` を活用し、フォント登録(3→1箇所)と `toReiwa`(3→1箇所)を集約
- **変更ファイル**: `styles.ts`, `EstimatePDF.tsx`(656→634行), `InvoicePDF.tsx`(552→530行)
- テーブルJSXのコンポーネント化はカラム構成の差異が大きく見送り

#### B-4. レート制限の改善
- **ファイル**: `lib/rate-limit.ts`
- **問題**: インメモリ実装のため、Vercelのサーバーレス環境ではリクエストごとにリセットされる
- **修正方針**: Upstash Redis を使った分散レート制限に置き換え
  ```bash
  npm install @upstash/ratelimit @upstash/redis
  ```
  ```typescript
  import { Ratelimit } from '@upstash/ratelimit';
  import { Redis } from '@upstash/redis';

  const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(100, '1 m'),
  });
  ```
- **必要な環境変数**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **注意**: Upstash の無料プランで十分（10,000リクエスト/日）

#### B-5. ~~API未テストルートのテスト追加~~ ✅ 完了（確認済み 2026-02-12）
- **結果**: 5ルート全てにテストが既に存在。正常系・バリデーション・認証・404をカバー済み
  - `__tests__/api/customers/[id]/route.test.ts` (119行)
  - `__tests__/api/estimates/[id]/route.test.ts` (118行)
  - `__tests__/api/invoices/[id]/route.test.ts` (118行)
  - `__tests__/api/users/[id]/route.test.ts` (150行)
  - `__tests__/api/daily-reports/[id]/route.test.ts` (106行)

---

### 優先度: ★☆☆（余裕があればやる）

#### C-1. ~~コンポーネントへの aria 属性追加~~ ✅ 完了（2026-02-12）
- **対応**: 8コンポーネントのアイコンのみボタンに `aria-label` を追加（24箇所）
- **変更ファイル**: CalendarHeader, EmployeeRowComponent, DraggableEventCard, VacationSelector, ForemanSelector, EstimateForm, EstimateDetailModal, UserManagement

#### C-2. ~~next/Image コンポーネントの利用~~ ⏭️ スキップ
- **理由**: 対象の `<img>` はBase64 Data URL（ファイルアップロードのプレビュー）であり、`next/Image` は動的なData URLに不向き（width/height固定が必要、最適化の恩恵もない）

#### C-3. ~~大きなコンポーネントの動的インポート~~ ✅ 完了（2026-02-12）
- **対応**: `MainContent.tsx` の9コンポーネントを `next/dynamic` に変更、LoadingSpinner追加

#### C-4. ~~financeStore.ts の Branch カバレッジ強化~~ ✅ 完了（2026-02-12）
- **結果**: Branch 31% → 78.75%（63/80ブランチカバー）、テスト数 25 → 55

#### C-5. 予算書機能の実装
- **ファイル**: `app/(finance)/estimates/[id]/page.tsx` 214-218行
- **現状**: 「予算書」タブが存在するが「今後実装予定です」と表示
- **要件**: プロジェクトオーナーに仕様を確認してから着手
- **参考**: 見積書の明細データから原価・粗利を計算して表示する機能と推測

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

- **Zustand Store** が中央のデータ管理。hooks がそれをラップしてコンポーネントに提供
- **楽観的更新**: Store でローカル state を即更新 → API呼出 → 失敗時ロールバック
- **リアルタイム同期**: `useProjects.ts` が Supabase Realtime を購読。`isUpdatingRef` で自分の更新による再fetchを防止
- **カレンダー表示**: `displayedForemanIds` で表示する職長行をフィルタ。このIDに一致しない `assignedEmployeeId` の配置は表示されない

---

## 本日の作業予定（2026-02-12）

### ~~1. B-1: 見積編集機能の実装~~ ✅ 完了
- EstimateModal を詳細ページに追加、既存API活用

### ~~2. B-2: パスワードリセット機能~~ ✅ 完了
- UserManagement.tsx に鍵アイコンボタン + 確認/結果ダイアログを追加、既存PATCH API活用

### ~~3. B-5: API未テストルートのテスト追加~~ ✅ 既に完了済み
- 5ルート全てにテスト存在を確認

### ~~4. B-3: PDF コンポーネントの共通化~~ ✅ 完了
- フォント登録・toReiwa を styles.ts に集約

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
