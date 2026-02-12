# モバイルスケジュールビュー改善 設計書

> **作成日**: 2026-02-12
> **目的**: 現場管理者がスマホでスケジュール管理・見積作成を行えるようにする
> **制約**: 1週間表示は維持する

---

## 1. ユースケース

| 場面 | 操作 | 頻度 | 対応状況 |
|------|------|------|---------|
| 朝、現場に向かう車中 | 今日の予定確認 | 毎日 | ✅ Step 1 |
| 急な予定変更（雨天等） | 明日以降のスケジュール調整 | 週1-2回 | 🔲 Step 2 |
| 夕方、事務所に電話 | 来週の空き状況確認 | 週1回 | ✅ Step 1 |
| 現場で顧客と交渉 | 見積書をその場で作成・見せる | 週2-3回 | 🔲 Step 3 |

---

## 2. 設計方針

### 専門家会議の結論（5人で議論）

1. **CSS scale()ハックは廃止** — 文字が4.8pxで読めない
2. **週俯瞰バー + 日別詳細のハイブリッド** — 1週間のデータは常に見える
3. **ドラッグ&ドロップはモバイルで無効** — 代わりにタップ→アクションシート
4. **スワイプは不採用** — 手袋操作を考慮、タップターゲット重視
5. **Vaulライブラリでボトムシート** — 自作は避ける

### モバイル表示の構成

```
┌─────────────────────────────┐
│  < 2/10〜2/16 >              │ ← 週ナビ（週移動）
├───┬───┬───┬───┬───┬───┬───┤
│月 │火 │水★│木 │金 │土 │日 │ ← 週俯瞰バー（sticky）
│ 3 │ 5 │ 8 │ 4 │ 2 │ - │ - │   件数 + 充足率バー
├───┴───┴───┴───┴───┴───┴───┤   タップで日切替
│ 2/12(水) — 4件              │ ← 選択日ヘッダー
│                             │
│ ┌ 田中 ─────────────────┐  │ ← 職長カード
│ │ ■ ○○ビル組立  3人     │  │   タップ→アクションシート
│ │ ■ □□マンション   2人  │  │
│ └────────────────────────┘ │
│                             │
│ ┌ 佐藤 ─────────────────┐  │
│ │ ■ △△邸  1人           │  │
│ └────────────────────────┘ │
│                             │
│ [< 前日]  2/12(水)  [翌日 >]│ ← 下部フローティングナビ
└─────────────────────────────┘
                           [＋] ← FABボタン
```

---

## 3. 実装ステップ

### Step 1: 基本表示 ✅ 完了（2026-02-12）

**コミット**: `121ac5b`

| ファイル | 変更 |
|---------|------|
| `hooks/useMediaQuery.ts` | 新規 — レスポンシブ判定 |
| `components/Calendar/WeeklyCalendar.tsx` | リファクタ — 状態管理+分岐のみ |
| `components/Calendar/DesktopCalendarView.tsx` | 新規 — PC表示抽出 |
| `components/Calendar/WeekOverviewBar.tsx` | 新規 — 週俯瞰バー |
| `components/Calendar/MobileCalendarView.tsx` | 新規 — モバイルビュー |
| `app/globals.css` | scale()削除、アニメーション追加 |

**動作確認済み**:
- `npx tsc --noEmit` — エラーなし
- `npm run build` — 成功
- `npm test` — 125スイート、1188テスト全パス

### Step 2: 操作性強化（次にやること）

#### S2-1. Vaulライブラリ導入
```bash
npm install vaul
```

MobileCalendarView.tsx のアクションシート部分を置き換え:

```tsx
// Before: 自作div
<div className="fixed bottom-0 ... animate-slide-up">

// After: Vaul
import { Drawer } from 'vaul';
<Drawer.Root open={actionSheet.isOpen} onOpenChange={...}>
  <Drawer.Content>
    ...
  </Drawer.Content>
</Drawer.Root>
```

