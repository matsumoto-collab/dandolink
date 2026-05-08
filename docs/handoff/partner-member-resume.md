# 協力会社メンバー機能 — 次回セッション再開ガイド

最終更新: 2026-05-08
ブランチ: main（Step 1〜9 すべて PR #1, #2, #3, #4, #5 として merge 済）

## 0. 役割分担と運用フロー（このプロジェクト固有）

### 役の定義

| 役 | 担当 |
|---|---|
| **Cowork** (Claude Cowork mode) | 指示役。要件整理・現状調査（読み取り）・設計判断のオプション提示・実装指示書作成・cc の成果レビュー・Chrome MCP 経由での PR 作成と merge ボタン押下・引き継ぎドキュメント整備 |
| **cc** (Claude Code) | 作業役。Cowork から渡された指示書どおりにファイル編集・テスト実行・commit・push。指示書と実装に乖離があれば手を止めて Cowork に質問する。ブラウザ操作は持たないため動作確認は結果報告まで |
| **kei** (本人) | 最終決定者。設計判断の選択（Cowork が AskUserQuestion で提示）・本番動作の目視確認・merge の最終承認・要件追加 |

### 1機能あたりの標準フロー

1. **要件提示**: kei → Cowork
2. **現状調査**: Cowork が読み取り (Read / Grep / Glob) のみで現状把握
3. **設計判断**: Cowork が AskUserQuestion で複数オプションを提示 → kei が選択
4. **実装指示書作成**: Cowork が `docs/handoff/partner-member-stepN-instructions.md` を新規作成
5. **cc 着手**: kei が cc に「指示書を読んで実装」のプロンプトを渡す（本ファイル §3 / §4 のテンプレ参照）
6. **実装 + 完了報告**: cc が実装 → 完了報告（**commit はまだしない**）
7. **diff レビュー**: Cowork が変更ファイルを Read で軽く確認 → OK なら commit/push 指示（commit message + 分割方針付き）
8. **commit & push**: cc が指示通り 2-commit 構成（A=impl + tests / B=docs）で push → 完了報告
9. **PR 作成**: Cowork が Chrome MCP で PR ページに遷移、タイトル + 説明文を埋めて Create
10. **merge**: kei に最終確認 → OK なら Cowork が Squash and merge → ブランチ削除
11. **完了マーク**: cc に依頼して resume.md へ完了情報を追記

### 重要原則

- **Cowork は実装系のファイル編集をしない**。指示書を書くだけ
  - 例外: `docs/handoff/` 配下の引き継ぎドキュメント整備は Cowork の業務範囲（本セクション自体もその一例）
- **cc は Cowork のレビュー前に commit しない**。指示書通りでも一度確認させる
- **merge ボタンは kei の承認を取ってから Cowork が押す**。最終ガードを挟むため
- **テストが想定外に失敗したら cc は止める**。勝手に修正せず Cowork に相談（既存テスト rot を巻き込んでよいかは Cowork が判断）
- **タイムゾーン依存ロジックは JST 基準を明示**（Vercel が UTC のため）
- **新機能は1ブランチ1機能**。Step ごとにブランチを分ける（`feature/xxx-stepN` 命名）
- **PR は2-commit 構成が標準**: A=impl + 必要なテスト追従 / B=docs（resume.md 完了マーク + step instructions）

## 1. ここまでの完了状態

### Step 1 完了（commit済み予定）
- `prisma/schema.prisma`: User に `companyId` (自己参照FK) と `isLoginEnabled` 追加 + AssignmentWorker.workerId index
- `prisma/migrations/20260507_add_partner_member_support/`: 上記DDL（dev DB 適用済）
- `types/user.ts`: UserRole に `'partner_member'` 追加 + companyId/isLoginEnabled フィールド
- `lib/validations/user.ts`: zod に partner_member + 「partner_member の時 companyId 必須」refine
- `lib/auth.ts`: ログイン時 + session callback で `isLoginEnabled` チェック
- `components/Sidebar.tsx`: partner_member ロールバッジ + サイドバー絞り込み
- `scripts/investigate-partner.js`, `scripts/snapshot-partner-migration.js`: 調査スクリプト

### Step 2 完了
既存5社（role='partner'）の動作確認済（壊れていない）

### Step 3-A 完了
設計書: `docs/handoff/partner-member-step3-design-review.md`（確定版）

### Step 3-B 完了（commit済み予定）
- 新規3ファイル:
  - `components/Settings/PartnerListPage.tsx` (協力会社一覧 + 内蔵 PartnerModal)
  - `components/Settings/PartnerMemberListView.tsx` (メンバー一覧 + ログイン許可即時トグル + 楽観的UI更新)
  - `components/Settings/PartnerMemberModal.tsx` (メンバーCRUDモーダル + 再有効化注釈表示)
