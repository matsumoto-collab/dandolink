# YuSystem パフォーマンス改善計画

**最終更新**: 2026-01-18
**総合評価（改善前）**: 65/100

---

## 改善状況サマリー

| カテゴリ | 完了 | 未完了 |
|---------|------|--------|
| パフォーマンス | 7 | 0 |
| UI/UX | 2 | 1 |
| コード品質 | 1 | 2 |
| セキュリティ | 1 | 1 |
| テスト | 0 | 1 |

---

## 1. パフォーマンス問題

### 1.1 Context地獄（遅延読み込み） - ✅ 改善済み (2026-01-18)

**問題**: 15以上のContextがルートレベル（`app/layout.tsx`）で全て読み込まれ、ログイン直後に大量のAPI呼び出しが発生

**解決策**: 遅延読み込み（Lazy Loading）パターンを実装

**変更内容**:
- 以下のContextに `isInitialized`, `ensureDataLoaded` を追加し、自動フェッチを削除:
  - `contexts/EstimateContext.tsx`
  - `contexts/CompanyContext.tsx`
  - `contexts/InvoiceContext.tsx`
  - `contexts/CustomerContext.tsx`
  - `contexts/UnitPriceMasterContext.tsx`

- 該当ページで `useEffect` から `ensureDataLoaded()` を呼び出し:
  - `app/estimates/page.tsx`
  - `app/estimates/[id]/page.tsx`
  - `app/invoices/page.tsx`
  - `app/customers/page.tsx`
  - `components/Settings/UnitPriceMasterSettings.tsx`

- Realtimeサブスクリプションはデータ取得後のみ開始

**コミット**: `e97d23a`

---

### 1.2 日報・利益ダッシュボードの読み込み速度 - ✅ 改善済み (2026-01-18)

**問題**: 日報一覧と利益ダッシュボードがページ遷移のたびにAPIを呼び出し、遅かった

**解決策**: Contextにキャッシュを実装

**変更内容**:
- `contexts/DailyReportContext.tsx`: `isInitialLoaded` フラグを追加、認証時に自動フェッチ
- `contexts/ProfitDashboardContext.tsx`: 新規作成、フィルタリングはクライアント側で実行

**コミット**: `eb6cfc3`

---

### 1.3 N+1クエリ問題 - ✅ 改善済み

**問題**: 利益ダッシュボードAPIで各プロジェクトごとにクエリを発行

**解決策**: 一括クエリに最適化、selectで必要なフィールドのみ取得

**コミット**: `e5c35b7`

---

### 1.4 コンポーネントメモ化 - ✅ 改善済み

**問題**: フィルタ処理・検索処理にuseMemoなし

**解決策**: useMemo, useCallbackでメモ化

**対象ファイル**:
- `app/daily-reports/page.tsx`
- `app/invoices/page.tsx`
- `app/estimates/page.tsx`

---

### 1.5 コード分割・遅延読み込み（モーダル） - ✅ 改善済み

**問題**: 大きなモーダルコンポーネントが即座に読み込まれる

**解決策**: `next/dynamic` で遅延読み込み

**対象**:
- EstimateModal, EstimateDetailModal
- InvoiceModal
- 各種フォームモーダル

---

### 1.6 検索デバウンス - ✅ 改善済み

**問題**: 検索入力のたびに即座にフィルタリングが実行される

**解決策**: `hooks/useDebounce.ts` を作成し、300msのデバウンスを適用

---

### 1.7 バンドルサイズ最適化 - ✅ 改善済み (2026-01-18)

**問題**:
- 大きなライブラリ（jspdf, xlsx等）が即座に読み込まれる
- 未使用のコードが含まれている可能性

**解決策**: PDF生成ライブラリの動的インポート化

**変更内容**:
- `@next/bundle-analyzer` をインストール・設定（`next.config.js`）
- 以下のファイルでjsPDF（〜300KB+）を動的インポートに変更:
  - `components/Estimates/EstimateDetailModal.tsx`
  - `app/estimates/[id]/page.tsx`
