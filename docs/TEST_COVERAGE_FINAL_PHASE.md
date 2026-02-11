# Final Phase テストカバレッジ作業指示書

> **現状**: Lines **44.86%** (773テスト / 73スイート)
> **目標**: Lines **80%**
> **作業対象**: 未テスト・低カバレッジのファイル群

---

## 前提知識

### 環境セットアップ
```bash
npm install        # 依存関係インストール
npm test           # テスト実行（全件）
npm run test:coverage  # カバレッジ付き実行
```

### 必読ドキュメント
| ファイル | 内容 |
|---------|------|
| `docs/TESTING_HANDOFF.md` | テストパターン・規約の詳細（**最初に必ず読むこと**） |
| `docs/TEST_FIX_GUIDE.md` | テストが通らない場合のトラブルシューティング |
| `jest.setup.ts` | グローバルモック設定 |

### テストの基本ルール
- テストファイルの配置: `__tests__/<レイヤー>/<ファイル名>.test.ts(x)`
- テスト名は**日本語**で書く（既存テストに合わせる）
- モックは最小限にする（`jest.setup.ts` のグローバルモックを活用する）
- `beforeEach` で `jest.clearAllMocks()` を必ず呼ぶ
- 各テストは他のテストに依存しないように書く

### 参考にすべき既存テスト
| パターン | 参考ファイル |
|---------|------------|
| APIルート | `__tests__/api/assignments/route.test.ts` |
| コンポーネント | `__tests__/components/Projects/ProjectForm.test.tsx` |
| Zustandストア | `__tests__/stores/calendarStore.test.ts` |
| カスタムフック | `__tests__/hooks/useCustomers.test.ts` |

---

## 作業の進め方

1. **Batch 単位で作業する**（1 Batch = 3〜5ファイル）
2. 着手前に「どのファイルに何のテストを書くか」を箇条書きで報告する
3. テストを書いたら `npx jest --coverage` で確認する
4. **Batch ごとにコミット・プッシュする**（1つのコミットに詰め込みすぎない）

### カバレッジ確認コマンド
```bash
# 全体カバレッジ
npx jest --coverage

# 特定ファイルのカバレッジだけ確認（高速）
npx jest --coverage --collectCoverageFrom='app/api/customers/\[id\]/route.ts' __tests__/api/customers/

# 特定テストだけ実行（カバレッジなし・高速）
npx jest --no-coverage __tests__/api/master-data/route.test.ts
```

---

## Batch 1: API ルート — 個別操作系（効果 大 / 難易度 低）

**既にuntrackedで存在するテストファイルがあるので、まず動作確認してコミットすること。**

### 1-A. 既存テストファイルの確認・コミット
以下のファイルは既に作成済み（untracked）。テストが通ることを確認してコミットする。

| テストファイル | 対象ソース |
|--------------|-----------|
| `__tests__/api/assignments/[id]/route.test.ts` | `app/api/assignments/[id]/route.ts` (63行) |
| `__tests__/api/assignments/batch/route.test.ts` | `app/api/assignments/batch/route.ts` (43行) |
| `__tests__/api/assignments/batch-create/route.test.ts` | `app/api/assignments/batch-create/route.ts` (28行) |
| `__tests__/api/master-data/route.test.ts` | `app/api/master-data/route.ts` (10行) |
| `__tests__/api/master-data/vehicles/route.test.ts` | `app/api/master-data/vehicles/route.ts` |
| `__tests__/api/master-data/vehicles/[id]/route.test.ts` | `app/api/master-data/vehicles/[id]/route.ts` |
| `__tests__/api/master-data/workers/route.test.ts` | `app/api/master-data/workers/route.ts` |
| `__tests__/api/master-data/workers/[id]/route.test.ts` | `app/api/master-data/workers/[id]/route.ts` |

```bash
# 確認手順
npx jest --no-coverage __tests__/api/assignments/[id]/ __tests__/api/assignments/batch/ __tests__/api/assignments/batch-create/ __tests__/api/master-data/
```

### 1-B. 新規作成が必要なAPIテスト
| 対象ソース | 行数 | テスト観点 |
|-----------|------|----------|
| `app/api/customers/[id]/route.ts` | 105 | GET/PUT/DELETE、バリデーション、認証 |
| `app/api/estimates/[id]/route.ts` | 57 | GET/PUT/DELETE、バリデーション |
| `app/api/invoices/[id]/route.ts` | 59 | GET/PUT/DELETE、バリデーション |
| `app/api/daily-reports/[id]/route.ts` | 45 | GET/PUT/DELETE |
| `app/api/users/[id]/route.ts` | 78 | GET/PUT/DELETE、権限チェック |