- API修正:
  - `app/api/users/route.ts`: GET の companyId クエリ + select拡張 / POST の親role検証 + ログイン無効ダミーパスワード分岐
  - `app/api/users/[id]/route.ts`: PATCH の親role検証 / DELETE の親削除ガード（メンバー残存時400）
- 既存修正:
  - `components/Settings/UserManagement.tsx`: users一覧から partner / partner_member を `.filter` で除外
  - `app/(master)/settings/page.tsx`: admin専用タブ "partners" 追加

### Cowork ↔ cc の分業確認事項（重要）
- Q1: ログイン許可トグルは `isLoginEnabled` フラグだけ動かす（passwordHash は触らない、isActive と同じメンタルモデル）
- Q4: PartnerMemberModal のパスワード欄は `formData.isLoginEnabled === true` のときだけ表示。再有効化時は注釈表示 + required=true
- Q5: メンバー hard delete + 親協力会社削除は子残存時に API側 400 で拒否
- 既知の限界: CLI で直接 PATCH `{ isLoginEnabled: true }` だけ叩くと passwordHash が `'!nologin'` のまま残ってログイン不可（admin専用APIのためスコープ外）

## 2. 完了した Step 4〜8（時系列）

### Step 4: 動作確認 ✓ 完了 (2026-05-08)
全13項目 OK（UserManagement filter / 協力会社タブ admin専用 / 協力会社CRUD / メンバー画面遷移 / メンバーCRUD / isLoginEnabled パスワード欄分岐 / ログイン許可トグル楽観的UI / 編集時 read-only 所属会社 / 親削除ガード 400）。

<details>
<summary>当時の確認手順</summary>

ローカル dev 環境で以下を目視確認:

1. `npm run dev` で起動
2. admin ユーザーでログイン → 設定ページを開く
3. 「ユーザー管理」タブから partner / partner_member が消えていることを確認
4. 「協力会社」タブが admin にだけ表示されることを確認（manager で見えないことも確認）
5. 「協力会社」タブで:
   - 協力会社1社を新規追加 → リストに出る
   - 「メンバー」ボタンでメンバー画面に遷移
   - 「← 戻る」で一覧に戻る
   - メンバー1名追加（isLoginEnabled=true で）→ 一覧に出る
   - メンバー1名追加（isLoginEnabled=false で）→ パスワード欄が隠れる挙動を確認
   - ログイン許可トグルを ON/OFF → 楽観的UI更新 + toast を確認
   - メンバー編集 → 所属会社が read-only で表示されることを確認
   - メンバー削除 → 一覧から消える
   - 親協力会社削除（メンバー0件）→ 成功
   - 親協力会社削除（メンバー残存）→ 400 エラー toast「所属メンバーが○名残っているため削除できません」

</details>

### Step 5: WeeklyCalendar の partnerScope/employeeRows 拡張 ✓ 完了 (2026-05-08)

**設計の要点:**
- WeeklyCalendar 自体は既に `partnerMode + partnerId` で「1社だけのカレンダー行を表示する」仕組みを持っていた (line 297–311)
- partner_member は自分の `companyId`（親会社のID）を `partnerId` として渡せば、`allForemen.find(f => f.id === partnerId)` で親会社の行が引け、そのまま再利用できる
- WeeklyCalendar 本体は無修正。session の拡張と呼び出し側の分岐追加のみで完了

**変更したファイル (4):**
1. `types/next-auth.d.ts`: Session.user / User / JWT に `companyId?: string | null` を追加
2. `lib/auth.ts`: authorize / jwt callback (初回 + 5分DB再検証 select + 代入) / session callback の5箇所で companyId を伝搬
3. `components/MainContent.tsx`: `userRole === 'partner_member'` 分岐を追加し、`partnerId={session.user.companyId}` を渡す。companyId が未設定のときは案内表示
4. `app/api/dispatch/foremen/route.ts`: 認可 allowlist に `partner_member` を追加。findMany の role enum には partner_member を含めない (親会社行は既存 partner で取得できる)

**動作確認結果 (2026-05-08, kei による目視):**
- 既存 partner ユーザー (5社) の回帰なし
- admin で partner_member 新規作成 → そのメンバーでログイン → 親協力会社の名前で1行だけカレンダーが表示される
- 編集 UI は read-only

詳細指示書: `docs/handoff/partner-member-step5-instructions.md`

### Step 6: API側 partner_member 対応 ✓ 完了 (2026-05-08)

