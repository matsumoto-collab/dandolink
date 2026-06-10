# 手順書: SUPABASE_SERVICE_ROLE_KEY ローテーション

作成: 2026-06-10
背景: Vercel の環境変数 `SUPABASE_SERVICE_ROLE_KEY` に「Needs Attention」（漏えいの可能性があるため
プロバイダ側でローテーション推奨）バッジが付いている。service_role キーは **RLS を素通しできる最強権限**
のため、推奨に従いローテーションする。

⚠️ **対象は yusystem 本番の Supabase プロジェクト（`jfxnxaottugvwntfnlfz`）のみ。**
dandolink-saas 側の Supabase（`wzyxqcdosqppsgljjcih`）には絶対に触れないこと。

---

## 0. 前提知識（影響範囲の整理）

このアプリでの Supabase キーの使われ方:

| キー | 使用箇所 | 用途 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase-admin.ts`（サーバーのみ） | Storageアップロード（チャット添付・案件ファイル・LINE送信画像） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase.ts`（クライアント） | Realtime購読（カレンダー同期・チャット・通知） |
| `DATABASE_URL` / `DIRECT_URL` | Prisma | DB接続（**JWTと無関係＝ローテーションの影響なし**） |

- ログイン認証は NextAuth（独自JWT）なので **Supabaseキーを替えてもユーザーのログインには影響しない**
- 値の保管場所: ① Vercel 環境変数 ② ローカル `.env.local`（③ GitHub Actions のリポジトリSecretsに
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` が登録されていれば Plan B のときのみ更新）

---

## 1. まず確認: どちらのプランが使えるか

Supabase Dashboard → 対象プロジェクト → **Settings → API Keys** を開く。

- 「**Publishable key / Secret keys**」(`sb_publishable_…` / `sb_secret_…`) という新方式のUIがある
  → **Plan A（推奨・ダウンタイムなし）**
- 旧来の「anon / service_role（JWT形式 `eyJ…`）+ JWT Secret」しかない
  → **Plan B（一斉ローテーション・短い断あり）**

---

## Plan A: 新方式 Secret Key へ差し替え（推奨・anonに触らない）

1. Supabase → Settings → API Keys → **Create new secret key**
   - 名前: `vercel-server`（用途がわかる名前）
   - 生成された `sb_secret_…` をコピー（この画面でしか全文表示されないことがある）
2. **Vercel** → `yusystem` → Settings → Environment Variables →
   `SUPABASE_SERVICE_ROLE_KEY` を Edit → 値を `sb_secret_…` に貼り替えて Save
   - 変数名はそのままで良い（コードは env 名しか見ておらず、supabase-js v2 は新形式キーをそのまま受け付ける）
3. ローカル `.env.local` の `SUPABASE_SERVICE_ROLE_KEY` も同じ値に貼り替え
4. **Redeploy**（Deployments → 最新Production → ⋯ → Redeploy）
5. **動作確認**（下の§3チェックリスト）
6. 確認が取れて数日問題なければ、Supabase側で **旧 service_role（legacy）を無効化**
   - ⚠️ 注意: 「Disable legacy API keys」は **anon キーも同時に無効化される**場合がある。
     その場合は anon → publishable key への移行（クライアント側）とセットで別途計画すること。
     **迷ったら旧キーの無効化は保留でよい**（新キーへの切替自体で漏えい疑いキーの利用は止まっている
     …と思いがちだが、旧キーが無効化されるまでは漏えいキーも有効なまま。リスクを完全に断つには
     無効化まで必要。anon移行の工数と相談して時期を決める）

## Plan B: レガシー JWT Secret の再生成（anon も一緒に変わる）

⚠️ 実行した瞬間に **anon / service_role の旧キーが両方とも即時失効**する。
Vercelへ新キーを反映してRedeployが完了するまでの数分間、Realtime同期とファイルアップロードが
失敗する（カレンダーは120秒ポーリングで自己回復・業務停止はしないが、**業務時間外の実施を推奨**）。

1. 事前に手元へ準備: Vercel の環境変数編集画面を2タブ開いておく
   （`SUPABASE_SERVICE_ROLE_KEY` と `NEXT_PUBLIC_SUPABASE_ANON_KEY`）
2. Supabase → Settings → API → **JWT Settings → Generate new secret**（不可逆・即時失効）
3. 同画面に表示される **新 anon key / 新 service_role key** をコピー
4. Vercel の2変数を貼り替え → Save → **Redeploy**
5. ローカル `.env.local` の同2変数も貼り替え
6. GitHub リポジトリ Secrets に `NEXT_PUBLIC_SUPABASE_ANON_KEY` が登録されている場合は更新
   （Settings → Secrets and variables → Actions。プレースホルダ運用なら不要）
7. §3 の動作確認

---

## 3. 動作確認チェックリスト（どちらのPlanでも）

- [ ] カレンダーを2端末（またはPC+スマホ）で開き、片方で配置を動かすと**もう片方に数秒で反映**される（Realtime）
- [ ] チャットで**画像を添付して送信**できる（Storage書き込み = service key）
- [ ] 案件マスターの詳細で**ファイル/写真をアップロード**できる
- [ ] （LINE連携を使う案件があれば）完了連絡の**画像付き送信**が成功する
- [ ] Vercel → Logs に supabase 関連の 401/403 エラーが出ていない
- [ ] 数日後: Vercel の環境変数画面で「Needs Attention」が新たに付いていない

## 4. 切り戻し

- **Plan A**: 旧キーを無効化していなければ、Vercelの値を旧 service_role に戻して Redeploy するだけ
- **Plan B**: JWT Secret 再生成は**不可逆**。切り戻し不可のため、手順4のRedeployまでを一気に行うこと

## 5. ついで（任意）

- 同様に「Needs Attention」が付いていた Upstash トークンは **2026-06-10 対応済み**（本番は元々有効・
  .env.local のみ古かった）。GitHub PAT のローテーション（過去メモで要対応）が未実施なら合わせて。