**最低限カバーするケース（各ルートで共通）**:
- ✅ 正常系（200/201）
- ✅ バリデーションエラー（400）
- ✅ 認証エラー（401）— `requireAuth` が例外を投げる場合
- ✅ 存在しないID（404）
- ✅ サーバーエラー（500）— Prisma が例外を投げる場合

---

## Batch 2: API ルート — マスターデータ系（効果 中 / 難易度 低）

| 対象ソース | 行数 | テスト観点 |
|-----------|------|----------|
| `app/api/master-data/managers/route.ts` | 30 | GET/POST |
| `app/api/master-data/managers/[id]/route.ts` | 38 | PUT/DELETE |
| `app/api/master-data/construction-types/route.ts` | 67 | GET/POST |
| `app/api/master-data/construction-types/[id]/route.ts` | 63 | PUT/DELETE |
| `app/api/master-data/unit-prices/route.ts` | 39 | GET/POST |
| `app/api/master-data/unit-prices/[id]/route.ts` | 44 | PUT/DELETE |
| `app/api/master-data/company/route.ts` | 41 | GET/PUT |
| `app/api/master-data/settings/route.ts` | 35 | GET/PUT |

---

## Batch 3: API ルート — カレンダー・手配・その他（効果 中 / 難易度 低）

| 対象ソース | 行数 | テスト観点 |
|-----------|------|----------|
| `app/api/calendar/vacations/route.ts` | 45 | GET/POST/DELETE |
| `app/api/calendar/remarks/route.ts` | 37 | GET/PUT |
| `app/api/dispatch/workers/route.ts` | 25 | GET |
| `app/api/dispatch/foremen/route.ts` | 25 | GET |
| `app/api/user-settings/route.ts` | 33 | GET/PUT |
| `app/api/project-masters/[id]/history/route.ts` | 55 | GET |
| `app/api/project-masters/[id]/profit/route.ts` | 92 | GET、計算ロジック |
| `app/api/profit-dashboard/route.ts` | 136 | GET、集計ロジック |

---

## Batch 4: lib — ビジネスロジック（効果 大 / 難易度 中）

| 対象ソース | 行数 | 現カバレッジ | テスト観点 |
|-----------|------|------------|----------|
| `lib/profitDashboard.ts` | 240 | 0% | 収益計算ロジック。純粋関数が多いのでテストしやすい |
| `lib/auth.ts` | 116 | 0% | NextAuth設定。コールバック関数のロジックをテスト |
| `lib/api/utils.ts` | 299 | 70% | 未カバー分岐（エラーハンドリング等）を追加 |

**注意**: `lib/prisma.ts` と `lib/supabase.ts` はクライアント初期化のみなのでテスト不要。

---

## Batch 5: stores — 分岐カバレッジ強化（効果 大 / 難易度 低）

| 対象ソース | 行数 | 現カバレッジ | Branch |
|-----------|------|------------|--------|
| `stores/calendarStore.ts` | 500+ | 48.97% | 29.38% |
| `stores/financeStore.ts` | 503 | 72.04% | 31.25% |
| `stores/masterStore.ts` | — | 72.82% | 39.28% |

**重点的にテストすべき分岐**:
- fetch失敗時のエラーハンドリング（`try-catch` の `catch` ブロック）
- 楽観的更新のロールバック（API失敗時に元の状態に戻るか）
- ローディング中の二重呼び出し防止
- `null` / `undefined` のフォールバック（`??` 演算子の分岐）
- Date文字列→Dateオブジェクト変換

---

## Batch 6: hooks — 低カバレッジ分の補強（効果 中 / 難易度 低）

| 対象ソース | 行数 | 現カバレッジ | テスト観点 |
|-----------|------|------------|----------|
| `hooks/useUnitPriceMaster.ts` | 76 | 0% | CRUD操作、fetch/add/update/delete |
| `hooks/usePostalCodeAutofill.ts` | 35 | 25% | API呼び出し、エラー時のフォールバック |
| `hooks/useAssignmentPresence.ts` | 150 | 55.93% | Supabaseチャンネル、状態更新 |
| `hooks/useRealtimeSubscription.ts` | 146 | 64.4% | 未カバー分岐の追加 |
| `hooks/useCalendarModals.ts` | 144 | 76.19% | 未カバー分岐の追加 |

