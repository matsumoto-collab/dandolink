/**
 * 手当の「金額を手で直す」のマイグレーションの「適用の前」と「適用のあと」を確かめる。**読み取り（SELECT）のみ**。
 *
 *   npx tsx --env-file=.env scripts/verify-allowance-amount-edit.ts
 *
 *  【適用の前】
 *   A. prisma/migrations のフォルダのうち、DB の _prisma_migrations にまだ（正常に）入っていないもの。
 *      「…_add_allowance_record_amount_edit の1本だけ」であること。ほかにもあれば、migrate deploy が一緒に流すので止まる。
 *   B. AllowanceRecord に、足す3つの列（amountEditedAt・amountEditedBy・amountEditedByName）が、まだ無いこと。
 *
 *  【適用のあと】
 *   1. AllowanceRecord の列が 22（もとの 19 ＋ 3）で、足した3つの列が、型どおり・空でよい列になっていること
 *   2. すでにある記録は、3つとも NULL（＝手で直していない）。記録の件数と金額の合計が、適用の前と変わっていないこと（数字を出す）
 *   3. Allowance で始まるテーブルの数（6）・索引（14）・外部キー（2）・RLS・権限が、前のまま
 */
export {};

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const MIGRATION_SUFFIX = '_add_allowance_record_amount_edit';
const NEW_COLUMNS: Record<string, string> = {
    amountEditedAt: 'timestamp without time zone',
    amountEditedBy: 'text',
    amountEditedByName: 'text',
};
const EXPECTED_RECORD_COLUMNS = 22;

const ok = (cond: boolean) => (cond ? 'OK' : 'NG');

/* eslint-disable no-console */

async function main() {
    const { prisma } = await import('../lib/prisma');
    let problems = 0;

    try {
        // ================================================================ 適用の前
        console.log('=== 【適用の前】A. まだ適用していないマイグレーション ===');
        const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
        const folders = readdirSync(migrationsDir)
            .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
            .sort();
        const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
            SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
        const appliedOk = new Set(applied.filter((m) => m.finished_at !== null && m.rolled_back_at === null).map((m) => m.migration_name));
        const failed = applied.filter((m) => m.finished_at === null && m.rolled_back_at === null).map((m) => m.migration_name);
        const pending = folders.filter((name) => !appliedOk.has(name));
        const oursApplied = folders.some((name) => name.endsWith(MIGRATION_SUFFIX) && appliedOk.has(name));
        console.log(`リポジトリのフォルダ: ${folders.length} 本 / DB に適用済み: ${appliedOk.size} 本`);
        if (pending.length === 0) {
            console.log('未適用: なし（このマイグレーションも適用済み＝【適用のあと】の結果を見る）');
        } else {
            console.log(`未適用: ${pending.length} 本`);
            for (const name of pending) console.log(`  - ${name}`);
            const onlyOurs = pending.length === 1 && pending[0].endsWith(MIGRATION_SUFFIX);
            console.log(`適用の前の判定（この1本だけか）: ${ok(onlyOurs)}`);
            if (!onlyOurs) {
                problems++;
                console.log('  ✗ ほかにも未適用がある（またはこの1本が無い）。migrate deploy を頼まずに kei に知らせる。');
            }
        }
        if (failed.length > 0) {
            problems++;
            console.log(`  ✗ 途中で失敗したままのマイグレーションがある: ${failed.join(', ')}`);
        }

        // 列の今の形（適用の前後で共通）
        const columns = await prisma.$queryRaw<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]>`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'AllowanceRecord'
            ORDER BY ordinal_position`;
        const byName = new Map(columns.map((c) => [c.column_name, c]));
        const present = Object.keys(NEW_COLUMNS).filter((name) => byName.has(name));

        console.log('\n=== 【適用の前】B. AllowanceRecord に足す3つの列 ===');
        for (const name of Object.keys(NEW_COLUMNS)) console.log(`  ${byName.has(name) ? 'ある  ' : 'まだ無い'} ${name}`);
        console.log(`  AllowanceRecord の列の数: ${columns.length}`);

        // 記録の件数と金額の合計（適用の前後で変わらないことを、数字で見比べる）
        const [totals] = await prisma.$queryRaw<{ n: number; total: number }[]>`
            SELECT count(*)::int AS n, coalesce(sum("amount"), 0)::int AS total FROM "public"."AllowanceRecord"`;
        console.log(`  記録: ${totals.n} 件 / 金額の合計: ${totals.total} 円（適用の前後で同じであること）`);

        if (present.length === 0) {
            if (oursApplied) {
                problems++;
                console.log('  ✗ マイグレーションは適用済みと記録されているのに、列が無い。kei に知らせる。');
            } else {
                console.log('足す列は、まだ1つも無い（適用の前なら、これで正しい）。【適用のあと】は飛ばす。');
            }
            return;
        }
        if (!oursApplied) {
            problems++;
            console.log('  ✗ マイグレーションが未適用なのに、列がもうある。migrate deploy を頼まずに kei に知らせる。');
        }

        // ================================================================ 適用のあと
        console.log('\n=== 【適用のあと】 ===');
        console.log('--- 1) 足した列の形 ---');
        for (const [name, type] of Object.entries(NEW_COLUMNS)) {
            const c = byName.get(name);
            const colOk = !!c && c.data_type === type && c.is_nullable === 'YES' && c.column_default === null;
            console.log(`  ${ok(colOk)} ${name}: ${c ? `${c.data_type} / 空でよい=${c.is_nullable} / 既定値=${c.column_default ?? 'なし'}` : '無い'}`);
            if (!colOk) problems++;
        }
        const countOk = columns.length === EXPECTED_RECORD_COLUMNS;
        console.log(`  ${ok(countOk)} AllowanceRecord の列の数: ${columns.length}（${EXPECTED_RECORD_COLUMNS} のはず）`);
        if (!countOk) problems++;

        console.log('\n--- 2) すでにある記録は「手で直していない」のまま ---');
        const [edited] = await prisma.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM "public"."AllowanceRecord"
            WHERE "amountEditedAt" IS NOT NULL OR "amountEditedBy" IS NOT NULL OR "amountEditedByName" IS NOT NULL`;
        console.log(`  手で直した印のある記録: ${edited.n} 件（流した直後は 0。管理者が直しはじめたあとは、増えるのが正しい）`);

        console.log('\n--- 3) 手当のテーブルの、ほかの所が前のまま ---');
        const [shape] = await prisma.$queryRaw<{ tables: number; indexes: number; foreign_keys: number; rls_on: number; anon_or_auth: number }[]>`
            SELECT
                (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'Allowance%') AS tables,
                (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'Allowance%') AS indexes,
                (SELECT count(*)::int FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname LIKE 'Allowance%' AND con.contype = 'f') AS foreign_keys,
                (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'Allowance%' AND c.relrowsecurity) AS rls_on,
                (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'Allowance%'
                    AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                      OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))) AS anon_or_auth`;
        const rows: [string, number, number][] = [
            ['テーブル', shape.tables, 6],
            ['索引', shape.indexes, 14],
            ['外部キー', shape.foreign_keys, 2],
            ['RLS が有効なテーブル', shape.rls_on, 6],
            ['anon・authenticated に権限があるテーブル', shape.anon_or_auth, 0],
        ];
        for (const [label, actual, expected] of rows) {
            const rowOk = actual === expected;
            console.log(`  ${ok(rowOk)} ${label}: ${actual}（${expected} のはず）`);
            if (!rowOk) problems++;
        }
    } finally {
        console.log(`\n問題の数: ${problems}`);
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
