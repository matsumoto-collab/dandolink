/**
 * 本番 DB の _prisma_migrations テーブルを直接覗いて、
 * 最新 5 行と BillingDraft マイグレーションの状態を確認する。
 * 読み取り専用 SELECT のみ。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== _prisma_migrations 最新 5 行 ===');
  const recent = await prisma.$queryRaw<
    Array<{
      migration_name: string;
      started_at: Date;
      finished_at: Date | null;
      applied_steps_count: number;
    }>
  >`
    SELECT migration_name, started_at, finished_at, applied_steps_count
    FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 5;
  `;
  for (const r of recent) {
    console.log(
      `  ${r.migration_name} | started=${r.started_at.toISOString()} | finished=${r.finished_at?.toISOString() ?? '(未完了)'} | steps=${r.applied_steps_count}`
    );
  }

  console.log('');
  console.log('=== BillingDraft マイグレーション存在確認 ===');
  const billingMigration = await prisma.$queryRaw<
    Array<{ migration_name: string; finished_at: Date | null }>
  >`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    WHERE migration_name LIKE '%billing_draft%';
  `;
  if (billingMigration.length === 0) {
    console.log('  本番 _prisma_migrations に billing_draft 関連の記録 無し');
  } else {
    for (const r of billingMigration) {
      console.log(`  ${r.migration_name} | finished=${r.finished_at?.toISOString() ?? '(未完了)'}`);
    }
  }

  console.log('');
  console.log('=== BillingDraft テーブル存在確認 ===');
  const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'BillingDraft'
    ) AS exists;
  `;
  console.log(`  public.BillingDraft 存在: ${tableExists[0].exists}`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
