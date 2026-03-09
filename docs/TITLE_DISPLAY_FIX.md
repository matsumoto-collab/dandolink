# 案件名の表示ルール：名前+敬称（短縮表示）への統一

## 背景

案件マスターの `title` フィールドには正式名称（例: `AOISO様 仮設工事`）が格納されている。
UIの多くの箇所では、スペースの制約から **`名前+敬称`のみ**（例: `AOISO様`）を表示すべき。

### データ構造

```
ProjectMaster {
  title: string;              // 正式名称（例: "AOISO様 仮設工事"）
  name: string | null;        // 名前（例: "AOISO"）← 旧データではnull
  honorific: string | null;   // 敬称（例: "様"）
  constructionSuffixId: string | null; // 工事名称ID
}
```

### 短縮表示のロジック

```typescript
// nameがある場合は name+honorific を表示
// nameがない旧データは title にフォールバック
const displayName = pm.name
  ? `${pm.name}${pm.honorific || ''}`
  : pm.title;
```

---

## ✅ 修正済みの箇所

| ファイル | 行 | 内容 |
|---------|---|------|
| `hooks/useProjects.ts` | L363-368 | カレンダー用のプロジェクトマッピング |
| `components/Calendar/DraggableEventCard.tsx` | L114 | PC版カレンダーカード |
| `components/Calendar/EventCard.tsx` | L29, L91 | モバイル版カレンダーカード |
| `stores/calendarSlices/types.ts` | L52-58 | `assignmentToProject` 関数 |
| `components/Calendar/ConflictResolutionModal.tsx` | L59 | 競合解決モーダルの現場名 |
| `components/ProjectMasters/sections/ConstructionSection.tsx` | L98 | 作業日の既存案件一覧 |
| `components/DailyReport/DailyReportDetailView.tsx` | L97 | 日報詳細の案件名 |
| `components/DailyReport/DailyReportModal.tsx` | L192 | 日報モーダルの既存案件マッピング |

---

## 🔧 要修正の箇所

### 優先度：高（カレンダー・スケジュール関連）

| ファイル | 行 | 現在の表示 | 修正方法 |
|---------|---|-----------|---------|
| `components/Calendar/MobileCalendarView.tsx` | L502 | `{event.title}` | `event.title` は既に短縮済み（`useProjects.ts` で変換）→ **変更不要の可能性あり（要確認）** |
| `components/Calendar/MobileCalendarView.tsx` | L592 | `{actionSheet.event.title}` | 同上 |
| `components/Calendar/MobileCalendarView.tsx` | L212 | `「{movingEvent.title}」を移動中` | 同上 |
| `components/Calendar/MobileDayView.tsx` | L147 | `{event.title}` | 同上 |
| `components/Calendar/CopyAssignmentModal.tsx` | L114 | `{event.title}` | 同上 |
| `components/Calendar/DispatchConfirmModal.tsx` | L197 | `{project.title}` | `useProjects` 経由なら短縮済み。要確認 |
| `components/Schedule/AssignmentTable.tsx` | L482, L602 | `{project.title}` | `useProjects` 経由で短縮済み → **変更不要** |

### 優先度：中（案件マスター・検索）

| ファイル | 行 | 現在の表示 | 修正方法 |
|---------|---|-----------|---------|
| `components/ProjectSearchModal.tsx` | L188 | `{project.title}` | ⚠️ **要修正**: 案件マスター検索一覧。`name+honorific` に変更 |
| `components/ProjectSearchModal.tsx` | L48 | 検索フィルタ | 検索ロジックは `title` のままでOK（フルテキスト検索） |
| `components/Projects/ProjectDetailView.tsx` | L153 | `{project.title}` | ⚠️ **要修正**: 案件詳細ヘッダー |
| `components/Projects/ProjectDetailView.tsx` | L361 | 削除確認文 | 正式名称でOK（確認用） |


### 優先度：低（見積・請求・日報）

| ファイル | 行 | 現在の表示 | 判断 |
|---------|---|-----------|------|
| `components/pdf/EstimatePDF.tsx` | L567 | `{project.title}` | **正式名称のままでOK**（書類には正式名称を使用） |
| `components/pdf/EstimatePDF.tsx` | L881 | `subject` | **正式名称のままでOK** |
| `components/pdf/InvoicePDF.tsx` | L383 | `件名：{project.title}` | **正式名称のままでOK** |
| `components/pdf/InvoicePDF.tsx` | L514 | `subject` | **正式名称のままでOK** |
| `components/Invoices/InvoiceForm.tsx` | L177 | `{project.title}` | 案件選択ドロップダウン → **短縮表示推奨** |
| `components/Estimates/EstimateHeader.tsx` | L55, L139 | `{project.title}` | 案件選択 → **短縮表示推奨** |
| `components/Estimates/EstimateForm.tsx` | L81, L97 | `selectedProject.title` | 見積の件名自動入力 → **正式名称のままでOK** |
| `components/Estimates/EstimateDetailModal.tsx` | L139 | `{effectiveProject.title}` | 見積詳細 → **短縮表示推奨** |


---

## 修正の共通パターン

### パターン1: `useProjects` 経由のデータ（CalendarEvent / Project 型）

`useProjects.ts` で既に `title` が短縮名に変換されているため、`event.title` や `project.title` をそのまま使えば **変更不要**。

### パターン2: APIから直接取得した `projectMaster` を使用

`projectMaster.title` を直接表示している箇所は修正が必要：

```typescript
// Before
{projectMaster.title}

// After
{projectMaster.name
  ? `${projectMaster.name}${projectMaster.honorific || ''}`
  : projectMaster.title}
```

### パターン3: 見積・請求書のPDF

正式書類なので **`title`（正式名称）のまま** でOK。変更不要。

---

## 注意事項

- 旧データ（`name` が `null`）では `title` にフォールバックする
- 検索ロジック（`project.title.includes(query)`）は `title` のままにすること
- 削除確認ダイアログなど、正式名称がふさわしい場面は変更不要