---

## Batch 7: コンポーネント — Settings 系（効果 中 / 難易度 中）

| 対象ソース | 行数 | 現カバレッジ | テスト観点 |
|-----------|------|------------|----------|
| `components/Settings/CompanyInfoSettings.tsx` | 312 | 0% | フォーム表示、編集、保存 |
| `components/Settings/ConstructionTypeSettings.tsx` | 315 | 0% | 一覧表示、追加・編集・削除 |
| `components/Settings/UnitPriceMasterSettings.tsx` | 274 | 0% | 一覧表示、追加・編集・削除 |
| `components/Settings/UserModal.tsx` | 235 | 0% | フォーム表示、バリデーション、送信 |

---

## Batch 8: コンポーネント — Calendar 系（効果 大 / 難易度 中〜高）

| 対象ソース | 行数 | 現カバレッジ | テスト観点 |
|-----------|------|------------|----------|
| `components/Calendar/EmployeeRowComponent.tsx` | 159 | 0% | 行表示、イベント処理 |
| `components/Calendar/DispatchConfirmModal.tsx` | 304 | 0% | モーダル表示、確認・送信 |
| `components/Calendar/CopyAssignmentModal.tsx` | 215 | 30.61% | コピー操作、日付選択 |
| `components/Calendar/VacationSelector.tsx` | 107 | 0% | 休暇選択UI |
| `components/Calendar/RemarksRow.tsx` | 112 | 0% | 備考行表示・編集 |
| `components/Calendar/MobileDayView.tsx` | 200 | 0% | モバイル表示 |

---

## Batch 9: コンポーネント — Projects・Schedule・PDF（効果 中 / 難易度 中〜高）

| 対象ソース | 行数 | 現カバレッジ | テスト観点 |
|-----------|------|------------|----------|
| `components/Projects/ProjectDetailView.tsx` | 299 | 0% | 案件詳細表示 |
| `components/Projects/MultiDayScheduleEditor.tsx` | 349 | 4.68% | 複数日スケジュール登録 |
| `components/Schedule/AssignmentTable.tsx` | 375 | 0% | 配置一覧表示 |
| `components/DailyReport/DailyReportForm.tsx` | 301 | 0% | 日報フォーム |
| `components/ProjectMasters/sections/ScaffoldingSection.tsx` | 284 | 8.82% | 足場セクション |

**PDF系**（`components/pdf/`）は行数が多い（計1,206行）がロジックが少ないので優先度低。
80%に届かない場合のみ着手する。

---

## 作業の優先度まとめ

| 優先度 | Batch | 対象 | 推定テスト数 | 理由 |
|-------|-------|-----|------------|------|
| ★★★ | 1 | API（個別操作系） | 40〜50 | 効果大・難易度低・一部作成済み |
| ★★★ | 2 | API（マスターデータ系） | 40〜50 | 効果大・難易度低・パターン同一 |
| ★★★ | 4 | lib（profitDashboard, auth） | 30〜40 | 行数多い・ビジネスロジック |
| ★★★ | 5 | stores 分岐強化 | 20〜30 | Branch 30%→70% で大幅改善 |
| ★★☆ | 3 | API（カレンダー・手配等） | 30〜40 | 効果中・難易度低 |
| ★★☆ | 6 | hooks 補強 | 15〜20 | 小さいが確実にカバレッジ向上 |
| ★★☆ | 7 | Settings コンポーネント | 20〜30 | UIテスト・難易度中 |
| ★☆☆ | 8 | Calendar コンポーネント | 30〜40 | 難易度高め・DnD連携あり |
| ★☆☆ | 9 | Projects・Schedule・PDF | 20〜30 | 80%未達の場合のみ |

**Batch 1〜6 を完了すれば 70〜75% 程度に到達する見込み。**
**Batch 7〜8 まで完了すれば 80% 達成の見込み。**

---

## 注意事項

- **1 Batch 終わるごとにカバレッジを計測して報告すること**
- テストが通らない場合は `docs/TEST_FIX_GUIDE.md` を参照
- コミットメッセージは `test: <対象の説明>` の形式で統一する
- **`main` ブランチに直接プッシュ**する（このプロジェクトのフロー）
- 不明点があれば Batch 着手前の方針報告で相談すること
