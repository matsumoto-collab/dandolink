\echo === 1. BillingDraft テーブル構造 ===
\d "public"."BillingDraft"

\echo
\echo === 2. BillingDraftStatus enum ===
SELECT typname, enumlabel
  FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid
  WHERE typname = 'BillingDraftStatus'
  ORDER BY enumsortorder;

\echo
\echo === 3. インデックス ===
SELECT indexname FROM pg_indexes WHERE tablename = 'BillingDraft' ORDER BY indexname;

\echo
\echo === 4. 外部キー制約 ===
SELECT conname, confrelid::regclass AS references, confdeltype AS on_delete
  FROM pg_constraint
  WHERE conrelid = '"public"."BillingDraft"'::regclass AND contype = 'f'
  ORDER BY conname;

\echo
\echo === 5. 改ざん防止関数 ===
SELECT proname, pronargs, prorettype::regtype FROM pg_proc WHERE proname = 'protect_confirmed_billing_draft';

\echo
\echo === 6. 改ざん防止トリガ ===
SELECT tgname, tgenabled, tgtype FROM pg_trigger WHERE tgname = 'trg_protect_confirmed_billing_draft';
