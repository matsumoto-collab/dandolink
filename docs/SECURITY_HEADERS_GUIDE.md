# セキュリティヘッダー 開発者ガイド

`next.config.js` に設定されているセキュリティヘッダーの仕様と、開発時の注意事項をまとめたドキュメントです。

---

## 設定場所

```
next.config.js → async headers() → source: '/(.*)'
```

---

## 各ヘッダーの役割

### X-Frame-Options

```
X-Frame-Options: DENY
```

**このアプリが他サイトの `<iframe>` に埋め込まれることを禁止する**ヘッダーです。

> ⚠️ よくある誤解
>
> 「このアプリが `<iframe>` を表示することを制限する」ヘッダーではありません。
> 自分のページ内に `<iframe>` を置けるかどうかは **CSP の `frame-src`** が管理します。

**影響範囲**: 外部からの埋め込み防止のみ。アプリ内のiframe表示には無関係。

---

### Content-Security-Policy (CSP)

外部リソースの読み込みを制御するヘッダーです。ディレクティブごとに許可するソースを明示します。

#### 現在の設定と許可しているドメイン

| ディレクティブ | 役割 | 許可しているドメイン |
|---|---|---|
| `default-src` | 未指定ディレクティブの既定値 | `'self'` のみ |
| `script-src` | JavaScript の読み込み元 | `'self'` `'unsafe-eval'` `'unsafe-inline'` `maps.googleapis.com` |
| `style-src` | CSS の読み込み元 | `'self'` `'unsafe-inline'` `fonts.googleapis.com` |
| `img-src` | 画像の読み込み元 | `'self'` `blob:` `data:` `maps.googleapis.com` `maps.gstatic.com` `*.supabase.co` |
| `font-src` | フォントファイルの読み込み元 | `'self'` `data:` `fonts.gstatic.com` |
| `connect-src` | `fetch()` / `XMLHttpRequest` / WebSocket の接続先 | `'self'` `maps.googleapis.com` `wss://*.supabase.co` `*.supabase.co` `cdn.jsdelivr.net` |
| `worker-src` | Web Worker のスクリプト読み込み元 | `'self'` `blob:` |
| `child-src` | Worker / iframe のフォールバック（非推奨） | `'self'` `blob:` |
| `frame-src` | `<iframe>` の `src` として許可するURL | `'self'` `blob:` `www.google.com` `maps.google.com` `maps.googleapis.com` |
| `object-src` | `<object>` `<embed>` の読み込み元 | `'none'`（完全禁止） |

---

## 新しい外部サービスを追加するときのチェックリスト

外部の API やライブラリを追加した際は、以下を確認してください。

### 1. JavaScript を読み込む場合
→ `script-src` に追加

```diff
- script-src 'self' 'unsafe-eval' 'unsafe-inline' https://maps.googleapis.com;
+ script-src 'self' 'unsafe-eval' 'unsafe-inline' https://maps.googleapis.com https://新しいドメイン.com;
```

### 2. CSS / フォントを CDN から読み込む場合
→ `style-src` または `font-src` に追加

```diff
- font-src 'self' data: https://fonts.gstatic.com;
+ font-src 'self' data: https://fonts.gstatic.com https://新しいCDN.com;
```

### 3. `fetch()` で外部 API を呼ぶ場合（ライブラリ内部の fetch も含む）
→ `connect-src` に追加

```diff
- connect-src 'self' https://maps.googleapis.com wss://*.supabase.co https://*.supabase.co https://cdn.jsdelivr.net;
+ connect-src 'self' https://maps.googleapis.com wss://*.supabase.co https://*.supabase.co https://cdn.jsdelivr.net https://新しいAPI.com;
```

> ⚠️ ライブラリが内部で `fetch()` を使っていても CSP が適用されます。
> 「なぜかローディングが終わらない」場合はブラウザの DevTools → Console / Network タブで
> `Content Security Policy` のエラーが出ていないか確認してください。

### 4. `<iframe>` で外部ページを埋め込む場合
→ `frame-src` に追加

```diff
- frame-src 'self' blob: https://www.google.com https://maps.google.com https://maps.googleapis.com;
+ frame-src 'self' blob: https://www.google.com https://maps.google.com https://maps.googleapis.com https://新しいサイト.com;
```

### 5. 画像を外部から表示する場合
→ `img-src` に追加

---

## 過去に発生したトラブル事例

