/**
 * Phase 0 本番反映後の検証 SQL を本番 DB に対して実行する。
 * scripts/phase0-verify.sql と同等の検証項目を Prisma 経由で実行。
 * 読み取り専用 SELECT のみ。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. テーブル列定義
  console.log('=== 1. BillingDraft 列定義 ===');
  const cols = await prisma.$queryRaw<
    Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      udt_name: string;
    }>
  >`
    SELECT column_name, data_type, is_nullable, column_default, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'BillingDraft'
    ORDER BY ordinal_position;
  `;
  for (const c of cols) {
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    const nul = c.is_nullable === 'YES' ? '' : ' NOT NULL';
    const type = c.data_type === 'USER-DEFINED' ? `"${c.udt_name}"` : c.data_type;
    console.log(`  ${c.column_name.padEnd(13)} | ${type}${nul}${def}`);
  }

  // 2. enum
  console.log('');
  console.log('=== 2. BillingDraftStatus enum ===');
  const enums = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
    SELECT enumlabel FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE typname = 'BillingDraftStatus'
      ORDER BY enumsortorder;
  `;
  for (const e of enums) console.log(`  ${e.enumlabel}`);

  // 3. index
  console.log('');
  console.log('=== 3. インデックス ===');
  const idx = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'BillingDraft'
    ORDER BY indexname;
  `;
  for (const i of idx) console.log(`  ${i.indexname}: ${i.indexdef}`);

  // 4. FK
  console.log('');
  console.log('=== 4. 外部キー制約 ===');
  const fks = await prisma.$queryRaw<
    Array<{ conname: string; references: string; on_delete: string }>
  >`
    SELECT
      conname,
      confrelid::regclass::text AS references,
      CASE confdeltype
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        WHEN 'a' THEN 'NO ACTION'
      END AS on_delete
    FROM pg_constraint
    WHERE conrelid = '"public"."BillingDraft"'::regclass AND contype = 'f'
    ORDER BY conname;
  `;
  for (const fk of fks) {
    console.log(`  ${fk.conname.padEnd(35)} → ${fk.references} (ON DELETE ${fk.on_delete})`);
  }

  // 5. trigger function
  console.log('');
  console.log('=== 5. 改ざん防止関数 protect_confirmed_billing_draft ===');
  const procs = await prisma.$queryRaw<
    Array<{ proname: string; pronargs: number; prorettype: string }>
  >`
    SELECT proname, pronargs, prorettype::regtype::text AS prorettype
    FROM pg_proc
    WHERE proname = 'protect_confirmed_billing_draft';
  `;
  for (const p of procs) console.log(`  ${p.proname} | nargs=${p.pronargs} | rettype=${p.prorettype}`);

  // 6. trigger
  console.log('');
  console.log('=== 6. 改ざん防止トリガ trg_protect_confirmed_billing_draft ===');
  const trigs = await prisma.$queryRaw<
    Array<{ tgname: string; tgenabled: string; tgtype: number }>
  >`
    SELECT tgname, tgenabled::text, tgtype::int
    FROM pg_trigger
    WHERE tgname = 'trg_protect_confirmed_billing_draft';
  `;
  for (const t of trigs) console.log(`  ${t.tgname} | enabled=${t.tgenabled} | tgtype=${t.tgtype} (=19 = BEFORE UPDATE FOR EACH ROW)`);

  // 7. 既存 BillingDraft レコード数（運用前なので 0 のはず）
  console.log('');
  console.log('=== 7. BillingDraft 行数 ===');
  const count = await prisma.billingDraft.count();
  console.log(`  ${count} 行（Phase 0 完了直後、運用未開始なので 0 が期待値）`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