- PDF生成は実際にユーザーがPDF機能を使用するときのみ読み込まれる

**バンドル分析の実行方法**:
```bash
ANALYZE=true npm run build
```

---

### 1.8 APIレスポンスキャッシュ - ✅ 改善済み (2026-01-18)

**問題**: 頻繁にアクセスされる参照データが毎回DBから取得される

**解決策**: Cache-Controlヘッダーで5分間のプライベートキャッシュを設定

**変更内容**:
- `app/api/master-data/route.ts` - 車両・作業員・管理者一覧
- `app/api/dispatch/foremen/route.ts` - 職長一覧
- `app/api/dispatch/workers/route.ts` - 作業員一覧

```typescript
return NextResponse.json(data, {
    headers: {
        'Cache-Control': 'private, max-age=300, stale-while-revalidate=60',
    },
});
```

---

### 1.9 データベースインデックス - ✅ 改善済み (2026-01-18)

**問題**: 頻繁にクエリされるカラムにインデックスがない

**解決策**: `scripts/add_performance_indexes.sql` を作成

**適用方法**:
1. Supabaseダッシュボードを開く
2. SQL Editor を選択
3. `scripts/add_performance_indexes.sql` の内容を貼り付けて実行

**対象テーブル**:
- `ProjectAssignment` - date, assignedEmployeeId+date, projectMasterId
- `Customer` - name
- `Estimate` - createdAt, status
- `ProjectMaster` - title, customerId


## 2. UI/UX問題

### 2.1 ローディング状態の統一 - ✅ 改善済み (2026-01-18)

**問題**: ローディング表示が統一されていない（スピナー、スケルトン、何もなしなど）

**解決策**: 統一されたLoadingコンポーネントを作成し、全アプリケーションで使用

**変更内容**:
- `components/ui/Loading.tsx` を新規作成:
  - `Loading`: 基本ローディングスピナー（サイズ、テキスト、フルスクリーン、オーバーレイオプション）
  - `PageLoading`: ページ全体のローディング表示
  - `TableRowSkeleton`: テーブル行のスケルトン
  - `CardSkeleton`: カードのスケルトン
  - `ButtonLoading`: ボタン内のローディング表示

- 以下のファイルで統一コンポーネントに置き換え:
  - `app/daily-reports/page.tsx` - インラインスピナー → Loading
  - `app/login/page.tsx` - SVGスピナー → ButtonLoading
  - `components/Settings/UserManagement.tsx` - テキスト → Loading
  - `components/Projects/ProjectForm.tsx` - インラインスピナー → ButtonLoading
  - `components/Calendar/WeeklyCalendar.tsx` - インラインスピナー → Loading, overlay
  - `components/ProjectMaster/ProjectProfitDisplay.tsx` - Loader2 → Loading
  - `components/Settings/UserModal.tsx` - テキスト → ButtonLoading
  - `components/ProjectMasterSearchModal.tsx` - インラインスピナー → Loading
  - `components/ProjectMasters/ProjectMasterForm.tsx` - インラインスピナー → ButtonLoading
  - `components/Calendar/DispatchConfirmModal.tsx` - テキスト → Loading

- **追加改善 (2026-01-18)**: 読み込み中に「データなし」と誤表示される問題を修正:
  - `app/customers/page.tsx` - 読み込み中はCardSkeletonを表示
  - `app/estimates/page.tsx` - 読み込み中はテーブルスケルトン行を表示
  - Context の `isLoading`, `isInitialized` を使用して空データ判定を正確に

---

### 2.2 エラーハンドリングの統一 - ✅ 改善済み (2026-01-18)

**問題**: `alert()` と `console.error()` が混在、ユーザーフレンドリーでない

**解決策**: react-hot-toastを導入し、全てのalert()をtoastに置き換え

