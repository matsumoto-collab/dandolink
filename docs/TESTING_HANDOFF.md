# テスト引継ぎ資料

## 1. プロジェクト概要

### 現在の状況 (2026/01/31時点)
| 項目 | 値 |
|-----|-----|
| テスト数 | **711** |
| カバレッジ (Lines) | **42.43%** |
| Phase 3 | ✅ **完了** |
| 次の目標 | Final Phase (60-80%) |
| 最終目標 | 80% |

### 進捗サマリー
```
Phase 1 (完了): 基盤整備、Hooks → 24% ✅
Phase 2A (完了): Tier 0 完了 → 31.31% ✅
Phase 2B (完了): Tier 1 完了 → ~38% ✅
Phase 2C (完了): Tier 2 完了 → ~40% ✅
Phase 3 (完了): Tier 3 完了 → 42.43% ✅  ← 現在地
Final: 全体網羅 → 80%
```

### Phase 2A 成果 (2026/01/31完了)
- `useRealtimeSubscription.ts`: SSR安全設計にリファクタリング、テスト追加
- `calendarStore.ts`: CRUD楽観的更新テスト網羅
- `financeStore.ts`: CRUD楽観的更新テスト網羅
- **バグ修正**: `updateProject` APIエラー時ロールバック問題

### Phase 2B 成果 (2026/01/31完了)
- `useCalendarModals`: 状態遷移、案件コピー等ビジネスロジック
- `InvoiceForm`: 自動計算、バリデーション、見積書連携
- `DroppableCell`: DnDモック化、UI状態変化検証

### Phase 2C 成果 (2026/01/31完了)
- `UserManagement`: リスト表示、CRUD操作
- `ProjectMasterForm`: 複数セクション、コールバック
- `ForemanSelector`: レンダリング、選択ロジック
- **技術改善**: act()警告解消、モック強化、セレクタ修正

### Phase 3 成果 (2026/01/31完了)
- `DraggableEventCard`: DnDライブラリモック、カード操作
- `DailyReportModal`: 動的フォーム、バリデーション、API連携
- `WeeklyCalendar`: 統合テスト、初期表示、データフェッチ

### 技術スタック
| 分類 | 技術 |
|-----|------|
| フレームワーク | Next.js 14 (App Router) |
| Test Runner | Jest |
| Testing Utilities | React Testing Library (@testing-library/react) |
| 状態管理 | Zustand |
| DB | Prisma + Supabase |
| リアルタイム | Supabase Realtime |
| API Mocking | global.fetch モック, jest.mock |

---

## 2. テスト環境セットアップ

### コマンド
```bash
# テスト実行
npm test

# 監視モード
npm run test:watch

# カバレッジ付き
npm run test:coverage

# E2Eテスト（Playwright）
npm run test:e2e
```

### 設定ファイル
| ファイル | 役割 |
|---------|------|
| `jest.config.js` | Jest設定（エイリアス、カバレッジ対象） |
| `jest.setup.ts` | グローバルモック（Prisma、Router、API utils） |

### jest.setup.ts 解説

**グローバルモック一覧**:

| モック対象 | 説明 |
|-----------|------|
| `next/navigation` | `useRouter`, `usePathname`などをモック |
| `next-auth/react` | `useSession`を認証済み状態などでモック可能 |
| `@/lib/prisma` | DB操作を完全にモック |
| `@/lib/api/utils` | API認証・レート制限 |
| `@/utils/permissions` | 権限チェック |
| `@/lib/formatters` | データフォーマッター |
| `window.matchMedia` | UIコンポーネント用ポリフィル |
| `ResizeObserver` | UIコンポーネント用ポリフィル |
| `HTMLCanvasElement.getContext` | チャートライブラリなどのためのモック |

**注意**: これらはグローバルモックなので、個別テストで上書き可能

---

## 3. ディレクトリ構造

