# 協力会社メンバー機能 — 次回セッション再開ガイド

最終更新: 2026-05-07
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

### Step 4: 動作確認（次セッション最初に実施推奨）
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

### Step 5: WeeklyCalendar の partnerScope/employeeRows 拡張
既存 WeeklyCalendar が `role='partner'` を扱う部分を `partner` または `partner_member` でも動くように拡張。

着手前に確認:
- `components/Calendar/` 配下のどのコンポーネントで partner を扱っているか grep
- partnerScope の現在のフィルタ条件
- employeeRows のロール判定ロジック

### Step 6: API側 partner_member 対応 8箇所
バックエンド API 8箇所で partner_member ロールの分岐/権限を実装。具体的にどの8箇所かは前回チャットで失われたので、Step 5 完了後に grep で再特定する必要あり。

候補:
- 手配（assignment）系API
- 出勤簿（attendance）系API
- 通知（notification）系API
- チャット（chat）系API

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
