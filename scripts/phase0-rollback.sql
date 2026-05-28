-- BillingDraft マイグレーションのロールバック手順
-- 削除順序: トリガ → 関数 → テーブル → enum
-- 関数とトリガは Prisma migrate diff が生成しないため、ロールバック時は手動 SQL で
-- 確実に削除する必要がある。

-- 1. トリガを削除
DROP TRIGGER IF EXISTS trg_protect_confirmed_billing_draft ON "public"."BillingDraft";

-- 2. 関数を削除
DROP FUNCTION IF EXISTS "public".protect_confirmed_billing_draft();

-- 3. テーブル削除（FK・インデックス・主キーも自動で消える）
DROP TABLE IF EXISTS "public"."BillingDraft";

-- 4. enum 削除
DROP TYPE IF EXISTS "public"."BillingDraftStatus";

-- ※ 本番反映後にロールバックする場合は、追加で:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260528143049_add_billing_draft';
--   schema.prisma から BillingDraft 関連を削除し、prisma/migrations/20260528143049_add_billing_draft を削除
--   npx prisma generate  -- Prisma Client を再生成
