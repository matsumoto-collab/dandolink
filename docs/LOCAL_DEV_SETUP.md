# ローカル開発環境セットアップ

DandoLink を Vercel にデプロイせず、手元で動作確認するための手順。

## 前提

- Node.js v20 以上 (確認済: v24.12.0)
- npm v10 以上 (確認済: v11.6.2)
- Windows + PowerShell or Git Bash
- Supabase プロジェクト (本番と共用 or 開発用を分けるのが理想)

## 1. 依存関係のインストール

```powershell
npm install
```

`postinstall` で `prisma generate` と PDF.js アセットコピーが自動実行される。

## 2. 環境変数の設定

1. `.env.local.template` をコピーして `.env.local` を作成
   ```powershell
   Copy-Item .env.local.template .env.local
   ```
2. Vercel ダッシュボード → 該当プロジェクト → Settings → Environment Variables から値をコピーして貼り付け

### Vercel からコピーすべき変数 (必須)

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | Supabase Postgres 接続文字列 (Prisma 用) |
| `DIRECT_URL` | Prisma migration 用 (通常 `DATABASE_URL` と同じ) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 公開キー (Realtime 用) |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバ側の管理操作用 (公開禁止) |
| `NEXTAUTH_SECRET` | NextAuth セッション暗号化キー |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 地図表示 |

### 任意

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | カスタム Map ID |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | レートリミット (未設定なら無効化) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push 通知 |
| `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_APP_TAGLINE` / `NEXT_PUBLIC_APP_LOGO` | ブランディング |
| `INIT_ADMIN_EMAIL` / `INIT_DB_SECRET` | 初期管理者作成スクリプト |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `NEXT_PUBLIC_SENTRY_DSN` | エラー監視 (ローカル不要) |

`NEXTAUTH_URL` だけはローカル固定値 `http://localhost:3001` をテンプレートに記載済み。

## 3. Prisma クライアント生成

```powershell
npx prisma generate
```

スキーマを変更したときも実行。

## 4. 起動

```powershell
npm run dev
```

ブラウザで http://localhost:3001 を開く。

## よくあるエラー

| 症状 | 原因 / 対処 |
|---|---|
| `PrismaClientInitializationError: ... DATABASE_URL` | `.env.local` の `DATABASE_URL` 未設定 / 間違い |
| ログイン後リダイレクトループ | `NEXTAUTH_URL` が `http://localhost:3001` になっているか確認 |
| `[next-auth][error][NO_SECRET]` | `NEXTAUTH_SECRET` 未設定 |
| Supabase Realtime が動かない | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 未設定 |
| 地図が表示されない / "For development purposes only" | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 未設定 or リファラ制限で localhost ブロック (Google Cloud Console で `http://localhost:3001/*` を許可) |
| `Module not found: Can't resolve '@prisma/client'` | `npx prisma generate` を実行 |
| Port 3001 already in use | 既存プロセスを停止: `Get-Process -Name node \| Stop-Process` |
| iOS Safari で動作確認したい | 同一 LAN から `http://<PCのIP>:3001` でアクセス。`next dev -H 0.0.0.0` 済み |

## 注意

- `.env.local` は `.gitignore` で除外済み。絶対にコミットしないこと。
- 本番 DB を共有すると壊す可能性がある。可能なら開発用 Supabase プロジェクトを別に用意するのが安全。
