# セキュリティ改善の対応方針

提供いただいた `SECURITY_IMPROVEMENT_PLAN.md` を確認しました。
クリティカルおよびハイリスクな脆弱性が指摘されており、システム全体の安全性向上のために**早急かつ段階的な対応**が必要です。

## 対応の優先順位（推奨）

ドキュメントの「推奨対応順序」に基づき、実装・適用が容易でありながらセキュリティ上の効果が高い順に進めることを推奨します。具体的には以下の **Phase 1 (即時〜短期対応)** をまず完了させることが最善です。

### 🚨 Phase 1: クリティカルな脆弱性の遮断（推奨: 今回のタスクとして対応）

1. **① Supabase RLS 有効化 (影響度: 🔴大 / 手軽さ: ◎)**
   - **内容**: SupabaseのSQLエディタから提供されたSQLを実行し、全テーブルのRLSを有効化します。これにより、クライアントサイド（ブラウザ等）に露出しているAPIキーを利用した直接のデータ読み書きを即座に遮断できます。
   - **対応**: ユーザー自身でのSQL実行が必要になります。

2. **② middleware.ts による認証の集中管理 (影響度: 🔴大 / 手軽さ: ◯)**
   - **内容**: `middleware.ts` をプロジェクトルートに作成し、未ログインユーザーが保護されたAPIルートやページにアクセスできないようにします。個別の `requireAuth` 実行漏れによる情報漏洩を単一ファイルで防ぐことができます。
   - **対応**: すぐに実装可能なコード修正です。

3. **③ NEXTAUTH_SECRET の確認・変更 (影響度: 🟠中 / 手軽さ: ◎)**
   - **内容**: デフォルトのシークレット文字列を強固なランダム値に変更します。
   - **対応**: Vercelの本番環境変数にランダムな文字列を設定し、リポジトリ内の `.env` のデフォルト値を変更するだけです。

---

## その後のステップ（Phase 2以降）

以下の項目はシステムへの影響度や実装範囲が広くなるため、Phase 1 の完了後に順次対応していくことを推奨します。

- **Phase 2 (中期対応):**
  - **④ JWT再検証**: 無効化されたユーザーをセッション切れ前に即時キックオフする仕組み。
  - **⑤ Rate Limiter の Upstash 対応**: サーバーレス環境での連続アクセス制限（Vercel対応）。
  - **⑥ RBAC（ロールベースアクセス制御）の適用**: `/api/invoices` や `/api/customers` 等、管理者やマネージャーのみが操作すべきAPIルートの権限チェック一括追加。

- **Phase 3 (恒久対応):**
  - **⑦, ⑧, ⑨, ⑩**: init-db保護、CSP/HSTSヘッダー設定、Google Maps APIキー保護、全体Rate Limit適用など、システムの堅牢性を引き上げるための詳細な設定作業。

## Phase 2 (中期対応) の実装計画

Phase 1 が完了したため、続いて以下の Phase 2 タスクを実施します。ご指摘いただいた懸念事項も反映し、より具体的に設計しています。

### 1. JWT検証強化と middleware.ts の拡張
#### ⚠️ 懸念1への対応（JWT無効化とキック連動）
`lib/auth.ts`でのDB検証に加え、`middleware.ts`がトークンの状態を見て画面からキックできるように修正します。
#### [MODIFY] lib/auth.ts
- `jwt` コールバック内で、一定時間（5分）経過時にDBを再参照。
- ユーザーが無効化された場合、`token.isActive = false` に更新。
#### [MODIFY] middleware.ts
- `export { default }` の単純な形から `withAuth` を使用した形に変更。
- `authorized: ({ token }) => token?.isActive === true` のコールバックを追加し、DBで無効化されたユーザーが即座に画面から弾かれる（キックされる）ように連携させます。

### 2. Rate Limiter の Upstash Redis 対応
#### ⚠️ 懸念2への対応（非同期化への対応とインフラ準備、ユーティリティ修正漏れ）
`checkRateLimit` および `applyRateLimit` がRedis通信を行うため非同期(`async`/`await`)になります。影響範囲は現在適用済みの5ファイルのみです。
#### インフラ準備（Upstash側）
- ユーザー様にてUpstashアカウントを作成し、RedisDBを作成。
- 取得したURLとTokenを本番環境変数に追加していただきます。
#### [MODIFY] lib/rate-limit.ts
- `@upstash/ratelimit` を導入し、非同期で動作するサーバーレス対応のRatelimiterに置き換えます。
- ⚠️ Upstash の戻り値の互換性対策: `reset` を `resetTime` としてマッピングし既存コードへの影響を最小限にします。
#### [MODIFY] lib/api/utils.ts
- `applyRateLimit` を `async` 関数に変更し、内部の `checkRateLimit` の呼び出しに `await` を追加します。
#### [MODIFY] 各種 API ルート (適用済みの5ファイル)
- `app/api/assignments/route.ts` など5ファイル内で、`const rateLimitError = await applyRateLimit(req)` に書き換えます。