### ① Google マップ iframe がブロックされた
- **原因**: `frame-src` に `maps.google.com` が未記載（`maps.googleapis.com` のみだった）
- **教訓**: Google Maps の iframe 埋め込みは `maps.google.com` ドメインを使う。JS API とは別ドメイン。

| ドメイン | 用途 |
|---|---|
| `maps.googleapis.com` | Maps JavaScript API、タイル画像、Geocoding |
| `maps.google.com` | `<iframe>` 埋め込み地図 |
| `www.google.com` | Google 製ウィジェット埋め込み |

### ② PDF プレビューが「ローディングのまま」終わらない
- **原因**: `connect-src` に `cdn.jsdelivr.net` が未記載
- **詳細**: `@react-pdf/renderer` は PDF 生成時に `fetch()` で日本語フォント（Noto Sans JP）を `cdn.jsdelivr.net` から取得する。CSP でブロックされるとフォント取得が永遠に待機状態になり、PDF 生成が完了しない。
- **教訓**: ライブラリが内部で行う HTTP リクエストも CSP の対象になる。ライブラリ追加時はソースコードや README でネットワーク通信の有無を確認する。

### ③ `X-Frame-Options: SAMEORIGIN` に変更しても PDF が直らなかった
- **原因の誤解**: 「`X-Frame-Options: DENY` が blob: URL の iframe を塞いでいる」という誤った分析
- **正しい理解**:
  - `X-Frame-Options` は「自分が他サイトに埋め込まれることを防ぐ」ヘッダー
  - blob: URL の iframe を許可するには CSP の `frame-src` に `blob:` を追加するのが正解
  - `X-Frame-Options` を変更しても blob: iframe には効果がない

---

## CSP 違反の調査方法

ブラウザの開発者ツールで以下を確認する。

1. **Console タブ** → `Refused to load ... because it violates the following Content Security Policy directive` というエラーを探す
2. **Network タブ** → ステータスが `(blocked:csp)` になっているリクエストを確認する

エラーメッセージに違反したディレクティブ名（`connect-src`, `frame-src` など）が表示されるため、`next.config.js` の該当ディレクティブにドメインを追加する。

---

## 🚨 APIキー・機密情報の取り扱いと流出防止策（セキュリティ・インシデント対策）

過去に発生した重大なセキュリティ・インシデント（APIキーおよびトークンの誤コミット・外部流出）を防ぐためのガイドラインです。

### 絶対にやってはいけないこと

- **機密情報を平文ファイルに保存しない**: `.txt`、`.json`、`.md` などの形式であっても、APIキー、トークン、パスワード、接続URLなどの文字列をプロジェクトディレクトリ内の**未管理ファイル（一時ファイル）として保存・放置してはいけません**。
- **無差別な一括コミット（`git add .`）の禁止**: 自分が意図的に変更・追加したファイル以外が巻き込まれることを防ぐため、変更をステージングする際は必ず対象ファイルを**個別指定**してコミットしてください（例: `git add app/components/` など）。

### 流出を未然に防ぐ仕組み

- **`.gitignore` の活用と徹底**: アプリケーションで利用する機密情報を含んだ環境変数（`.env*` ファイル）は既に登録されていますが、それ以外の一時的なシークレットファイルや証明書ファイルなども必ず `.gitignore` に登録して Git の追跡から除外してください。
  ```gitignore
  # Secrets and tokens
  Google Maps API.txt
  UPSTASH_REDIS_REST_URL=*.txt
  *.pem
  ```
- **環境変数の利用**: 外部サービスのAPIキー等は必ず `.env.local` などのローカル環境変数ファイルに記述し、本番環境（Vercel）では Vercelの Settings > Environment Variables に直接設定してください。

### もし流出（シークレットアラート検知）が発生した場合の対応手順

GitHub の Secret Scanning 等で機密情報の流出アラートを受信した場合は、以下の手順で直ちに対応してください。

1. **キーの無効化（ローテーション）**: 流出したトークンやパスワードはすでに第三者に知られているものとみなし、対象サービスのコンソール画面から**即座にキーの再生成（リセット・ローテーション）**を行います。
2. **リポジトリからの削除**: リポジトリ上に誤ってプッシュされたファイルを Git の管理から削除（`git rm --cached <file>`）し、コミット・プッシュしてリモートから消去します。
3. **.gitignore への追加**: 対象ファイル名やパターンを `.gitignore` に追記し、再発を防ぎます。
4. **環境変数の更新と再デプロイ**: 新しく生成した安全なキーを本番環境（Vercel等）の環境変数に設定し直し、再デプロイを実施します。