**設計判断:**
- partner_member は親 partner と同じレベルのアクセス権を持つ
- ただしデータ参照キーが異なる: `partner` 自身=自分の userId、`partner_member`=親の companyId (assignment 主体ではないため)
- 「foreman 行集合」(partnerForemanIds) には partner_member を含めない (会社単位の集計のため)

**修正したファイル (7):**
1. `app/api/daily-reports/route.ts`: GET の自分のみフィルタに partner_member を追加
2. `app/api/chat/rooms/[roomId]/route.ts`: メンバー追加権限チェックに partner_member を追加
3. `app/api/chat/projects/[projectId]/room/route.ts`: isPartner 判定に partner_member を追加
4. `app/api/chat/projects/[projectId]/ensure-room/route.ts`: 同上
5. `app/api/project-masters/route.ts`: partner_member 用に別ブロックで companyId をキーにアサイン案件を引く (親未設定時は空集合)
6. `utils/permissions.ts`: canAccessProject の assignedProjects 経路に partner_member を追加
7. `app/api/chat/mentions/suggest/route.ts`: ROLE_OPTIONS と roleLabel に partner_member 追加 (再 grep で発見)

**無修正で確定 (2):**
- `app/api/project-masters/[id]/profit/route.ts:203` — partnerForemanIds は会社単位集計、partner_member 対象外
- `lib/profitDashboard.ts:381` — 同上

**動作確認結果 (2026-05-08, kei による目視):**
- 既存 partner (5社) の回帰なし (スケジュール / 案件マスター / 日報)
- partner_member ログイン: 親会社にアサインされた案件のみ案件一覧に表示。スケジュールは親の行で1行表示。日報は自分のみ
- チャットメンションのロール候補に「協力会社メンバー」が表示

**既知の限界 / 将来検討事項:**
- partner_member の `assignedProjects` は per-user で admin が個別設定。親会社からの自動同期は未実装 (現状は project-masters/route.ts の companyId 経路で実運用上は機能する)
- `app/api/my-schedule/route.ts:76` の foremanMap は partner_member の表示名解決に必要になったら検討

詳細指示書: `docs/handoff/partner-member-step6-instructions.md`

### Step 7-A: 手配ピッカーで partner / partner_member を選択可に ✓ 完了 (2026-05-08)

**設計の要点:**
- `/api/dispatch/workers` の role allowlist に partner / partner_member を追加（呼び出し側=管理者ロールの認可は据え置き）
- select に companyId と company リレーション (親会社 displayName) を追加
- DispatchConfirmModal: ROLE_PRIORITY に partner_member=1.5, partner=1.7 を挿入（worker と foreman2 の間）
- partner_member のチップだけ親会社名を上段に小さく併記。partner 本人や他ロールは1段表示のまま

**修正したファイル (3):**
1. `app/api/dispatch/workers/route.ts`: allowlist + select 拡張
2. `components/Calendar/DispatchConfirmModal.tsx`: 型・並び順・チップ表示
3. `__tests__/api/dispatch/workers/route.test.ts`: 期待値を現状実装に追従（support 追加 / dispatchSortOrder / orderBy 配列化を含む既存 rot も同時に解消）

詳細指示書: `docs/handoff/partner-member-step7a-instructions.md`

### Step 7-B: partner / partner_member の手配表ビュー（今日明日のみ）✓ 完了 (2026-05-08)

**設計の要点:**
- partner / partner_member ログイン時の `case 'schedule'` を **タブ式の新スクリーン** に差し替え
  - 「今日明日」タブ = 新規 PartnerScheduleView（カードリスト形式）
  - 「週間」タブ = 既存 WeeklyCalendar (partnerMode) を引き続き利用
- 期間は **当日 + 翌日のみ** （server-side で JST 基準に強制）
- スコープは会社単位: partner=自分.id / partner_member=companyId
- 自社班 (assignedEmployeeId === 親会社id) と自社メンバーが他班に手配されている案件を両方表示
- 表示項目: 工事種別バッジ / 案件名 / 顧客名 / 現場 / 集合時間 / メンバー名 / 班長名 / 備考
- 機微情報 (金額系・添付ファイル) は API レスポンスに含めない
- 手配確定済 (`isDispatchConfirmed=true`) のみ
- companyId 未設定の partner_member は 403 ではなく空配列を返す

**タイムゾーン処理:**
- サーバ TZ (Vercel UTC) に依存しないよう、`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })` で JST 暦日を計算
- frontend は `localDateKey()` (browser local = JST 前提) でフィルタキー生成
- 双方とも JST 暦日で一致する設計