### 3. RBAC（ロールベースアクセス制御）の適用
#### ⚠️ 懸念3への対応（権限スコープの明確化）
現在 `requireAuth` のみで保護されている重要なAPIについて、メソッドごとのアクセス権を以下のように明確化します。
- **GET (一覧・詳細の閲覧)**: `worker` 以上の全ロールで閲覧可能。
- **POST / PATCH / DELETE (作成・更新・削除)**: `admin` または `manager` のみ許可。
#### [MODIFY] lib/api/utils.ts
- `isManagerOrAbove`を利用し、API内で汎用的に使える `requireManagerOrAbove()` などの共通関数を追加します。
#### [MODIFY] 対象 API ルート
- `/api/invoices`, `/api/estimates`, `/api/customers`, `/api/project-masters` などのPOST/PATCH/DELETEメソッドの先頭に、この権限チェック処理を一括挿入します。

## Verification Plan (検証計画)
1. **JWT再検証のテスト**:
    - 一般ユーザーを管理画面から「無効」にし、対象ユーザーが数分後の画面遷移時に強制ログアウト（ログイン画面へリダイレクト）されるか確認。
2. **Upstash Redis のテスト**:
    - 全てのAPIでawaitの追加によるコンパイルエラー（`npm run test`, `tsc`）が発生しないか確認。
    - 短時間にアクセスを集中させ `429 Too Many Requests` が返るか確認。
3. **RBACのテスト**:
    - `worker` 等の権限を持たないユーザーがブラウザ上で請求書や見積もりを「作成・削除」しようとした際に、正しくエラーまたは画面制御が行われるか確認。

---

## Phase 3 (恒久対応) の実装計画

Phase 2 が完了後、システムの堅牢性を引き上げるための以下のPhase 3設定・確認を実施します。

### 1. `init-db` エンドポイントの保護強化
現在の `/api/init-db` は本番環境(`NODE_ENV === 'production'`)で無効化されていますが、これに加えて環境変数によるシークレット(`INIT_DB_SECRET`)を用いた認証を追加し、開発環境やステージング環境でも意図しない初期化を防ぐよう保護を強化します。
#### [MODIFY] app/api/init-db/route.ts
- `process.env.INIT_DB_SECRET` とリクエスト（クエリパラメータ等）のシークレットを比較・検証。

### 2. CSP / HSTS ヘッダーの設定
現在 `next.config.js` に一部のセキュリティヘッダーが設定されていますが、最新のベストプラクティスである以下2つを追加します。
#### [MODIFY] next.config.js
- `Strict-Transport-Security` (HSTS): HTTPS通信を強制し、中間者攻撃を防止。
- `Content-Security-Policy` (CSP): Google Maps APIや各種CDN、Supabaseへの通信を許可しつつ、XSS攻撃などを緩和するセキュアなポリシーの定義。

### 3. Google Maps APIキーの保護 (ユーザーアクション)
フロントエンドで使用している Google Maps API キーの悪用を防ぐため、Google Cloud Console 側での「HTTP リファラー（ウェブサイト）制限」が適用されているか確認・設定を推奨します。
- **対応**: Google Cloud上でAPIキーの使用元をDandoLink本番ドメインや開発用localhostに限定する。

### 4. 未保護エンドポイントへのRate Limit拡充
現在、特定の主要APIにおいて個別に `applyRateLimit` によるUpstash Redis保護を行っていますが、他のAPI群にも保護漏れがないか確認し、全体的な負荷テスト攻撃を防ぐための整備を行います。

## Phase 3 Verification Plan (検証計画)
1. **init-dbテスト**: シークレットキーを付与しないリクエストが401等で拒否されるか確認。
2. **CSP/HSTSテスト**: ブラウザのネットワークタブでレスポンスヘッダに `Strict-Transport-Security` および `Content-Security-Policy` が正しく付与されていること、アプリの動作（Google Maps表示やPDF機能など）に支障が出ないか確認。
