/**
 * 評価ポイントの「ありがとう」のマイグレーションの「適用の前」と「適用のあと」を確かめる。**読み取り（SELECT）のみ**。
 *
 *   npx tsx --env-file=.env scripts/verify-evaluation-thanks.ts
 *
 * 見るもの（1回の実行で両方を出す。テーブルがまだ無いときは、落ちずに「まだ無い」と出す）:
 *
 *  【適用の前】
 *   A. prisma/migrations のフォルダのうち、DB の _prisma_migrations にまだ（正常に）入っていないもの。
 *      適用の前は「…_add_evaluation_point_thanks の1本だけ」であること。ほかにもあれば、migrate deploy が一緒に流すので止まる。
 *   B. EvaluationPointThanks で始まるテーブルが、まだ1つも無いこと
 *      （あった場合は、SQL が IF NOT EXISTS なので古い形のまま残ってしまう。止まる）。
 *
 *  【適用のあと】（流した直後に確かめるためのもの。「使う」にしたり送ったりしたあとは、2・3 は変わる）
 *   1. EvaluationPointThanks で始まるテーブルが 2・列が合わせて 13・索引が 5・外部キーが 0
 *   2. EvaluationPointThanksSetting に id = 'default' の行が1つあり、isActive が false・pointsPerThanks が 1
 *   3. EvaluationPointThanks は 0 行
 *   4. 2つのテーブルとも anon_any・auth_any が false で、rls_on が true（FORCE なし・ポリシー 0）
 *   5. 2つのテーブルの持ち主が、評価ポイントのほかのテーブルと同じ（postgres）
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

const MIGRATION_SUFFIX = '_add_evaluation_point_thanks';
const TABLES = ['EvaluationPointThanks', 'EvaluationPointThanksSetting'] as const;
const EXPECTED = { tables: 2, columns: 13, indexes: 5, foreignKeys: 0 };
const EXPECTED_OWNER = 'postgres';

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
            console.log('未適用: なし（「ありがとう」のマイグレーションも適用済み＝【適用のあと】の結果を見る）');
        } else {
            console.log(`未適用: ${pending.length} 本`);
            for (const name of pending) console.log(`  - ${name}`);
            const onlyOurs = pending.length === 1 && pending[0].endsWith(MIGRATION_SUFFIX);
            console.log(`適用の前の判定（「ありがとう」の1本だけか）: ${ok(onlyOurs)}`);
            if (!onlyOurs) {
                problems++;
                console.log('  ✗ 「ありがとう」以外にも未適用がある（または「ありがとう」の1本が無い）。migrate deploy を頼まずに kei に知らせる。');
            }
        }
        if (failed.length > 0) {
            problems++;
            console.log(`  ✗ 途中で失敗したままのマイグレーションがある: ${failed.join(', ')}`);
        }

        // B. テーブルがあるか（無くても例外にしない）
        console.log('\n=== 【適用の前】B. EvaluationPointThanks で始まるテーブル ===');
        const existingRows = await prisma.$queryRaw<{ relname: string }[]>`
            SELECT c.relname
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname LIKE 'EvaluationPointThanks%' AND c.relkind = 'r'
            ORDER BY c.relname`;
        const existing = new Set(existingRows.map((r) => r.relname));
        for (const t of TABLES) console.log(`  ${existing.has(t) ? 'ある  ' : 'まだ無い'} ${t}`);
        const unexpected = existingRows.map((r) => r.relname).filter((name) => !(TABLES as readonly string[]).includes(name));
        if (unexpected.length > 0) {
            problems++;
            console.log(`  ✗ 2つのほかに、EvaluationPointThanks で始まるテーブルがある: ${unexpected.join(', ')}`);
        }

        if (existing.size === 0) {
            if (oursApplied) {
                problems++;
                console.log('  ✗ マイグレーションは適用済みと記録されているのに、テーブルが1つも無い。kei に知らせる。');
            } else {
                console.log('「ありがとう」のテーブルは、まだ1つも無い（適用の前なら、これで正しい）。【適用のあと】は飛ばす。');
            }
            return;
        }
        if (!oursApplied) {
            problems++;
            console.log('  ✗ マイグレーションが未適用なのに、テーブルがもうある（SQL が IF NOT EXISTS なので、古い形のまま残る）。');
            console.log('    migrate deploy を頼まずに kei に知らせる。');
        }

        // ================================================================ 適用のあと
        console.log('\n=== 【適用のあと】 ===');

        // 1. テーブル・列・索引・外部キーの数
        console.log('--- 1) テーブル・列・索引・外部キーの数 ---');
        const [counts] = await prisma.$queryRaw<{ columns: number; indexes: number; foreign_keys: number }[]>`
            SELECT
                (SELECT count(*)::int FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name LIKE 'EvaluationPointThanks%') AS columns,
                (SELECT count(*)::int FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename LIKE 'EvaluationPointThanks%') AS indexes,
                (SELECT count(*)::int FROM pg_constraint con
                   JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname LIKE 'EvaluationPointThanks%' AND con.contype = 'f') AS foreign_keys`;
        const allTables = TABLES.every((t) => existing.has(t));
        const countRows: [string, number, number][] = [
            ['テーブル', existing.size, EXPECTED.tables],
            ['列', counts.columns, EXPECTED.columns],
            ['索引', counts.indexes, EXPECTED.indexes],
            ['外部キー', counts.foreign_keys, EXPECTED.foreignKeys],
        ];
        for (const [label, actual, expected] of countRows) {
            const rowOk = actual === expected;
            console.log(`  ${ok(rowOk)} ${label}: ${actual}（${expected} のはず）`);
            if (!rowOk) problems++;
        }
        console.log(`  ${ok(allTables)} 2つのテーブルが、名前のとおりにそろっている`);
        if (!allTables) problems++;

        // 2. 設定の初期行
        console.log('\n--- 2) 設定（EvaluationPointThanksSetting） ---');
        if (existing.has('EvaluationPointThanksSetting')) {
            const settings = await prisma.evaluationPointThanksSetting.findMany({ select: { id: true, isActive: true, pointsPerThanks: true } });
            const def = settings.find((s) => s.id === 'default');
            console.log(`  行数: ${settings.length} / id='default' の行: ${def ? 'ある' : '無い'} / isActive: ${def ? String(def.isActive) : '—'} / pointsPerThanks: ${def ? def.pointsPerThanks : '—'}`);
            const settingOk = settings.length === 1 && !!def && def.isActive === false && def.pointsPerThanks === 1;
            console.log(`  判定（「使わない」・1回 1点の1行だけ）: ${ok(settingOk)}`);
            if (!settingOk) problems++;
        } else {
            console.log('  テーブルがまだ無い');
        }

        // 3. 記録は 0 行
        console.log('\n--- 3) 「ありがとう」の記録（0 行のはず） ---');
        if (existing.has('EvaluationPointThanks')) {
            const n = await prisma.evaluationPointThanks.count();
            console.log(`  ${ok(n === 0)} EvaluationPointThanks: ${n} 件`);
            if (n !== 0) problems++;
        } else {
            console.log('  テーブルがまだ無い');
        }

        // 4. Supabase の公開キー（anon・authenticated）から読み書きできないこと・RLS が有効なこと
        console.log('\n--- 4) 権限と RLS ---');
        const privileges = await prisma.$queryRaw<{ relname: string; owner: string; anon_any: boolean; auth_any: boolean; rls_on: boolean; rls_forced: boolean }[]>`
            SELECT c.relname,
                   pg_get_userbyid(c.relowner)                                                   AS owner,
                   has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')          AS anon_any,
                   has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS auth_any,
                   c.relrowsecurity                                                              AS rls_on,
                   c.relforcerowsecurity                                                         AS rls_forced
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname LIKE 'EvaluationPointThanks%' AND c.relkind = 'r'
            ORDER BY c.relname`;
        for (const p of privileges) {
            const rowOk = !p.anon_any && !p.auth_any && p.rls_on && !p.rls_forced;
            console.log(`  ${ok(rowOk)} ${p.relname}: anon_any=${p.anon_any} auth_any=${p.auth_any} rls_on=${p.rls_on} force=${p.rls_forced}`);
            if (!rowOk) problems++;
        }
        if (privileges.some((p) => p.anon_any || p.auth_any || !p.rls_on)) {
            console.log('  ✗ anon_any・auth_any に true がある、または rls_on に false がある。push せずに kei に知らせる。');
        }
        const [policies] = await prisma.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'EvaluationPointThanks%'`;
        console.log(`  ${ok(policies.n === 0)} ポリシー: ${policies.n} 個（0 のはず）`);
        if (policies.n !== 0) problems++;

        // 5. 持ち主が、評価ポイントのほかのテーブルと同じ（postgres）
        console.log('\n--- 5) テーブルの持ち主 ---');
        const otherOwners = await prisma.$queryRaw<{ owner: string }[]>`
            SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND c.relname LIKE 'EvaluationPoint%' AND c.relname NOT LIKE 'EvaluationPointThanks%'`;
        const owners = Array.from(new Set(privileges.map((p) => p.owner)));
        const otherOwnerNames = otherOwners.map((o) => o.owner);
        const ownerOk = owners.length === 1
            && owners[0] === EXPECTED_OWNER
            && otherOwnerNames.length === 1
            && otherOwnerNames[0] === owners[0];
        console.log(`  「ありがとう」のテーブルの持ち主: ${owners.join(', ') || '—'} / 評価ポイントのほかのテーブルの持ち主: ${otherOwnerNames.join(', ') || '—'}`);
        console.log(`  判定（どちらも ${EXPECTED_OWNER} の1種類）: ${ok(ownerOk)}`);
        if (!ownerOk) problems++;
    } finally {
        console.log(`\n問題の数: ${problems}`);
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
