# YuSystem パフォーマンス改善計画

**最終更新**: 2026-01-19
**総合評価（改善前）**: 65/100

---

## 改善状況サマリー

| カテゴリ | 完了 | 未完了 |
|---------|------|--------|
| パフォーマンス | 7 | 0 |
| UI/UX | 3 | 0 |
| コード品質 | 4 | 0 |
| セキュリティ | 2 | 0 |
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


### 1.10 WeeklyCalendar日付範囲フィルタリング - ✅ 改善済み (2026-01-19)

**問題**: `ProjectContext` が全期間の配置データを取得し、カレンダー表示が遅い

**解決策**: 表示週 ± 1週のみフェッチ

**変更内容**:
- `contexts/ProjectContext.tsx` - `fetchForDateRange()` メソッド追加、日付範囲パラメータ対応
- `components/Calendar/WeeklyCalendar.tsx` - 週変更時に日付範囲を指定してフェッチ

**期待効果**:
- APIレスポンスサイズの大幅削減
- 初期読み込み速度の改善

---

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

### 2.3 モバイルレスポンシブ - ✅ Phase3完了 (2026-01-19)

**問題**: デスクトップ優先で設計されており、モバイルでの使い勝手が悪い

**Phase1で実装した内容** (2026-01-18):
- `hooks/useIsMobile.ts` - モバイル判定フック（カスタムブレークポイント対応）
- `components/Calendar/MobileDayView.tsx` - モバイル専用1日表示コンポーネント
- `components/Calendar/WeeklyCalendar.tsx` - モバイル/デスクトップ自動切替

**モバイル専用機能**:
- 1日表示モード（1024px未満で自動切替）
- 職長ごとの縦スクロール表示
- タップしやすい大きなイベントカード
- 日付ナビゲーション（前日/次日/今日）
- フローティング追加ボタン（右下の「+」）

**Phase2: 横スクロール式週間カレンダー (2026-01-18)**:
- 1日表示モードを削除し、デスクトップと同じ週間グリッドをモバイルにも適用
- 列幅を140px→100pxに縮小してスクロール量を削減
- 職長列は`position: sticky`で固定（左端に常時表示）
- 対象ファイル: `WeeklyCalendar.tsx`, `RemarksRow.tsx`, `DroppableCell.tsx`

**Phase3: テーブルのモバイルカード対応 (2026-01-19)**:
- テーブル形式のページをモバイルではカードレイアウトに自動切替
- `md:hidden` / `hidden md:block` でレスポンシブ切替
- ツールバー（検索・フィルター・ボタン）のモバイル対応

**対象ファイル**:
- `app/estimates/page.tsx` - 見積書一覧（モバイルカード追加）
- `app/invoices/page.tsx` - 請求書一覧（統計カードも2列対応）
- `app/daily-reports/page.tsx` - 日報一覧（モバイルカード追加）
- `app/projects/page.tsx` - 案件一覧（モバイルカード追加）

**モバイルカードの特徴**:
- 主要情報を縦に配置（タイトル、金額、ステータス、日付）
- 編集・削除ボタンをカード右上に配置（タップしやすいサイズ）
- ステータスバッジはデスクトップと同じデザインを維持
- 新規追加ボタンのテキストを短縮（例: 「新規見積書作成」→「新規作成」）

**今後の改善**:
- タッチ操作の最適化（スワイプジェスチャー）
- フォントサイズ・間隔の微調整

---

## 3. コード品質問題

### 3.1 TypeScript strict mode - ✅ 改善済み (2026-01-19)

**問題**: `any` 型が多用されている（38箇所）

**解決策**: すべての `: any` 型注釈と `as any` キャストを適切な型に置き換え

**変更内容**:
- **Supabase RealtimeChannel型**: 8つのContextファイルで `any` → `RealtimeChannel | null`
  - `VacationContext.tsx`, `UnitPriceMasterContext.tsx`, `EstimateContext.tsx`
  - `ProjectContext.tsx`, `RemarksContext.tsx`, `CustomerContext.tsx`
  - `MasterDataContext.tsx`, `CompanyContext.tsx`, `InvoiceContext.tsx`
- **Prisma結果型**: APIルートで明示的な型注釈を削除し、Prismaの推論型を使用
  - `app/api/estimates/route.ts`, `app/api/invoices/route.ts`, `app/api/customers/route.ts`
- **DnD Kit イベント型**: `DragStartEvent`, `DragEndEvent`, `DragOverEvent` を使用
  - `hooks/useDragAndDrop.ts`
- **jsPDF型**: `jsPDF` 型をインポートして使用
  - `utils/fonts/japanese.ts`
- **フォーム入力型**: 適切なユニオン型に置き換え
  - `components/Estimates/EstimateForm.tsx`, `components/Invoices/InvoiceForm.tsx`
- **権限チェック型**: `PermissionUser` インターフェースを作成してNextAuthセッションと互換性を確保
  - `utils/permissions.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`
- **ローカルストレージ型**: `unknown` 型を使用
  - `hooks/useLocalStorage.ts`
