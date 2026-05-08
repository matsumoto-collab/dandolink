# 協力会社メンバー機能 — 次回セッション再開ガイド

最終更新: 2026-05-08
ブランチ: `feature/partner-members`

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

## 2. 次にやること（Step 4〜6）

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

## 3. Cowork (Claude Cowork mode) への引き継ぎプロンプト案

次回セッション開始時に以下を Cowork に貼ると引き継ぎ可能:

> 「dandolink プロジェクトの feature/partner-members ブランチの続きです。docs/handoff/partner-member-resume.md と docs/handoff/partner-member-step3-design-review.md を読んで、Step 4 動作確認の段取りから始めてください。前回 Step 1〜3-B が commit & push 済みの状態です。」

## 4. cc (Claude Code) への引き継ぎプロンプト案

cc の作業を再開するときに貼るプロンプト案:

> 「dandolink プロジェクトの feature/partner-members ブランチで作業中です。以下のドキュメントを順に全文読んでから次の指示を待ってください:
> 1. docs/handoff/partner-member-resume.md
> 2. docs/handoff/partner-member-step3-design-review.md
>
> Step 1〜3-B は commit & push 済みです。次は Cowork からの指示で Step 4 動作確認 → Step 5/6 の実装に進みます。読了したら『読了。次の指示をお待ちしています』と返してください。」
