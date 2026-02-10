# テストカバレッジ改善計画

> **目標**: Lines カバレッジを **41% → 80%** に引き上げる
> **現状**: 65スイート / 712テスト / Lines 41%

---

## 現状のカバレッジ（レイヤー別）

| レイヤー | Lines | 状況 |
|---------|-------|------|
| **hooks/** | 80% | ほぼ十分。個別に低いものだけ補強 |
| **utils/** | 79% | ほぼ十分 |
| **lib/** | 33% | 不足 |
| **stores/** | 59% | 中程度。分岐カバレッジが低い |
| **components/** | 26% | 大幅に不足 |
| **app/api/（テスト済み）** | 82〜95% | 十分 |
| **app/api/（未テスト）** | 0% | 未着手が多い |
| **app/（ページ）** | 0% | 未着手 |

---

## 進め方

以下の **Phase 1〜4** の順に取り組んでください。
各 Phase で **自分の実装方針をレビュー依頼** してから着手してください。

### やること
1. 対象ファイルのソースコードを読む
2. 「どんなテストを書くか」をリストにまとめる
3. レビューを受けてからテストコードを書く
4. `npx jest --coverage` でカバレッジを確認する

### テストを書くときのルール
- 既存テスト（`__tests__/` 配下）のファイル構造・命名規則を踏襲する
- テストファイルの配置: `__tests__/<レイヤー>/<ファイル名>.test.ts(x)`
- モックは最小限にする（既存テストのモックパターンを参考にする）
- 日本語でテスト名を書く（既存テストに合わせる）

---

## Phase 1: API ルート（未テスト分）— 効果 大 / 難易度 低

**対象**: `app/api/` 配下でカバレッジ 0% のルート

| 対象ディレクトリ | ファイル | 概要 |
|----------------|---------|------|
| `app/api/assignments/[id]` | route.ts | 配置の更新・削除 |
| `app/api/assignments/batch` | route.ts | 一括更新 |
| `app/api/assignments/batch-create` | route.ts | 一括作成 |
| `app/api/master-data` | route.ts | マスターデータ取得 |
| `app/api/master-data/vehicles` | route.ts | 車両 CRUD |
| `app/api/master-data/vehicles/[id]` | route.ts | 車両 個別操作 |
| `app/api/master-data/workers` | route.ts | 作業員 CRUD |
| `app/api/master-data/workers/[id]` | route.ts | 作業員 個別操作 |
| `app/api/master-data/managers` | route.ts | 職長 CRUD |
| `app/api/master-data/managers/[id]` | route.ts | 職長 個別操作 |
| `app/api/master-data/construction-types` | route.ts | 工事種別 CRUD |
| `app/api/master-data/construction-types/[id]` | route.ts | 工事種別 個別操作 |
| `app/api/master-data/settings` | route.ts | 設定更新 |
| `app/api/master-data/unit-prices` | route.ts | 単価 CRUD |
| `app/api/master-data/unit-prices/[id]` | route.ts | 単価 個別操作 |
| `app/api/master-data/company` | route.ts | 会社情報 |
| `app/api/customers/[id]` | route.ts | 顧客 個別操作 |
| `app/api/daily-reports/[id]` | route.ts | 日報 個別操作 |
| `app/api/estimates/[id]` | route.ts | 見積 個別操作 |
| `app/api/invoices/[id]` | route.ts | 請求書 個別操作 |
| `app/api/users/[id]` | route.ts | ユーザー 個別操作 |
| `app/api/user-settings` | route.ts | ユーザー設定 |
| `app/api/calendar/remarks` | route.ts | カレンダー備考 |
| `app/api/calendar/vacations` | route.ts | 休暇管理 |
| `app/api/dispatch/foremen` | route.ts | 手配（職長） |
| `app/api/dispatch/workers` | route.ts | 手配（作業員） |
| `app/api/profit-dashboard` | route.ts | 収益ダッシュボード |
| `app/api/project-masters/[id]/history` | route.ts | 案件履歴 |
| `app/api/project-masters/[id]/profit` | route.ts | 案件収益 |
| `app/api/init-db` | route.ts | DB初期化 |

**参考にすべき既存テスト**: `__tests__/api/assignments/route.test.ts`

**テストの書き方のポイント**:
- `prisma` をモック化して DB アクセスなしでテスト可能
- `requireAuth`, `applyRateLimit` もモック化済みのパターンがある
- 正常系（200）、バリデーションエラー（400）、認証エラー（401）、権限エラー（403）を最低限カバーする

---

## Phase 2: stores の分岐カバレッジ強化 — 効果 中 / 難易度 低

**対象**: `stores/calendarStore.ts`, `stores/masterStore.ts`, `stores/financeStore.ts`

現在の stores カバレッジは Lines 59% だが **Branches が 31%** と低い。
エラーハンドリングや条件分岐のテストが不足している。

**やること**:
- 各ストアのソースコードを読み、`if` / `try-catch` / `??` の分岐を洗い出す
- fetch 失敗時、データ不正時、ローディング中の二重呼び出し等のケースを追加する

---

## Phase 3: コンポーネント — 効果 大 / 難易度 中

**対象**: `components/` 配下（Lines 26%）

優先度の高いもの：

| コンポーネント | 現状 Lines | 備考 |
|--------------|-----------|------|
| `components/Settings/` | 13% | ユーザー管理画面 |
| `components/Estimates/` | 29% | 見積関連 |
| `components/Calendar/` | 34% | カレンダー本体 |
| `components/DailyReport/` | 49% | 日報 |
| `components/Projects/` | 48% | 案件フォーム |
| `components/ProjectMasters/sections/` | 40% | 案件マスター詳細 |
| `components/Schedule/` | 0% | スケジュール |
| `components/pdf/` | 0% | PDF生成 |

**テストの書き方のポイント**:
- `render()` + `screen.getByXxx()` で表示を確認
- `userEvent` でユーザー操作をシミュレート
- 外部フック（`useMasterData`, `useProjects` 等）は `jest.mock()` でモック化
- 参考: `__tests__/components/Projects/ProjectForm.test.tsx`

---

## Phase 4: lib の強化 — 効果 中 / 難易度 低〜中

**対象**: `lib/` 配下（Lines 34%）

主に以下が未テスト：
- `lib/prisma.ts` — Prisma クライアント初期化（テスト不要の可能性あり）
- `lib/supabase.ts` — Supabase クライアント初期化（テスト不要の可能性あり）
- `lib/auth.ts` — 認証設定
- `lib/api/utils.ts` の未カバー分岐（Lines 70%）

---

## カバレッジ確認コマンド

```bash
# 全体カバレッジ
npx jest --coverage

# 特定ファイルのカバレッジ
npx jest --coverage --collectCoverageFrom='app/api/assignments/\[id\]/route.ts' __tests__/api/assignments/

# 特定テストだけ実行
npx jest --no-coverage __tests__/api/master-data/route.test.ts
```

---

## 期待するアウトプット（Phase ごと）

各 Phase で以下を提出してください：

1. **テスト方針書**（着手前）
   - どのファイルに対して何をテストするか
   - テストケースの一覧（箇条書きでOK）
2. **テストコード**（実装後）
   - PR として提出
3. **カバレッジレポート**（実装後）
   - `npx jest --coverage` の結果スクリーンショット

---

## 注意事項

- **Phase 1 が最もコスパが良い**ので最優先で進めてください
- 1つの PR に詰め込みすぎず、API ルート 3〜5 個ずつ程度で PR を分けてください
- テストが通らない場合は `docs/TEST_FIX_GUIDE.md` のトラブルシューティングを参考にしてください
- 不明点があれば Phase ごとの方針書の段階で相談してください