```
__tests__/
├── api/                    # APIルートテスト
│   ├── assignments/
│   ├── customers/
│   ├── daily-reports/
│   ├── estimates/
│   ├── invoices/
│   ├── project-masters/
│   └── users/
├── components/             # コンポーネントテスト
│   ├── Calendar/
│   ├── Customers/
│   ├── Estimates/
│   ├── Invoices/
│   └── Projects/
├── contexts/               # Contextテスト
├── hooks/                  # カスタムフックテスト
├── lib/                    # ユーティリティテスト
├── stores/                 # Zustandストアテスト
└── utils/                  # ヘルパー関数テスト
```

---

## 4. テスト優先度（Tiers）

### Tier 0: Core Infrastructure (Critical) - ✅ **Phase 2A完了**
> 目標: アプリケーションの基盤となるロジックの完全なテスト

| ファイル | LOC | 状態 | テスト内容 |
|---------|-----|------|----------|
| `hooks/useRealtimeSubscription.ts` | 179 | ✅ 完了 | useEffect動作、supabase.channel呼び出し、デバウンス |
| `stores/calendarStore.ts` | 757 | ✅ 完了 | CRUD網羅、楽観的更新、ロールバック |
| `stores/financeStore.ts` | 503 | ✅ 完了 | CRUD網羅、Date変換ロジック |

**Tier 0 テスト詳細**:
- **Fetch系**: 成功/失敗/ローディング状態の遷移
- **CRUD系**: 楽観的更新(Optimistic Update)とロールバックの動作
- **Date変換**: 文字列からDateオブジェクトへの変換ロジック
- **Selectors**: ストアからデータを加工して取得するロジック

### Tier 1: Key Features & Complex UI - ✅ **Phase 2B完了**
> 目標: ユーザーが頻繁に触れる重要機能の安全性確保

| ファイル | LOC | 状態 | テスト内容 |
|---------|-----|------|----------|
| `hooks/useCalendarModals.ts` | 210 | ✅ 完了 | 状態遷移、案件コピー等ビジネスロジック |
| `components/Invoices/InvoiceForm.tsx` | 290 | ✅ 完了 | 自動計算、バリデーション、見積書連携 |
| `components/Calendar/DroppableCell.tsx` | 150 | ✅ 完了 | DnDモック化、UI状態変化検証 |
| `components/Calendar/EmployeeRowComponent.tsx` | 200 | ⏳ 未着手 | 従業員行表示、イベント処理 |
| `components/Settings/UserManagement.tsx` | 350 | ⏳ 未着手 | ユーザー管理CRUD |

### Tier 2: Secondary Features - ✅ **Phase 2C完了**
> 目標: 全体的なカバレッジの底上げ

| カテゴリ | 対象コンポーネント | 状態 |
|---------|-----------------|------|
| Settings | UserManagement | ✅ 完了 |
| ProjectMasters | ProjectMasterForm | ✅ 完了 |
| Calendar | ForemanSelector | ✅ 完了 |

### Tier 3: Data-heavy & Stateful - ✅ **Phase 3完了**
> 目標: 複雑な状態管理・計算ロジックの検証

| コンポーネント | 複雑性 | 状態 |
|--------------|-------|------|
| DraggableEventCard | DnD操作、状態管理 | ✅ 完了 |
| DailyReportModal | 多フィールド、計算ロジック | ✅ 完了 |
| WeeklyCalendar | 統合テスト | ✅ 完了 |

### 残り (Final Phase)
| カテゴリ | 対象 | 状態 |
|---------|-----|------|
| PDF生成 | EstimatePDF, InvoicePDF | ⏳ |
| 認証 | auth.ts | ⏳ |
| その他未カバー | profitDashboard等 | ⏳ |

---

## 5. テストパターン・規約

### 5.1 Hook (カスタムフック) テストパターン

```typescript
import { renderHook, act } from '@testing-library/react';
import { useMyHook } from './useMyHook';

describe('useMyHook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should initialize correctly', () => {
        const { result } = renderHook(() => useMyHook());
        expect(result.current.value).toBe(initialValue);
    });

    it('should handle updates', async () => {
        const { result } = renderHook(() => useMyHook());
        await act(async () => {
            await result.current.updateValue('new');
        });
        expect(result.current.value).toBe('new');
    });
});
```

