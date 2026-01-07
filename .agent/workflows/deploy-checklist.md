---
description: Vercelデプロイ前の確認チェックリスト
---

# デプロイ前チェックリスト

Vercelへのデプロイ前に以下の項目を確認してください。

## 1. 環境変数の確認

### DATABASE_URL（必須）
- [ ] Supabase Pooler URLを使用しているか
- [ ] ポートが **6543**（Transaction Pooler）になっているか
- [ ] 末尾に `?pgbouncer=true` が含まれているか

**正しい形式:**
```
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
```

### その他の環境変数
- [ ] `NEXTAUTH_URL` が本番URLに設定されているか
- [ ] `NEXTAUTH_SECRET` が設定されているか（ランダムな32文字以上）
- [ ] `NEXT_PUBLIC_SUPABASE_URL` が設定されているか
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` が設定されているか

## 2. Supabase設定の確認

### Realtime機能
- [ ] 必要なテーブルでRealtimeが有効になっているか
  - Project, Customer, Estimate, Invoice
  - CalendarRemark, VacationRecord, UserSettings
  - Vehicle, Worker, Manager など

### RLS（Row Level Security）
- [ ] 必要なテーブルでRLSポリシーが設定されているか

### Prismaスキーマ変更時（重要！）
Prismaスキーマ（`prisma/schema.prisma`）にカラムを追加した場合：

- [ ] SupabaseのSQL Editorで新しいカラムを追加
```sql
-- 例: ProjectテーブルにmeetingTimeを追加
ALTER TABLE "Project" ADD COLUMN "meetingTime" TEXT;
```
- [ ] デプロイ後、500エラーが出る場合はカラム追加を確認

## 3. コードの確認

// turbo
### TypeScriptチェック
```bash
npx tsc --noEmit
```

// turbo
### ビルドテスト
```bash
npm run build
```

## 4. デプロイ後の確認

- [ ] ログインが正常に動作するか
- [ ] データが正しく読み込まれるか
- [ ] CRUD操作（作成・読取・更新・削除）が動作するか
- [ ] Realtime同期が動作するか（複数ブラウザで確認）

## トラブルシューティング

### 500エラーが発生する場合
1. Vercel Runtime Logsを確認
2. `PrismaClientInitializationError` → DATABASE_URLを確認
3. Redeployを実行（環境変数変更後は必須）

### データが表示されない場合
1. ブラウザのコンソールを確認（F12）
2. APIレスポンスを確認（Networkタブ）
3. Supabase Realtimeが有効か確認