**変更内容**:
- `react-hot-toast` パッケージをインストール
- `app/layout.tsx` に `<Toaster>` コンポーネントを追加
- 以下のファイルで `alert()` を `toast.error()` / `toast.success()` に置き換え:
  - `app/estimates/page.tsx`
  - `app/invoices/page.tsx`
  - `app/customers/page.tsx`
  - `app/daily-reports/page.tsx`
  - `app/projects/page.tsx`
  - `app/project-masters/page.tsx`
  - `app/settings/page.tsx`
  - `app/estimates/[id]/page.tsx`
  - `components/Settings/UnitPriceMasterSettings.tsx`
  - `components/Customers/CustomerForm.tsx`
  - `components/Invoices/InvoiceForm.tsx`
  - `components/Calendar/CopyAssignmentModal.tsx`
  - `components/Projects/ProjectForm.tsx`
  - `components/Calendar/DispatchConfirmModal.tsx`
  - `components/Estimates/EstimateForm.tsx`
  - `components/Projects/MultiDayScheduleEditor.tsx`
  - `components/Settings/UserManagement.tsx`

**コミット**: `0fa6761`

---

### 2.3 モバイルレスポンシブ - ⏳ 未対応

**問題**: デスクトップ優先で設計されており、モバイルでの使い勝手が悪い

**推奨対応**:
- テーブルのモバイル対応（カード表示への切り替え等）
- タッチ操作の最適化
- フォントサイズ・間隔の調整

---

## 3. コード品質問題

### 3.1 TypeScript strict mode - ⏳ 未対応

**問題**: `any` 型が多用されている

**推奨対応**:
- `tsconfig.json` で strict mode を有効化
- `any` を適切な型に置き換え

---

### 3.2 重複コード - ⏳ 未対応

**問題**: 同様のCRUD処理が各Contextで重複

**推奨対応**:
- 汎用的なCRUDフックの作成
- APIクライアントの抽象化

---

### 3.3 未使用変数の警告 - ✅ 一部対応済み

**問題**: `_isSubmitting` など未使用変数が存在

**対応**: ビルドエラーとなった箇所は修正済み

---

## 4. セキュリティ問題

### 4.1 API認証の一貫性 - ✅ 改善済み (2026-01-18)

**問題**: 一部のAPIルートで `'use server'` ディレクティブが誤用され、401エラーが発生

**解決策**: 5つのAPIルートから `'use server'` を削除

**対象ファイル**:
- `app/api/master-data/route.ts`
- `app/api/dispatch/foremen/route.ts`
- `app/api/dispatch/workers/route.ts`
- `app/api/daily-reports/route.ts`
- `app/api/profit-dashboard/route.ts`

---

### 4.2 入力バリデーション - 🔄 作業中

**問題**: クライアント側のバリデーションのみで、サーバー側が不十分

**推奨対応**:
- Zodによるスキーマバリデーション
- サーバー側での入力検証強化

---

### 4.3 Zodバリデーション基盤 - ✅ 作成済み (2026-01-18)

**作成ファイル**: `lib/validations/index.ts`

**実装済みスキーマ**:
- `userRoleSchema` - ユーザーロール
- `createUserSchema` / `updateUserSchema` - ユーザー管理
- `contactPersonSchema` - 担当者情報
- `createCustomerSchema` / `updateCustomerSchema` - 顧客管理
- `constructionTypeSchema` - 工事種別
- `createProjectMasterSchema` / `updateProjectMasterSchema` - 案件マスター
- `workItemSchema` - 作業項目
- `createDailyReportSchema` / `updateDailyReportSchema` - 日報

**ヘルパー関数**:
- `validateRequest<T>()` - 汎用バリデーション関数

---

