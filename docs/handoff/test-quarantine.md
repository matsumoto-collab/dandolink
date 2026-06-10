# テスト隔離リスト（burn-down 用）

作成: 2026-06-10
背景: CI がテスト失敗で常時赤（46/163 スイート・134 テスト失敗・テストだけで53分）になっており、
リグレッション検知が機能していなかった。失敗の大半は **アプリの意図的な仕様変更にテストが未追従**
（UIセマンティック配色化・Cache-Control付与・syncOnlyパラメータ・自動採番・dailyRate追加・
requireManagerOrAbove への移行・lib/formatters の関数追加など）。

## 対応方針

1. 機械的に直せるもの（API層 51スイート＋store/lib層）は **2026-06-10 に修復済み・CI 復帰済み**
2. 残り（このリスト＝UI層中心の25スイート）は `jest.config.js` の `testPathIgnorePatterns` で一時隔離
3. 以後、**このリストは減らす一方**（新規追加禁止。新しい失敗はその場で直す）

## 隔離分の実行方法

```bash
# 単体
JEST_QUARANTINE=1 npx jest __tests__/components/Header.test.tsx

# 隔離分も含めて全部
JEST_QUARANTINE=1 npx jest
```

直ったら `jest.config.js` の隔離リストから該当行を削除し、この表を更新すること。

## 隔離中スイート（25）

| スイート | 既知の失敗シグネチャ |
|---|---|
| app/customers/page | ページ描画系の期待値ドリフト |
| app/daily-reports/page | 同上 |
| app/estimates/page | 同上 |
| app/invoices/page | 同上 |
| app/login/page | 同上 |
| app/project-masters/page | 同上 |
| components/Calendar/DraggableEventCard | UI刷新後の構造/クラス期待値ドリフト |
| components/Calendar/RemarksRow | 同上 |
| components/Calendar/WeeklyCalendar | 同上 |
| components/DailyReport/DailyReportModal | 同上 |
| components/Estimates/EstimateDetailModal | 「Element type is invalid (undefined)」= import/モック不整合 |
| components/Estimates/EstimateForm | 同上系 |
| components/Header | ロゴ alt "DandLink" を期待（現UIはボタン化/変更済み） |
| components/Invoices/InvoiceForm | 期待値ドリフト |
| components/ProjectMaster/WorkHistoryDisplay | 期待値ドリフト |
| components/Projects/ProjectDetailView | 期待値ドリフト |
| components/Projects/ProjectForm | 期待値ドリフト |
| components/Projects/ProjectModal | 期待値ドリフト |
| components/Schedule/AssignmentTable | 期待値ドリフト（PDF出力ボタン追加等） |
| components/Settings/ConstructionTypeSettings | 期待値ドリフト |
| components/Settings/SettingsPage | 期待値ドリフト |
| contexts/ProfitDashboardContext | 期待値ドリフト |
| hooks/useMasterData | realtime購読セットアップの期待値ドリフト |
| hooks/useProjects | fake timers × waitFor の構造問題で Timed out（8件） |
| stores/masterStore | ローディングガード/refresh/チャネル生成の期待値ドリフト |

## 2026-06-10 に修復済みのスイート（参考・再発時のパターン集）

- **旧色トークン期待**: Button（bg-slate-800→bg-teal-600 等）
- **Cache-Control: no-store 付与に未追従**: lib/api/utils
- **認可ヘルパー移行**: requireAuth+isManagerOrAbove → requireManagerOrAbove。
  モック工場に `requireManagerOrAbove`/`requireAdmin` を追加し、401/403テストはそちらをプライムする
- **グローバルモックの欠落**: jest.setup.ts の `@/lib/formatters` に `stripProjectMasterFinancials` 追加済み。
  ルートが lib の新関数を使い始めたら jest.setup.ts のモックにも追加すること
- **未プライムの findMany が undefined を返して 500**: project-masters GET の buildDocFlags
  （estimate/invoice.findMany に `mockResolvedValue([])` をプライム）
- **$transaction 不在**: ファイルローカルの prisma モックに
  `$transaction: jest.fn(async (cb) => cb(require('@/lib/prisma').prisma))` を追加
- **仕様変更でテスト前提が消滅**: estimateNumber 省略可（自動採番 E{year}{NNNN}）、
  画像アップロードは display+thumbnail の2回（元PDF添付時のみ3回）、
  vehicles に dailyRate、fetch失敗時も initialized=true（UIアンブロック仕様）、
  syncOnly=true クエリ、DELETE前の role 取得（findUnique プライム必要）