#### S2-2. 案件移動UI（MobileMoveGrid.tsx）

新規コンポーネント。アクションシートに「移動」ボタンを追加し、タップで開く。

```tsx
interface MobileMoveGridProps {
  weekDays: WeekDay[];
  employees: { id: string; name: string }[];
  currentDateKey: string;
  currentEmployeeId: string;
  onMove: (dateKey: string, employeeId: string) => void;
  onCancel: () => void;
}
```

移動先の確定は既存の `updateProjectWithConflictHandling` を呼ぶ。
WeeklyCalendar.tsx に移動ハンドラーを追加し、MobileCalendarView に渡す。

#### S2-3. モーダルのモバイル最適化

ProjectModal等の外側divに以下を追加:
```tsx
className={`
  ...
  lg:max-w-2xl lg:mx-auto
  max-lg:fixed max-lg:inset-0 max-lg:m-0 max-lg:rounded-none
  max-lg:max-h-dvh max-lg:overflow-auto
`}
```

### Step 3: 快適さ向上

- テスト追加（MobileCalendarView, WeekOverviewBar）
- 見積書のモバイル対応（簡易見積モード + HTMLプレビュー）

---

## 4. コンポーネント構成図

```
WeeklyCalendar.tsx              ← 状態管理のみ（hooks, callbacks）
  │
  ├─ isMobile === true
  │   └─ MobileCalendarView.tsx  ← モバイル表示
  │        ├─ WeekOverviewBar.tsx ← 週俯瞰バー（sticky）
  │        ├─ ActionSheet        ← ボトムシート（→ Vaul化予定）
  │        └─ MobileMoveGrid.tsx ← 案件移動UI（Step 2で追加）
  │
  ├─ isMobile === false
  │   └─ DesktopCalendarView.tsx ← PC表示（既存グリッド）
  │
  └─ [共通モーダル群]            ← PC/モバイル共有
       ├─ ProjectModal
       ├─ ProjectMasterSearchModal
       ├─ DispatchConfirmModal
       ├─ CopyAssignmentModal
       ├─ ProjectSelectionModal
       └─ ConflictResolutionModal
```

---

## 5. 重要な設計判断と根拠

| 判断 | 根拠 |
|------|------|
| WeeklyCalendar内でisMobile分岐 | 状態管理が1箇所で済む。MobileDayView（既存・未使用）のようにデータ同期が2重にならない |
| useMediaQueryでnull→Loading | SSR時のちらつき防止。既存のisMountedパターンを活用 |
| CSS display:noneではなくJS分岐 | 両方のDOMをレンダリングしないためメモリ節約 |
| スワイプ不採用 | 縦スクロールとの干渉、手袋操作、発見性の低さ |
| 機能パリティは100%不要 | 職長並び替え・備考行編集はPCのみ。現場操作に必要な機能のみモバイル対応 |

---

## 6. テスト方針

### 手動テスト（デプロイ後に実施）
- [ ] iPhone SE (375px) でモバイルビュー表示確認
- [ ] iPhone 14 (390px) でモバイルビュー表示確認
- [ ] 曜日タップで日切替
- [ ] 案件カードタップでアクションシート表示
- [ ] 「詳細を見る・編集」→ ProjectModal表示
- [ ] 「別の日・職長にコピー」→ CopyAssignmentModal表示
- [ ] FABボタンで新規案件追加
- [ ] 下部ナビで前日/翌日移動
- [ ] 週ナビで週移動
- [ ] PC (1024px+) でDesktop表示が変わっていないこと
- [ ] iPad (768px) でモバイルビュー表示

### 自動テスト（Step 3で追加予定）
- WeekOverviewBar: 充足率計算、曜日表示、タップハンドラー
- MobileCalendarView: 日切替、アクションシート開閉
- DesktopCalendarView: 既存テスト（変更なし）
