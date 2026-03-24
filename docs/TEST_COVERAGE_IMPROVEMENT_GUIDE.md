# テストカバレッジ改善 指示書

**作成日**: 2026-03-12
**対象者**: 新人SE
**目的**: 重要度の高いファイルからテストカバレッジを段階的に改善する

---

## 現状サマリー

| 指標 | 値 |
|------|-----|
| テストスイート数 | 125（全PASS） |
| テストケース数 | 1,181（全PASS） |
| 全ファイル数（計測対象） | 206 |
| カバレッジ50%未満のファイル | 67 |

---

## 作業の進め方

### 環境準備
```bash
# テスト実行（カバレッジなし・高速）
npx jest --no-coverage

# 特定ファイルのテスト実行
npx jest __tests__/stores/calendarSlices/cellRemarkSlice.test.ts

# カバレッジ付きで実行（全体）
npx jest --coverage

# 特定ファイルのカバレッジを確認
npx jest --coverage --collectCoverageFrom='stores/calendarSlices/cellRemarkSlice.ts'
```

### テスト作成のルール

1. **テストファイルの配置**: `__tests__/` 配下に、ソースと同じディレクトリ構造で配置する
   - 例: `stores/calendarSlices/cellRemarkSlice.ts` → `__tests__/stores/calendarSlices/cellRemarkSlice.test.ts`

2. **グローバルモック**: `jest.setup.ts` に以下が定義済み。テストファイルで再定義しないこと
   - `lucide-react`（Proxy方式で全アイコン対応済み）
   - `next/image`, `next/navigation`, `next-auth/react`
   - `@/lib/prisma`（Prisma全モデル）
   - `@/lib/api/utils`（認証・レート制限）
   - `@/utils/permissions`
   - `@/lib/formatters`
   - `uuid`
   - `NotoSansJP-font`

3. **テスト内でモックを上書きする場合**: `jest.mock()` でファイル単位、または `jest.spyOn()` でテスト単位で上書きする

4. **既存テストを壊さない**: 新規テスト追加後、必ず全テスト実行して確認する

---

## 優先度別タスク一覧

### Priority 1（高）: ビジネスロジックの中核

最もバグが発生しやすく、影響範囲が大きい領域。最優先で対応する。

#### Task 1-1: `stores/calendarSlices/` のSlice群

カレンダー・手配表の状態管理。アプリの中核機能。

| ファイル | 行カバレッジ | 分岐カバレッジ | 目標 |
|---------|------------|--------------|------|
| `cellRemarkSlice.ts` | 18% | 0% | 80%+ |
| `remarkSlice.ts` | 20% | 0% | 80%+ |
| `types.ts` | 31% | 0% | 80%+ |
| `vacationSlice.ts` | 45% | 30% | 80%+ |
| `assignmentSlice.ts` | 59% | 52% | 80%+ |
| `dailyReportSlice.ts` | 61% | 41% | 80%+ |
| `foremanSlice.ts` | 77% | 63% | 80%+ |
| `projectMasterSlice.ts` | 78% | 37% | 80%+ |

**やること**:
- 各Sliceの全アクション（fetch, create, update, delete）をテストする
- 特にエラーハンドリングパス（fetch失敗時、ネットワークエラー時）を重点的にテストする
- `assignmentSlice.ts` の `addProject()` で `assignmentCount` が同期されることを確認するテストを追加する

