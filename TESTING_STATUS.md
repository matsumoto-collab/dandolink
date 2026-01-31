# テスト環境改善 進捗レポート

**最終更新日**: 2026-01-30

---

## 完了した作業

### Phase 0: テスト環境の基盤整備

| 項目 | 状況 | 詳細 |
|------|------|------|
| Jest設定修正 | ✅ 完了 | e2eディレクトリをjest除外に追加 |
| Playwright設定 | ✅ 完了 | E2Eテスト環境構築 |
| GitHub Actions | ✅ 完了 | CI/CDパイプライン設定 |
| カバレッジ対象拡大 | ✅ 完了 | `lib/`, `stores/` をカバレッジ対象に追加 |

### Phase 0.5: APIテストの実装

| ファイル | テスト数 | 状況 |
|----------|----------|------|
| `__tests__/api/assignments/route.test.ts` | 6 | ✅ 完了 |
| `__tests__/api/project-masters/route.test.ts` | - | ✅ 完了 |
| `__tests__/api/project-masters/id.route.test.ts` | - | ✅ 完了 |
| `__tests__/api/customers/route.test.ts` | - | ✅ 完了 |
| `__tests__/api/invoices/route.test.ts` | - | ✅ 完了 |
| `__tests__/api/estimates/route.test.ts` | - | ✅ 完了 |
| `__tests__/api/daily-reports/route.test.ts` | - | ✅ 完了 |
| `__tests__/api/users/route.test.ts` | - | ✅ 完了 |

### Phase 1: DBリファクタリング

| 項目 | 状況 | 詳細 |
|------|------|------|
| スキーマ変更 | ✅ 完了 | `AssignmentWorker`, `AssignmentVehicle` テーブル追加 |
| APIロジック更新 | ✅ 完了 | GET/POSTでリレーション対応 |
| マイグレーション | ✅ 完了 | 本番DB適用済み |
| Vercel設定 | ✅ 完了 | `DIRECT_URL` 環境変数追加、ビルドコマンド修正 |

### Phase 2: テストカバレッジ向上

**開始時**: 9% → **現在**: 31.31%

#### 追加したテストファイル

| カテゴリ | ファイル | カバレッジ |
|----------|----------|------------|
| Utils | `employeeUtils.test.ts` | 100% |
| Utils | `dateUtils.test.ts` | 98% |
| Lib | `json-utils.test.ts` | 100% |
| Lib | `rate-limit.test.ts` | 83% |
| Contexts | `NavigationContext.test.tsx` | 100% |
| Contexts | `ProfitDashboardContext.test.tsx` | |
| Contexts | `AssignmentContext.test.tsx` | 新規 |
| Stores | `calendarStore.test.ts` | |
| Stores | `financeStore.test.ts` | |
| Hooks | `useCustomers.test.ts` | 新規 |
| Hooks | `useEstimates.test.ts` | 新規 |
| Hooks | `useInvoices.test.ts` | 新規 |
| Hooks | `useDailyReports.test.ts` | 新規 |
| Hooks | `useMasterData.test.ts` | 新規 |
| Hooks | `useProjectMasters.test.ts` | 新規 |
| Hooks | `useVacation.test.ts` | 新規 |
| Hooks | `useRemarks.test.ts` | 新規 |
| Hooks | `useCompany.test.ts` | 新規 |
| Hooks | `useCustomerSearch.test.ts` | 新規 |

#### E2Eテスト

| ファイル | 内容 |
|----------|------|
| `e2e/auth.spec.ts` | 認証フロー |
| `e2e/navigation.spec.ts` | ナビゲーション |
| `e2e/project-creation.spec.ts` | 案件作成 |
| `e2e/assignment-dispatch.spec.ts` | 手配確定 |

---

## 現在の状況

### テスト統計

```
Test Suites: 56 passed
Tests:       645 passed
Coverage:    31.31% (Lines)
```

### カバレッジ詳細

| カテゴリ | カバレッジ | 備考 |
|----------|------------|------|
| utils/ | 78.67% | 良好 |
| lib/api/ | 93.44% | 良好 |
| lib/validations/ | 100% | 良好 |
| lib/ (全体) | 28.39% | auth.ts, profitDashboard.ts が0% |
| hooks/ | ~60% | 10ファイル追加 |
| stores/ | 32.31% | calendarStore, financeStore が22% |
| contexts/ | ~80% | AssignmentContext追加 |
| components/ | 低い | 多くが0% |
| app/api/ | 低い | 36ルート中一部のみ |

---

## これからの作業

### 優先度: 高

#### 1. hooks のテスト追加 (0% → 目標60%)

| ファイル | 行数 | 必要なテスト |
|----------|------|-------------|
| `useCustomers.ts` | 63行 | CRUD操作、状態管理 |
| `useEstimates.ts` | 64行 | CRUD操作、状態管理 |
| `useInvoices.ts` | 84行 | CRUD操作、状態管理 |
| `useDailyReports.ts` | 66行 | CRUD操作 |
| `useMasterData.ts` | 55行 | データ取得 |
| `useProjectMasters.ts` | 73行 | CRUD操作 |
| `useRealtimeSubscription.ts` | 175行 | Supabase連携 |

#### 2. stores のテスト強化 (32% → 目標60%)

| ファイル | 現状 | 必要なテスト |
|----------|------|-------------|
| `calendarStore.ts` | 22% | アクション全般、非同期処理 |
| `financeStore.ts` | 22% | Customer/Estimate/Invoice操作 |

#### 3. contexts/AssignmentContext.tsx (0% → 目標80%)

- 290行の大きなコンテキスト
- 配置管理の核心ロジック

### 優先度: 中

#### 4. components のテスト追加

| 対象 | 必要なテスト |
|------|-------------|
| `components/Calendar/*.tsx` | ドラッグ&ドロップ、表示ロジック |
| `components/Projects/*.tsx` | フォーム操作、モーダル |
| `components/Settings/*.tsx` | 設定変更 |

#### 5. 残りのAPIルートテスト

現在36ルート中8ルートのみテスト済み。残り28ルート：
- `calendar/vacations`
- `calendar/remarks`
- `master-data/*`
- `dispatch/*`
- `profit-dashboard`
- など

### 優先度: 低

#### 6. DBリファクタリング Phase 2

残っているJSONフィールドのリレーション化：
- `confirmedWorkerIds` / `confirmedVehicleIds`
- `User.assignedProjects`
- `Customer.contactPersons`
- `Estimate.items`

---

## テスト実行コマンド

```bash
# ユニットテスト実行
npm test

# カバレッジ付きで実行
npm run test:coverage

# E2Eテスト実行
npm run test:e2e

# 特定ファイルのテスト
npm test -- __tests__/api/assignments
```

---

## 目標

| マイルストーン | カバレッジ目標 | 状況 |
|---------------|---------------|------|
| Phase 1 | 20% | ✅ 達成 (24%) |
| Phase 2 | 40% | 🔄 進行中 |
| Phase 3 | 60% | 未着手 |
| 最終目標 | 80% | 未着手 |

---

## 注意事項

1. **テスト実行前にdev serverを停止する必要はない**（Jestは独立して動作）
2. **E2Eテストはdev serverが必要**（port 3001）
3. **Prismaモックが必要なテストは複雑**になるため、純粋関数を優先してテスト
4. **CI/CDでテストが失敗するとデプロイがブロックされる**