**追加したファイル (3):**
1. `app/api/partner-schedule/route.ts` (GET only)
2. `components/PartnerSchedule/PartnerScheduleView.tsx` (今日明日のカードリスト)
3. `components/PartnerSchedule/PartnerScheduleScreen.tsx` (タブラッパー)

**修正したファイル (1):**
4. `components/MainContent.tsx`: partner/partner_member の case 'schedule' を PartnerScheduleScreen に差替（既存 companyId 未設定ガードは据え置き）

詳細指示書: `docs/handoff/partner-member-step7b-instructions.md`

**既知の限界 / 将来検討:**
- 案件の写真は API レスポンスから除外する形で保存抑制（ブラウザ表示すると完全保護不可のため）
- vehicles は MVP で空配列。AssignmentVehicle テーブル参照は後続で追加可能
- 翌々日以降や過去の予定はタブ「週間」の WeeklyCalendar から確認

### Step 8: 協力会社ロール向け UI 非表示 ✓ 完了 (2026-05-08)

**設計の要点:**
- 協力会社（partner / partner_member）が WeeklyCalendar を partnerMode=true で開いたときに表示される編集系 UI のうち、機能上意味のない 2 つ（ヘッダの検索アイコン / PC 版下部の「職長を追加」ボタン）を非表示にする
- foreman2 は対象外（従来どおり表示）

**修正したファイル (2):**
1. `components/Calendar/WeeklyCalendar.tsx`: Mobile/Desktop 両方の `handleOpenSearch` を partnerMode 時 undefined で渡し、ヘッダ側の既存条件レンダリングで検索アイコンを消す。`hideForemanSelector={partnerMode}` を DesktopCalendarView に追加。
2. `components/Calendar/DesktopCalendarView.tsx`: `hideForemanSelector?: boolean` prop を追加し、`<ForemanSelector />` ラッパ div の描画をその否定で gate。

**動作確認結果 (2026-05-08, kei による目視):**
- admin / foreman2: 検索アイコンと「職長を追加」が表示（回帰なし）
- partner / partner_member: 「週間」タブで両方とも非表示

詳細指示書: `docs/handoff/partner-member-step8-instructions.md`

### Step 9: 職長2 から協力業者のスケジュールを非表示 ✓ 完了 (2026-05-08)

**設計の要点:**
- foreman2 がスケジュール画面（週間 / 概観 / 手配表）を開いたとき、協力業者 (role=partner) の行を完全に非表示
- foreman1 / admin / manager は現状維持（全件閲覧）
- バックエンド `/api/dispatch/foremen` に `?scope=schedule` クエリを追加し、scope=schedule かつ caller=foreman2 のときだけ partner ロールを除外
- 出勤簿・出庫伝票・LastUpdatedLabel など他用途は scope を付けないため影響なし

**修正したファイル (3):**
1. `app/api/dispatch/foremen/route.ts`: `GET(req: NextRequest)` シグネチャ + `?scope=schedule` 受付 + 条件付きで partner ロール除外
2. `stores/calendarSlices/foremanSlice.ts:23`: `fetchForemen` の URL を `/api/dispatch/foremen?scope=schedule` に変更
3. `__tests__/api/dispatch/foremen/route.test.ts`: 既存2件を NextRequest 引数付きに更新 + 新規4件追加（scope × role マトリクス）

**触らないファイル（無修正、影響なし）:**
- 出勤簿: `components/Attendance/AttendancePage.tsx`, `AttendanceModal.tsx`
- 出庫伝票: `components/Materials/MaterialRequisitionPage.tsx`
- `components/ui/LastUpdatedLabel.tsx`
- スケジュール本体: `WeeklyCalendar.tsx`, `OverviewCalendar.tsx`, `AssignmentTable.tsx`（バックエンドフィルタなのでフロントは無修正）

**動作確認結果 (2026-05-08, kei による):**
- Vercel preview deploy 成功
- CI failing は既存の type rot（`updateTotalMembers`）で Step 9 と無関係 → §2 末尾の「既知のテスト rot」に追記
- 既存 partner / partner_member への回帰なし

詳細指示書: `docs/handoff/partner-member-step9-instructions.md`

**既知の限界 / 将来検討:**
- assignments API は無修正のため、foreman2 がブラウザの Network タブで `/api/assignments` を直接見れば partner-assigned のアサインデータ自体は取得可能。本格的なアクセス制御は別タスク
- `displayedForemanIds` グローバル設定に partner ID が残っていても問題なし（API が partner を返さなくなれば `allForemen.find()` が undefined となり frontend の filter で自動的に弾かれる）