**テストの書き方（例: cellRemarkSlice）**:
```typescript
// __tests__/stores/calendarSlices/cellRemarkSlice.test.ts
import { useCalendarStore } from '@/stores/calendarStore';

// fetchをモック
global.fetch = jest.fn();

describe('cellRemarkSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ストアをリセット
    useCalendarStore.setState({ cellRemarks: [], cellRemarksInitialized: false });
  });

  describe('fetchCellRemarks', () => {
    it('正常にセル備考を取得できる', async () => {
      const mockRemarks = [{ id: '1', date: '2026-03-12', content: 'テスト' }];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRemarks),
      });

      const { fetchCellRemarks } = useCalendarStore.getState();
      await fetchCellRemarks('2026-03-10', '2026-03-16');

      const state = useCalendarStore.getState();
      expect(state.cellRemarks).toEqual(mockRemarks);
    });

    it('fetch失敗時にエラーログを出力する', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { fetchCellRemarks } = useCalendarStore.getState();
      await fetchCellRemarks('2026-03-10', '2026-03-16');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
```

---

#### Task 1-2: `hooks/useProjects.ts`

カレンダーの案件データ管理Hook。カバレッジ58%、分岐27%。

| ファイル | 行カバレッジ | 分岐カバレッジ | 目標 |
|---------|------------|--------------|------|
| `useProjects.ts` | 58% | 27% | 75%+ |

**やること**:
- `addProject`, `updateProject`, `deleteProject` の正常系・異常系テスト
- Supabase Realtimeのブロードキャスト送信が呼ばれることの確認
- バッチ作成時の動作テスト
- 未カバーの行（89-115, 135-184, 212-227等）に対応するテストを追加

---

#### Task 1-3: `lib/auth.ts`

認証ロジック。カバレッジ43%。

| ファイル | 行カバレッジ | 分岐カバレッジ | 目標 |
|---------|------------|--------------|------|
| `auth.ts` | 43% | 38% | 70%+ |

**やること**:
- NextAuthのcallbacks（`jwt`, `session`, `signIn`）のテスト
- 無効なユーザー（非アクティブ、存在しない）でのサインイン拒否テスト
- セッション情報にユーザーロール・IDが正しく含まれることの確認

**注意**: Prismaはグローバルモック済みなので、`prisma.user.findUnique` の戻り値を `mockResolvedValue` で設定する

---

### Priority 2（中）: APIルート（0%のもの）

テストが全く存在しないAPIルート。新規テスト作成が必要。

| ファイル | 行カバレッジ | 内容 |
|---------|------------|------|
| `app/api/calendar/cell-remarks/route.ts` | 0% | セル備考CRUD |
| `app/api/calendar/members/route.ts` | 0% | メンバー取得 |
| `app/api/estimates/next-number/route.ts` | 0% | 見積番号採番 |
| `app/api/master-data/construction-suffixes/route.ts` | 0% | 工事名称CRUD |
| `app/api/master-data/construction-suffixes/[id]/route.ts` | 0% | 工事名称個別操作 |
| `app/api/project-masters/[id]/files/route.ts` | 0% | ファイルアップロード |
| `app/api/project-masters/[id]/files/[fileId]/route.ts` | 0% | ファイル個別操作 |
| `app/api/system-settings/foremen/route.ts` | 0% | 職長設定 |

**テストの書き方（例: APIルート）**:
```typescript
// __tests__/api/calendar/cell-remarks/route.test.ts
import { GET, POST } from '@/app/api/calendar/cell-remarks/route';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';

describe('GET /api/calendar/cell-remarks', () => {
  it('日付範囲でセル備考を取得する', async () => {
    const mockRemarks = [{ id: '1', date: '2026-03-12', content: 'テスト' }];
    (prisma.cellRemark.findMany as jest.Mock).mockResolvedValue(mockRemarks);

    const req = new NextRequest('http://localhost/api/calendar/cell-remarks?startDate=2026-03-10&endDate=2026-03-16');
    const res = await GET(req);
    const data = await res.json();

    expect(data).toEqual(mockRemarks);
    expect(prisma.cellRemark.findMany).toHaveBeenCalled();
  });
});
```

**注意**: `jest.setup.ts` の Prismaモックに該当モデルが無い場合は追加が必要
```typescript
// jest.setup.ts に追加する例
cellRemark: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
},
```

---