### 5.2 Store (Zustand) テストパターン

```typescript
import { useMyStore } from '@/stores/myStore';

describe('useMyStore', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useMyStore.getState().reset(); // リセット必須
    });

    it('should update state via action', async () => {
        const mockData = [{ id: '1', name: 'Test' }];
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => mockData,
        });

        await useMyStore.getState().fetchData();
        expect(useMyStore.getState().items).toHaveLength(1);
    });

    // 楽観的更新のテスト
    it('should rollback on failure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });

        const originalItems = useMyStore.getState().items;
        await useMyStore.getState().deleteItem('1');

        expect(useMyStore.getState().items).toEqual(originalItems);
    });
});
```

### 5.3 Component (UI) テストパターン

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
    const user = userEvent.setup();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should render and handle click', () => {
        render(<MyComponent title="Test" />);
        expect(screen.getByText('Test')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('Clicked')).toBeInTheDocument();
    });

    it('should submit form with valid data', async () => {
        const mockOnSubmit = jest.fn();
        render(<MyComponent onSubmit={mockOnSubmit} />);

        await user.type(screen.getByLabelText('名前'), 'テスト');
        await user.click(screen.getByRole('button', { name: '保存' }));

        expect(mockOnSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'テスト' })
        );
    });
});
```

### 5.4 Context (Provider) テストパターン

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { MyProvider, useMyContext } from './MyContext';

// モック設定
jest.mock('next-auth/react');
jest.mock('@/lib/supabase', () => ({
    supabase: {
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn(),
        })),
        removeChannel: jest.fn(),
    },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const wrapper = ({ children }) => <MyProvider>{children}</MyProvider>;

describe('MyContext', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    });

    it('should provide values', () => {
        const { result } = renderHook(() => useMyContext(), { wrapper });
        expect(result.current.value).toBeDefined();
    });

    it('should fetch data on mount', async () => {
        const { result } = renderHook(() => useMyContext(), { wrapper });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(mockFetch).toHaveBeenCalled();
    });
});
```

---

## 6. 具体的な作業項目

### 6.1 useRealtimeSubscription.ts テスト（Tier 0）

**ファイル**: `__tests__/hooks/useRealtimeSubscription.test.ts`

**テスト項目チェックリスト**:
- [ ] `useEffect`の動作確認 (mount/unmount)
- [ ] `supabase.channel`の呼び出し確認
- [ ] コールバックの発火確認
- [ ] データ変更時のデバウンス動作確認
- [ ] `enabled=false`の時にサブスクリプションが作成されない
- [ ] `reset()`でサブスクリプションがリセットされる
- [ ] `useMultipleRealtimeSubscriptions`が複数テーブルを購読する
- [ ] エラー時にコンソールにログが出る

**モック例**:
```typescript
jest.mock('@/lib/supabase', () => ({
    supabase: {
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn(),
        })),
        removeChannel: jest.fn(),
    },
}));
```

### 6.2 calendarStore.ts テスト拡張（Tier 0）

**現状**: 基本的なfetchのみテスト済み

**追加テスト項目チェックリスト**:

| カテゴリ | アクション | テスト内容 |
|---------|----------|----------|
| Fetch系 | `fetchProjectMasters` | 成功/失敗/ローディング状態 |
| Fetch系 | `fetchDailyReports` | 日付範囲フィルタリング |
| Fetch系 | `fetchVacations` | 成功/失敗 |
| Fetch系 | `fetchRemarks` | 成功/失敗 |
| CRUD系 | `addProjectMaster` | 楽観的更新、ロールバック |
| CRUD系 | `updateProjectMaster` | 楽観的更新、ロールバック |
| CRUD系 | `deleteProjectMaster` | 楽観的更新、ロールバック |
| CRUD系 | `addDailyReport` / `updateDailyReport` | CRUD動作 |
| CRUD系 | `addVacation` / `deleteVacation` | CRUD動作 |
| CRUD系 | `setRemark` | 更新動作 |
| Date変換 | 全fetch | 文字列→Dateオブジェクト変換 |
| Selectors | データ加工 | 取得ロジックの正確性 |

