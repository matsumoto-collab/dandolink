# Step 8: 協力会社ロールで WeeklyCalendar の編集系 UI を非表示にする

最終更新: 2026-05-08
ブランチ: `feature/partner-member-step8-hide-partner-controls`（このブランチを `main` から切って作業）
担当: cc

## 0. 背景

partner / partner_member（以下「協力会社ロール」）が「週間」タブの WeeklyCalendar を `partnerMode=true` で開くと、自社1行だけ表示される。しかしヘッダ右側の **検索アイコン（虫眼鏡）** と PC 版下部の **「職長を追加」ボタン** がまだ表示されており、協力会社にとっては機能的に意味がない（自社1行固定なので追加対象なし／検索しても自社外の結果は表示できない）。

kei さんからの要件: 協力会社ロールではこの2つのコントロールを非表示にする。foreman2（副職長）は対象外（従来どおり表示）。

## 1. スコープ

| ロール | partnerMode | 検索アイコン | 職長を追加 |
|---|---|---|---|
| admin / manager | false | 表示（変更なし） | 表示（変更なし） |
| foreman / worker / support | false | 表示（変更なし） | 表示（変更なし） |
| foreman2 | false | 表示（変更なし） | 表示（変更なし） |
| **partner** | **true** | **非表示** | **非表示** |
| **partner_member** | **true** | **非表示** | **非表示** |

「職長を追加」ボタンは PC 版（DesktopCalendarView）にのみ存在。モバイル版には ForemanSelector が無いため対応不要。

## 2. 修正するファイル（2ファイル）

### 2-1. `components/Calendar/WeeklyCalendar.tsx`

検索パネルを開くハンドラを協力会社ロールには渡さないようにする。`handleOpenSearch` が `undefined` のときヘッダ側で条件レンダリングが既に効いているため、これだけで検索アイコンが消える。

**変更箇所 (2か所、両方とも `MobileCalendarView` と `DesktopCalendarView` への props):**

現状:
```tsx
handleOpenSearch={handleOpenSearch}
```

変更後（両方とも同じ）:
```tsx
handleOpenSearch={partnerMode ? undefined : handleOpenSearch}
```

具体的な行（実装時に再確認すること、リファクタで動いている可能性あり）:
- L566 付近: `MobileCalendarView` への props
- L597 付近: `DesktopCalendarView` への props

### 2-2. `components/Calendar/DesktopCalendarView.tsx`

PC 版下部に常時描画されている `<ForemanSelector />` を協力会社ロール時に非表示にする。

**ステップ A: props 追加**

`DesktopCalendarViewProps` に新規 prop を追加（既存 `hideRemarks` と同じ命名スタイル）:

```ts
hideForemanSelector?: boolean;
```

defaults を分割代入のところに追加:

```tsx
hideForemanSelector = false,
```

**ステップ B: ForemanSelector を条件描画に変更**

L303 付近:

現状:
```tsx
<div className="flex border-t-2 border-slate-300 bg-slate-50 p-4">
    <ForemanSelector />
</div>
```

変更後:
```tsx
{!hideForemanSelector && (
    <div className="flex border-t-2 border-slate-300 bg-slate-50 p-4">
        <ForemanSelector />
    </div>
)}
```

**ステップ C: WeeklyCalendar から props を渡す**

`components/Calendar/WeeklyCalendar.tsx` の `<DesktopCalendarView ... />` 呼び出し（L572-607 のあたり）に追加:

```tsx
hideForemanSelector={partnerMode}
```

`hideRemarks={partnerMode}` の直前か直後に並べると見た目が揃う。

## 3. テスト

### 既存テストの確認

WeeklyCalendar / DesktopCalendarView / MobileCalendarView 関連のテストを実行して回帰がないこと:

```bash
npm test -- WeeklyCalendar
npm test -- DesktopCalendarView
npm test -- MobileCalendarView
npm test -- ForemanSelector
```

該当テストが存在しない場合は新規追加は不要（小さな表示分岐のため）。テストが落ちた場合は **手を止めて Cowork に相談**（既存テスト rot を巻き込んでよいかは Cowork が判断）。

