-- baseline 適用後のローカル DB 検証
\echo === 1. public スキーマ表数 ===
SELECT COUNT(*) AS public_tables FROM pg_tables WHERE schemaname = 'public';

\echo
\echo === 2. auth スキーマ表数 ===
SELECT COUNT(*) AS auth_tables FROM pg_tables WHERE schemaname = 'auth';

\echo
\echo === 3. BillingDraft テーブル構造 ===
\d "public"."BillingDraft"

\echo
\echo === 4. BillingDraftStatus enum ===
SELECT typname, enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE typname = 'BillingDraftStatus' ORDER BY enumsortorder;

\echo
\echo === 5. 改ざん防止関数 ===
SELECT proname, pronargs, prorettype::regtype::text FROM pg_proc WHERE proname = 'protect_confirmed_billing_draft';

\echo
\echo === 6. 改ざん防止トリガ ===
SELECT tgname, tgenabled::text, tgtype::int FROM pg_trigger WHERE tgname = 'trg_protect_confirmed_billing_draft';

\echo
\echo === 7. InventoryTransaction 部分ユニーク制約 ===
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'InventoryTransaction_idempotencyKey_key';

\echo
\echo === 8. _prisma_migrations の内容 ===
SELECT migration_name, started_at, finished_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at DESC;