### Priority 3（低）: 改善すると良いが後回しでOK

| ファイル | 行カバレッジ | 理由 |
|---------|------------|------|
| `lib/rate-limit.ts` | 52% | Upstash依存のため単体テストが難しい |
| `utils/reactPdfGenerator.tsx` | 0% | PDF描画はブラウザ依存 |
| `utils/fonts/japanese.ts` | 0% | フォント処理、テスト不要 |
| `components/ui/PdfViewer.tsx` | 0% | ブラウザAPI依存 |
| `components/ui/ImageLightbox.tsx` | 10% | UI表示のみ |
| レイアウト系（`layout.tsx` 等） | 0% | プロバイダーラッパーのみ |
| `lib/prisma.ts` | 0% | DB接続初期化のみ |

---

## 作業チェックリスト

以下の順番で進めること。各タスク完了後にチェックを入れる。

- [ ] **Task 1-1a**: `cellRemarkSlice.ts` のテスト追加 → 80%以上
- [ ] **Task 1-1b**: `remarkSlice.ts` のテスト追加 → 80%以上
- [ ] **Task 1-1c**: `vacationSlice.ts` のテスト追加 → 80%以上
- [ ] **Task 1-1d**: `assignmentSlice.ts` のテスト追加 → 80%以上
- [ ] **Task 1-1e**: `dailyReportSlice.ts` のテスト追加 → 80%以上
- [ ] **Task 1-1f**: `types.ts` のテスト追加 → 80%以上
- [ ] **Task 1-2**: `useProjects.ts` のテスト追加 → 75%以上
- [ ] **Task 1-3**: `auth.ts` のテスト追加 → 70%以上
- [ ] 全テスト実行して既存テストが壊れていないことを確認
- [ ] **Task 2**: 0%のAPIルートのテスト追加（上から順に）
- [ ] 全テスト実行して最終確認

---

## よくあるハマりポイント

### 1. `jest.mock()` のホイスティング
`jest.mock()` はファイルの先頭に自動的に巻き上げられる（ホイスティング）。mock関数内で外部変数を参照する場合は `require()` を使う。
```typescript
// NG: mockの中でimportした変数は使えない
import { something } from './module';
jest.mock('./target', () => ({ fn: () => something }));

// OK: require で取得
jest.mock('./target', () => {
  const { something } = require('./module');
  return { fn: () => something };
});
```

### 2. Zustandストアのリセット
テスト間でストアの状態が残る。`beforeEach` で必ずリセットすること。
```typescript
beforeEach(() => {
  useCalendarStore.setState({
    /* 初期状態 */
  });
});
```

### 3. async/awaitの扱い
非同期アクション（fetch系）のテストでは `await` を忘れないこと。
```typescript
it('データを取得する', async () => {
  // await を忘れると、assertionが先に実行されて失敗する
  await useCalendarStore.getState().fetchData();
  expect(useCalendarStore.getState().data).toHaveLength(1);
});
```

### 4. `act()` 警告
Reactコンポーネントのテストで状態更新が `act()` の外で起きると警告が出る。`@testing-library/react` の `render` や `fireEvent` は自動的に `act()` で包まれるが、手動で非同期処理を待つ場合は `waitFor` を使う。
```typescript
import { waitFor } from '@testing-library/react';

await waitFor(() => {
  expect(screen.getByText('読み込み完了')).toBeInTheDocument();
});
```

### 5. Prismaモデルの追加
テスト対象のAPIが `jest.setup.ts` に無いPrismaモデルを使う場合、モックを追加する必要がある。追加したら他のテストが壊れないか全体実行で確認すること。

---

## 完了基準

- Priority 1 の全ファイルが目標カバレッジを達成している
- Priority 2 のAPIルートに最低限のCRUDテストがある
- 全テストスイートがPASSしている（既存テストを壊していない）
- `npx jest --coverage` で結果を確認し、スクリーンショットを共有する