### 動作確認は kei が目視で行う

cc は実装完了報告まで。以下のシナリオで kei が確認:

1. admin でログイン → 週間カレンダー → 検索アイコンと「職長を追加」が表示されている（回帰なし）
2. partner_member でログイン → 「週間」タブを開く → 検索アイコンと「職長を追加」が **両方とも非表示**
3. partner（既存5社のいずれか）でログイン → 「週間」タブ → 同上
4. foreman2 でログイン → 週間カレンダー → 検索アイコンと「職長を追加」が表示されている（回帰なし）

## 4. commit / push

**Cowork のレビュー前に commit しないこと。** 実装完了したら一度報告。

レビュー後、以下の 2-commit 構成で push:

- **Commit A (impl):**
  - メッセージ: `feat(partner): hide search and add-foreman controls in WeeklyCalendar for partner role`
  - 含むファイル:
    - `components/Calendar/WeeklyCalendar.tsx`
    - `components/Calendar/DesktopCalendarView.tsx`
    - （テストを追従修正した場合のみ）`__tests__/...`
- **Commit B (docs):**
  - メッセージ: `docs(handoff): add step8 instructions and mark Step 8 complete in resume.md`
  - 含むファイル:
    - `docs/handoff/partner-member-step8-instructions.md`（このファイル）
    - `docs/handoff/partner-member-resume.md`（§2 の末尾に Step 8 完了情報を追記。Step 7-B の節の後ろに `### Step 8: 協力会社ロール向け UI 非表示 ✓ 完了 (YYYY-MM-DD)` を追加）

## 5. resume.md への追記文面（commit B 用）

`docs/handoff/partner-member-resume.md` の §2 末尾、Step 7-B の節の後ろに以下を追加:

```md
### Step 8: 協力会社ロール向け UI 非表示 ✓ 完了 (YYYY-MM-DD)

**設計の要点:**
- 協力会社（partner / partner_member）が WeeklyCalendar を partnerMode=true で開いたときに表示される編集系 UI のうち、機能上意味のない 2 つを非表示にする
- foreman2 は対象外（従来どおり表示）

**修正したファイル (2):**
1. `components/Calendar/WeeklyCalendar.tsx`: `handleOpenSearch` を partnerMode 時に undefined で渡し検索アイコンを消す（既存の条件レンダリングを活用）。`hideForemanSelector={partnerMode}` を DesktopCalendarView に追加。
2. `components/Calendar/DesktopCalendarView.tsx`: `hideForemanSelector?: boolean` prop を追加し、`<ForemanSelector />` の描画をその否定で gate。

**動作確認結果 (YYYY-MM-DD, kei による目視):**
- admin / foreman2: 検索アイコンと「職長を追加」が表示（回帰なし）
- partner / partner_member: 「週間」タブで両方とも非表示

詳細指示書: `docs/handoff/partner-member-step8-instructions.md`
```

(YYYY-MM-DD は実際の merge 日に置換)

## 6. 注意点

- partnerMode は WeeklyCalendar の既存 prop なので新規概念は持ち込まない
- 検索アイコン側は **新規 prop を追加しない** で済む（`handleOpenSearch && (...)` の既存条件が機能する）。両者で実装スタイルが揃わないが、最小変更を優先
- DesktopCalendarView 側は新規 prop `hideForemanSelector` を追加。命名は既存 `hideRemarks` に合わせている
- TypeScript の型エラーがないこと（`npm run type-check` または `npx tsc --noEmit`）

## 7. 完了条件

- [ ] `components/Calendar/WeeklyCalendar.tsx` の Mobile / Desktop 両方の `handleOpenSearch` props を partnerMode 時 undefined に
- [ ] `components/Calendar/WeeklyCalendar.tsx` から `hideForemanSelector={partnerMode}` を DesktopCalendarView に渡す
- [ ] `components/Calendar/DesktopCalendarView.tsx` に `hideForemanSelector` prop を追加し、ForemanSelector を条件描画
- [ ] 既存テストが pass する（あるいは Cowork に相談済み）
- [ ] TypeScript 型エラーなし
- [ ] commit はまだしない（Cowork のレビュー待ち）