### 6.3 financeStore.ts テスト拡張（Tier 0）

**追加テスト項目チェックリスト**:

| カテゴリ | アクション | テスト内容 |
|---------|----------|----------|
| Fetch系 | `fetchCompanyInfo` | 成功/失敗/ローディング |
| Fetch系 | `fetchUnitPriceMasters` | 成功/失敗 |
| CRUD系 | Customer CRUD | add/update/delete + 楽観的更新 |
| CRUD系 | Estimate CRUD | add/update/delete + 楽観的更新 |
| CRUD系 | Invoice CRUD | add/update/delete + 楽観的更新 |
| CRUD系 | UnitPriceMaster | add/update/delete |
| Date変換 | 全fetch | validUntil, dueDate等の変換 |
| エラー | fetch失敗時 | エラーハンドリング |

### 6.4 useCalendarModals.ts テスト（Tier 1）

**ファイル**: `__tests__/hooks/useCalendarModals.test.ts`

**テスト項目チェックリスト**:
- [ ] 初期状態（全モーダル閉じている）
- [ ] `openProjectModal` / `closeProjectModal`
- [ ] `openAssignmentModal` / `closeAssignmentModal`
- [ ] `openDispatchModal` / `closeDispatchModal`
- [ ] `openCopyModal` / `closeCopyModal`
- [ ] `openSearchModal` / `closeSearchModal`
- [ ] モーダルデータの受け渡し
- [ ] 複数モーダルの排他制御（あれば）

### 6.5 InvoiceForm.tsx テスト（Tier 1）

**テスト項目チェックリスト**:
- [ ] フォームフィールドのレンダリング
- [ ] 必須フィールドのバリデーション
- [ ] 金額計算（小計、税、合計）
- [ ] 明細行の追加/削除
- [ ] 送信成功時のコールバック
- [ ] 送信失敗時のエラー表示

### 6.6 DroppableCell.tsx テスト（Tier 1）

**テスト項目チェックリスト**:
- [ ] ドロップ可能状態の表示
- [ ] ドロップイベントのハンドリング
- [ ] ドラッグオーバー時のスタイル変更
- [ ] 無効なドロップの拒否

---

## 7. カバレッジ目標達成のロードマップ

```
現在地: 645テスト / 31.31%カバレッジ
```

### Phase 2A（完了）✅
| 作業 | 状態 |
|-----|------|
| useRealtimeSubscription テスト | ✅ 完了 |
| calendarStore CRUD網羅 | ✅ 完了 |
| financeStore CRUD網羅 | ✅ 完了 |
| バグ修正 (updateProject) | ✅ 完了 |
| **達成テスト数** | **678件** |
| **達成カバレッジ** | **~33%** |

### Phase 2B（完了）✅
| 作業 | 状態 |
|-----|------|
| useCalendarModals.test.ts | ✅ 完了 |
| InvoiceForm.test.tsx | ✅ 完了 |
| DroppableCell.test.tsx | ✅ 完了 |

### Phase 2C（完了）✅
| 作業 | 状態 |
|-----|------|
| UserManagement.test.tsx | ✅ 完了 |
| ProjectMasterForm.test.tsx | ✅ 完了 |
| ForemanSelector.test.tsx | ✅ 完了 |

### Phase 3（完了）✅
| 作業 | 状態 |
|-----|------|
| DraggableEventCard.test.tsx | ✅ 完了 |
| DailyReportModal.test.tsx | ✅ 完了 |
| WeeklyCalendar.test.tsx | ✅ 完了 |

