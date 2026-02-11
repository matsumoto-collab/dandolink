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

#### B-1. 見積編集機能の実装 or ボタン非表示
- **ファイル**: `app/(finance)/estimates/[id]/page.tsx` 77-80行
- **現状**: 「編集」ボタンが表示されているが、押すと「編集機能は今後実装予定です」のトーストが出るだけ
- **選択肢**:
  - **(A) ボタンを非表示にする**（5分で完了）: `handleEdit` と該当JSXを削除
  - **(B) 編集機能を実装する**（数時間）: 見積書の編集モーダルを作成し、既存の `EstimateForm` コンポーネントを再利用
- **判断**: プロジェクトオーナーに確認してから着手

#### B-2. パスワードリセット機能
- **現状**: ユーザーがパスワードを忘れた場合、管理者がDBを直接操作するしかない
- **修正方針**:
  1. `app/api/users/[id]/reset-password/route.ts` を作成（admin権限でリセット）
  2. Settings の UserManagement 画面に「パスワードリセット」ボタンを追加
  3. 仮パスワードを発行してユーザーに伝える方式（メール送信は不要 — 社内ツールのため）
- **参考**: 既存の `app/api/users/[id]/route.ts` の PUT メソッドにパスワード更新ロジックがある

#### B-3. PDF コンポーネントの共通化
- **ファイル**: `components/pdf/EstimatePDF.tsx`（655行）、`components/pdf/InvoicePDF.tsx`（551行）
- **問題**: ヘッダー、フッター、テーブルスタイル、会社情報表示が両ファイルで重複
- **修正方針**:
  ```
  components/pdf/
  ├── shared/
  │   ├── PdfHeader.tsx        → 会社ロゴ・住所・文書番号
  │   ├── PdfFooter.tsx        → 振込先・備考
  │   ├── PdfItemTable.tsx     → 明細テーブル（行データを受け取る）
  │   └── pdfStyles.ts         → 共通スタイル定義
  ├── EstimatePDF.tsx           → 見積固有のロジックのみ
  └── InvoicePDF.tsx            → 請求固有のロジックのみ
  ```
- **完了条件**: PDF出力が以前と同じ見た目であること（目視確認）

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

#### B-5. API未テストルートのテスト追加
- **対象**: 以下のAPIルートにはテストが存在しない
  | ルート | 行数 | 重要度 |
  |--------|------|--------|
  | `app/api/customers/[id]/route.ts` | 105 | 高 |
  | `app/api/estimates/[id]/route.ts` | 57 | 高 |
  | `app/api/invoices/[id]/route.ts` | 59 | 高 |
  | `app/api/daily-reports/[id]/route.ts` | 45 | 中 |
  | `app/api/users/[id]/route.ts` | 78 | 高 |
  | `app/api/init-db/route.ts` | 37 | 低 |
- **テストパターン**: `__tests__/api/assignments/route.test.ts` を参考にする
- **最低限のテストケース**: 正常系(200)、バリデーションエラー(400)、認証エラー(401)、404、500

---

### 優先度: ★☆☆（余裕があればやる）

#### C-1. コンポーネントへの aria 属性追加
- **問題**: ARIA属性がゼロ。スクリーンリーダーで使えない
- **対象**: 全コンポーネントだが、まず以下から
  - ボタンに `aria-label`（アイコンのみのボタンは特に）
  - フォーム入力に `aria-required`, `aria-invalid`
  - ステータスバッジに `role="status"`
  - テーブルに適切な `<thead>`, `<th scope>`
- **参考**: 既存の `<button title="削除">` のパターンに `aria-label` を追加するだけでも改善

#### C-2. next/Image コンポーネントの利用
- **問題**: `<img>` タグを直接使用している箇所がある
- **対象ファイル**: `components/Settings/CompanyInfoSettings.tsx` 218行付近
- **修正**: `import Image from 'next/image'` に置き換え

#### C-3. 大きなコンポーネントの動的インポート
- **問題**: WeeklyCalendar（437行）、EstimateForm（621行）等が即座にロードされる
- **修正**: `next/dynamic` で遅延ロード
  ```tsx
  const WeeklyCalendar = dynamic(() => import('./WeeklyCalendar'), {
    loading: () => <Loading />,
  });
  ```

#### C-4. financeStore.ts の Branch カバレッジ強化
- **ファイル**: `stores/financeStore.ts`（503行）
- **現状**: Lines 72% だが Branch 31%
- **作業**: `__tests__/stores/financeStore.test.ts` に以下を追加
  - 各 CRUD 操作のエラーハンドリング（catch ブロック）
  - 楽観的更新のロールバック
  - null/undefined フォールバック
- **参考**: `docs/TESTING_HANDOFF.md` のストアテストパターン

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

## 完了済み作業の履歴

| 日付 | 作業 | 結果 |
|------|------|------|
| 2026-02-11 | テストカバレッジ Batch 1-10 | 44.86% → 76.73% |
| 2026-02-11 | バグ修正 #1-#8 | メモリリーク、収益計算、PDF無限ローディング等 |
| 2026-02-11 | GitHub Actions CI 設定 | Lint→TypeCheck→Test→Build 自動実行 |
| 2026-02-11 | 不要ログファイル削除 + .gitignore 強化 | 37,000行以上のゴミファイル削除 |
