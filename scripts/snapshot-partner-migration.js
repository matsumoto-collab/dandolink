/**
 * Step 1 マイグレーション適用前後の状態スナップショット用スクリプト。
 * - User テーブルのカラム構成
 * - User.companyId / isLoginEnabled の有無と既存データの埋まり方
 * - User / AssignmentWorker の index 一覧
 * - User 全件・partner ロール件数
 *
 * 実行: node scripts/snapshot-partner-migration.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const userColumns = await p.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='User'
      ORDER BY ordinal_position;
    `);
    console.log('=== User columns ===');
    console.table(userColumns);

    const userIdx = await p.$queryRawUnsafe(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='User'
      ORDER BY indexname;
    `);
    console.log('=== User indexes ===');
    console.table(userIdx);

    const awIdx = await p.$queryRawUnsafe(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='AssignmentWorker'
      ORDER BY indexname;
    `);
    console.log('=== AssignmentWorker indexes ===');
    console.table(awIdx);

    const userTotal = await p.user.count();
    const partnerTotal = await p.user.count({ where: { role: { in: ['PARTNER', 'partner'] } } });
    console.log('=== Counts ===');
    console.log('User total:', userTotal, ' PARTNER:', partnerTotal);

    // companyId / isLoginEnabled が存在する場合の集計（適用後のみ通る）
    try {
      const breakdown = await p.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN "companyId" IS NULL THEN 1 ELSE 0 END)::int AS company_id_null,
          SUM(CASE WHEN "isLoginEnabled" = true THEN 1 ELSE 0 END)::int AS login_enabled_true,
          SUM(CASE WHEN "isLoginEnabled" = false THEN 1 ELSE 0 END)::int AS login_enabled_false
        FROM "public"."User";
      `);
      console.log('=== Post-migration data fill (companyId / isLoginEnabled) ===');
      console.table(breakdown);
    } catch (e) {
      console.log('(companyId / isLoginEnabled カラム未存在 — マイグレーション適用前)');
    }
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();