> [!IMPORTANT]
> ### 🔧 Zod V4 への対応について（別AIへの引き継ぎ情報）
> 
> **発生した問題**: プロジェクトのZodがV4にアップグレードされたため、以下のAPI変更が必要でした。
> 
> **修正箇所** (`lib/validations/index.ts`):
> 
> 1. **`z.enum()` の errorMap パラメータを削除**
>    ```diff
>    - export const userRoleSchema = z.enum([...], {
>    -     errorMap: () => ({ message: 'エラーメッセージ' }),
>    - });
>    + export const userRoleSchema = z.enum([...]);
>    ```
>    Zod V4では `errorMap` の代わりに `error` または `message` を使用します。
> 
> 2. **`result.error.errors` → `result.error.issues` に変更**
>    ```diff
>    - const firstError = result.error.errors[0];
>    - details: result.error.errors,
>    + const issues = result.error.issues;
>    + const firstError = issues[0];
>    + details: issues,
>    ```
> 
> 3. **型定義の変更**
>    ```diff
>    - details?: z.ZodError['errors']
>    + details?: z.ZodIssue[]
>    ```
> 
> **残タスク（別AIで続ける場合）**:
> - 各APIルートでバリデーションスキーマを実際に使用する実装
> - エラーメッセージのカスタマイズが必要な場合は、Zod V4の新しい構文を使用


---

## 5. テスト

### 5.1 テストなし - ⏳ 未対応

**問題**: ユニットテスト、統合テスト、E2Eテストが存在しない

**推奨対応**:
- Jest + React Testing Library でユニットテスト
- Playwright または Cypress でE2Eテスト
- 重要なビジネスロジックのテストカバレッジ確保

---

## 実装パターンリファレンス

### Context遅延読み込みパターン

```typescript
interface ContextType {
    data: T[];
    isLoading: boolean;
    isInitialized: boolean;           // 追加
    ensureDataLoaded: () => Promise<void>;  // 追加
    // ... その他のメソッド
}

// Provider内
const [isInitialized, setIsInitialized] = useState(false);
const [realtimeSetup, setRealtimeSetup] = useState(false);

// 遅延読み込み関数
const ensureDataLoaded = useCallback(async () => {
    if (status === 'authenticated' && !isInitialized) {
        await fetchData();
    }
}, [status, isInitialized, fetchData]);

// 未認証時はリセット
useEffect(() => {
    if (status === 'unauthenticated') {
        setData([]);
        setIsInitialized(false);
    }
}, [status]);

// Realtime subscription（初回データ取得後のみ）
useEffect(() => {
    if (status !== 'authenticated' || !isInitialized || realtimeSetup) return;
    setRealtimeSetup(true);
    // ... subscription setup
}, [status, isInitialized, realtimeSetup, fetchData]);
```

### ページ側での呼び出し

```typescript
const { data, ensureDataLoaded } = useContext();

useEffect(() => {
    ensureDataLoaded();
}, [ensureDataLoaded]);
```

---

## 優先度別改善リスト

### 高優先度
1. ~~Context遅延読み込み~~ ✅
2. ~~日報・ダッシュボード速度改善~~ ✅
3. ~~N+1クエリ修正~~ ✅
4. ~~エラーハンドリング統一~~ ✅
5. ~~ローディング状態統一~~ ✅

### 中優先度
6. ~~バンドルサイズ最適化~~ ✅
7. 入力バリデーション強化
8. TypeScript strict mode

### 低優先度
9. 重複コードリファクタリング
10. モバイルレスポンシブ改善
11. テスト追加

---

## 更新履歴

| 日付 | 内容 | コミット |
|------|------|----------|
| 2026-01-18 | バンドルサイズ最適化（jsPDF動的インポート） | - |
| 2026-01-18 | ローディング状態統一（統一Loadingコンポーネント） | 9cb3413 |
| 2026-01-18 | エラーハンドリング統一（react-hot-toast導入） | 0fa6761 |
| 2026-01-18 | Context遅延読み込み実装 | e97d23a |
| 2026-01-18 | 利益ダッシュボード高速化 | eb6cfc3, e5c35b7 |
| 2026-01-18 | 401エラー修正（'use server'削除） | - |
| 2026-01-16 | 初期パフォーマンス改善（メモ化、デバウンス等） | - |

---

## 次回作業時の開始手順

1. このファイルを確認し、未完了（⏳）タスクを把握
2. 優先度「高」の未完了項目から順に着手
3. 完了したタスクは ✅ に変更
4. 各修正後、`npm run build` で動作確認
5. コミット・プッシュ後、このファイルの更新履歴を追記