### Final Phase（目標: 60-80%）⏳
| 作業 | 推定テスト数 | 優先度 |
|-----|------------|--------|
| PDF生成コンポーネント | 15-20 | 中 |
| auth.ts | 20-30 | 中 |
| profitDashboard.ts | 30-40 | 低 |
| 残りの未カバーコード | 50+ | 低 |
| **推定合計** | **約120テスト** |

### マイルストーンサマリー

| Phase | テスト数(累計) | カバレッジ | 状態 |
|-------|--------------|----------|------|
| Phase 1 | ~500 | 24% | ✅ 完了 |
| Phase 2A | 678 | ~33% | ✅ 完了 |
| Phase 2B | ~720 | ~38% | ✅ 完了 |
| Phase 2C | ~760 | ~40% | ✅ 完了 |
| Phase 3 | 711 | 42.43% | ✅ 完了 |
| Final | ~1000 | 80% | ⏳ |

---

## 8. 注意事項・ベストプラクティス

### 8.1 モックの徹底
- **外部API（Supabase, NextAuth）は必ずモックする**
- `jest.setup.ts`のグローバルモックは各テストで上書き可能
- Prismaモックは自動リセットされない → `beforeEach`で`jest.clearAllMocks()`

```typescript
// 正しいモックのリセット
beforeEach(() => {
    jest.clearAllMocks();
    useMyStore.getState().reset(); // ストアもリセット
});
```

### 8.2 非同期テスト
- `act`ラップと`waitFor`を適切に使用し、状態更新を待つ
- タイムアウトに注意（デフォルト1000ms）

```typescript
// 正しい非同期テスト
await act(async () => {
    await result.current.fetchData();
});

await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
});
```

### 8.3 日付の扱い
- **ストア内**: Dateオブジェクト
- **APIレスポンス**: 文字列
- **重点テスト**: 変換ロジック

```typescript
// 日付変換のテスト例
it('should convert date strings to Date objects', async () => {
    const mockData = [{
        id: '1',
        createdAt: '2024-01-01T00:00:00.000Z'
    }];

    await store.fetchData();

    expect(store.items[0].createdAt).toBeInstanceOf(Date);
});
```

### 8.4 テストの独立性
- **`beforeEach`で必ずモックやストアの状態をリセットする**
- 各テストは他のテストに依存しない
- テスト順序に関係なく成功すること

### 8.5 避けるべきこと
- ❌ 実際のAPIを叩くテスト
- ❌ 実際のSupabase接続
- ❌ スナップショットテストの乱用
- ❌ 実装詳細のテスト（内部状態の直接検証）
- ❌ テスト間の依存関係

---

## 9. 参考リンク

- [Jest公式ドキュメント](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Zustand](https://docs.pmnd.rs/zustand/guides/testing)

---

## 10. クイックスタートガイド（新規エンジニア向け）

### 最初にやること
1. `npm install` で依存関係インストール
2. `npm test` でテストが通ることを確認
3. `npm run test:coverage` でカバレッジレポート確認
4. `jest.setup.ts` のグローバルモックを理解

### 最初の作業推奨
1. **既存テストを読む**: `__tests__/contexts/AssignmentContext.test.tsx` が良い例
2. **Tier 1から着手**: `useCalendarModals.test.ts` が比較的独立していて着手しやすい
3. **小さく始める**: まず1つのアクションのテストを書いてみる

### 困ったら
1. 既存テストファイルのパターンを参照
2. `jest.setup.ts`のグローバルモック設定を確認
3. 型定義（`types/`ディレクトリ）を確認

---

## 11. 関連ドキュメント

| ファイル | 内容 |
|---------|------|
| `TEST_EXPANSION_PLAN.md` | テスト拡張戦略（詳細版） |
| `jest.config.js` | Jest設定 |
| `jest.setup.ts` | グローバルモック定義 |
| `types/` | 型定義ファイル |

---

*最終更新: 2026-01-31*
*ベース: TEST_EXPANSION_PLAN.md (Phase 2A完了時点)*