- **ページコンポーネント型**: 適切な型をインポート
  - `app/customers/page.tsx` - `CustomerInput`

---

### 3.2 as any キャストの排除 - ✅ 改善済み (2026-01-18)

**問題**: 型アサーション `as any` がコードベースに残存

**解決策**: 適切な型定義を追加し、型安全なキャストに置換

**変更内容**:
- `types/calendar.ts`: `ProjectStatus` 型を新規追加・エクスポート
- `components/Projects/ProjectForm.tsx`: `as any` → `as ProjectStatus`
- `app/profit-dashboard/page.tsx`: `as any` → `SerializedProjectProfit[]` 型注釈
- `app/profit-dashboard/components/ProfitDashboardClient.tsx`: `SerializedProjectProfit` 型をエクスポート
- `utils/permissions.ts`: 未使用 `User` インポートを削除

**コミット**: `fb56352`

---

### 3.3 重複コード - ✅ 一部改善済み (2026-01-19)

**問題**: 同様のCRUD処理が各Contextで重複（約2,300行の重複コード）

**解決策**: 共通ユーティリティとフックを作成

**新規作成ファイル**:
- `lib/api/utils.ts` - API共通ユーティリティ
  - `requireAuth()` - 認証チェック（30箇所の重複を統一）
  - `errorResponse()`, `notFoundResponse()`, `serverErrorResponse()` - エラーレスポンス
  - `parseJsonField()`, `stringifyJsonField()` - JSONフィールド処理
- `hooks/useRealtimeSubscription.ts` - Supabase Realtime購読フック
  - `useRealtimeSubscription()` - 単一テーブル用（12箇所の重複を統一可能）
  - `useMultipleRealtimeSubscriptions()` - 複数テーブル用

**適用済みファイル**:
- `app/api/customers/route.ts` - 132行→106行（-20%）
- `app/api/customers/[id]/route.ts` - 123行→99行（-20%）
- `contexts/CustomerContext.tsx` - 215行→159行（-26%）

**残りの適用対象**:
- 他のAPIルート（estimates, invoices, assignments等）
- 他のContext（EstimateContext, InvoiceContext等）

---

### 3.4 未使用変数の警告 - ✅ 一部対応済み

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

### 4.2 入力バリデーション - ✅ 改善済み (2026-01-18)

**問題**: クライアント側のバリデーションのみで、サーバー側が不十分

**解決策**: Zodによるスキーマバリデーションをサーバー側に実装

**適用済みAPIルート**:
- `app/api/users/route.ts` - POST (ユーザー作成)
- `app/api/users/[id]/route.ts` - PATCH (ユーザー更新)
- `app/api/customers/route.ts` - POST (顧客作成)
- `app/api/customers/[id]/route.ts` - PATCH (顧客更新)

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
6. ~~モバイルUI/UX改善~~ ✅（Phase3完了）

### 中優先度
7. ~~バンドルサイズ最適化~~ ✅
8. ~~入力バリデーション強化~~ ✅
9. ~~TypeScript strict mode~~ ✅
10. SWR / React Query 導入（複数タブ間キャッシュ共有）

### 低優先度
11. ~~重複コードリファクタリング~~ ✅（一部完了）
12. テスト追加

---

## 追加の速度改善案（後日検討）

> [!NOTE]
> 2026-01-18の改善（Cache-Control、DBインデックス）では体感的な改善が見られなかったため、以下の追加施策を検討

1. **SWR / React Query 導入**
   - クライアントキャッシュの高度化
   - バックグラウンド再検証
   - 複数タブ間でのキャッシュ共有

2. **日付範囲フィルタリング**
   - WeeklyCalendarで表示週のみ取得
   - ※ Realtimeとの競合を検討要

3. **Redisキャッシュ（Upstash）**
   - サーバー間でのキャッシュ共有
   - DBアクセスの大幅削減

4. **Prisma select 最適化**
   - 必要フィールドのみ取得
   - レスポンスサイズの削減

---

## 更新履歴

| 日付 | 内容 | コミット |
|------|------|----------|
| 2026-01-19 | カレンダー読み込み時の点滅修正（useRefでコールバック安定化） | a073877 |
| 2026-01-19 | WeeklyCalendar日付範囲フィルタリング実装（表示週±1週のみフェッチ） | 0df9a6c |
| 2026-01-19 | モバイルUI/UX Phase3（見積書・請求書・日報のカードレイアウト対応） | - |
| 2026-01-19 | 重複コード削減（API共通ユーティリティ、useRealtimeSubscriptionフック） | 622df15 |
| 2026-01-19 | TypeScript any型完全排除（38箇所修正、RealtimeChannel型、PermissionUser型等） | fb56352 |
| 2026-01-18 | as anyキャスト解消（ProjectStatus, SerializedProjectProfit型追加） | fb56352 |
| 2026-01-18 | Zodバリデーション適用（users, customers API） | - |
| 2026-01-18 | バンドルサイズ最適化（jsPDF動的インポート） | f401249 |
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