### 既知のテスト rot（Step 8 / Step 9 検出、未対応）
- `__tests__/components/Calendar/WeeklyCalendar.test.tsx` ほか同系列で `useCalendarStore` を mock していないため、`cellRemarksInitialized / memberAdjustmentsInitialized / vacationsInitialized` がすべて false でローディング画面から進まず複数 it が失敗する。Step 8 の差分とは無関係。修正方針: テスト先頭で `jest.mock('@/stores/calendarStore', ...)` を追加し 3 flag を true で返す。別タスクで対応。
- `__tests__/hooks/useMasterData.test.ts:96` および `__tests__/stores/masterStore.test.ts:181` で `updateTotalMembers` プロパティが MasterStore 型に存在しないという TS2551 エラー (`Did you mean 'totalMembers'?`)。Step 9 の差分とは無関係（master store のリファクタ過程で生じた既存 rot で、Step 9 の CI で表面化した）。修正方針: テストを実装に合わせて `totalMembers` を直接更新する形に書き換えるか、必要なら `updateTotalMembers` を MasterStore 側に追加。Step 9 PR #5 はこの rot を抱えたまま merge 済。別タスクで対応。

## 3. Cowork (Claude Cowork mode) への引き継ぎプロンプト案

次回セッション開始時に以下を Cowork に貼ると引き継ぎ可能:

> 「dandolink プロジェクトの partner_member 機能の続きです。Step 1〜9 (基盤・管理画面・API・WeeklyCalendar 連携・手配ピッカー・今日明日ビュー・協力会社向け UI 非表示・職長2 から協力業者非表示) は main にすべて merge 済 (PR #1, #2, #3, #4, #5)。`docs/handoff/partner-member-resume.md` の §0 役割分担と §1 完了状態を読んでから、これからの修正点を相談したいです。」

## 4. cc (Claude Code) への引き継ぎプロンプト案

cc の作業を再開するときに貼るプロンプト案:

> 「dandolink プロジェクトの partner_member 機能で作業中です。以下のドキュメントを順に全文読んでから次の指示を待ってください:
> 1. `docs/handoff/partner-member-resume.md`（特に §0 役割分担、§1 完了状態）
> 2. `docs/handoff/partner-member-step3-design-review.md`（用語整理）
>
> Step 1〜8 はすべて main にマージ済みです。新しい修正があれば Cowork が指示書を作って渡します。読了したら『読了。次の指示をお待ちしています』と返してください。」

## 5. 運用の継続（次回以降のセッション）

kei の方針: **次回作業時も Step 8 までと同じ運用を継続**。

- **Cowork（指示役）**: kei の要件を聞いて現状を読み取り → AskUserQuestion で設計判断を提示 → `docs/handoff/partner-member-stepN-instructions.md` を作成 → cc の成果を diff レビュー → Chrome MCP で PR 作成・Squash and merge・ブランチ削除 → 引き継ぎ docs 整備
- **cc（作業役）**: 指示書どおりに実装・テスト → 完了報告（commit はまだしない）→ Cowork レビュー後に 2-commit 構成（A=impl+tests / B=docs）で push
- **kei（最終決定者）**: 設計判断の選択 / 動作目視確認 / merge の最終承認

毎セッション開始時のお作法:
1. kei が §3 のプロンプトを Cowork に貼る
2. kei が §4 のプロンプトを cc に貼る（cc が読了報告したら待機状態に）
3. kei → Cowork に新規要件を伝える
4. 以降は §0 の標準フロー（要件提示 → 現状調査 → 設計判断 → 指示書 → cc 着手 → diff レビュー → commit → PR → merge → 完了マーク）を踏む

詳細ルールは §0「役割分担と運用フロー」「重要原則」を参照。

**Step 8 完了履歴サマリ**:
- PR #4 (commit `2526d70`): feat(partner): hide search and add-foreman controls in WeeklyCalendar for partner role
- 後追い docs commit: docs(handoff): update Step 1-8 and PR #1-#4 references after Step 8 merge
- Production デプロイ済 (Vercel auto-deploy)
- 既知の test rot 1 件は §2 末尾「既知のテスト rot」で別タスク化済

**Step 9 完了履歴サマリ**:
- PR #5 (squash commit `9d994b8`): feat(schedule): hide partner rows from foreman2 in schedule views (Step 9)
- 後追い docs commit: docs(handoff): update Step 1-9 and PR #1-#5 references after Step 9 merge
- Production デプロイ済 (Vercel auto-deploy)
- 既知の type rot 1 件 (`updateTotalMembers` in useMasterData.test.ts / masterStore.test.ts) を §2 末尾「既知のテスト rot」に追記して別タスク化（CI failing のまま merge）
