/**
 * 評価ポイントのマイグレーションの「適用の前」と「適用のあと」を確かめる。**読み取り（SELECT）のみ**。
 * （docs/指示書_評価ポイント.md の 8-4）
 *
 *   npx tsx scripts/verify-evaluation-points.ts
 *
 * 見るもの（1回の実行で両方を出す。テーブルがまだ無いときは、落ちずに「まだ無い」と出す）:
 *
 *  【適用の前】
 *   A. prisma/migrations のフォルダのうち、DB の _prisma_migrations にまだ（正常に）入っていないもの。
 *      適用の前は「…_add_evaluation_points の1本だけ」であること。ほかにもあれば、migrate deploy が一緒に流すので止まる。
 *
 *  【適用のあと】
 *   1. 5つのテーブルがあること
 *   2. EvaluationPointSetting に id = 'default' の行が1つあり、showToMembers が false であること
 *   3. 5つのテーブルとも anon_any・auth_any が false で、rls_on が true であること
 *   4. 項目・点数の履歴・記録・操作の履歴の件数（確認用）
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

const MIGRATION_SUFFIX = '_add_evaluation_points';
const TABLES = [
    'EvaluationPointItem',
    'EvaluationPointRate',
    'EvaluationPointRecord',
    'EvaluationPointLog',
    'EvaluationPointSetting',
] as const;

const ok = (cond: boolean) => (cond ? 'OK' : 'NG');

/* eslint-disable no-console */

async function main() {
    const { prisma } = await import('../lib/prisma');
    let problems = 0;

    try {
        // ================================================================ 適用の前
        console.log('=== 【適用の前】まだ適用していないマイグレーション ===');
        const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
        const folders = readdirSync(migrationsDir)
            .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
            .sort();

        const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
            SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
        const appliedOk = new Set(applied.filter((m) => m.finished_at !== null && m.rolled_back_at === null).map((m) => m.migration_name));
        const failed = applied.filter((m) => m.finished_at === null && m.rolled_back_at === null).map((m) => m.migration_name);

        const pending = folders.filter((name) => !appliedOk.has(name));
        console.log(`リポジトリのフォルダ: ${folders.length} 本 / DB に適用済み: ${appliedOk.size} 本`);
        if (pending.length === 0) {
            console.log('未適用: なし（評価ポイントのマイグレーションも適用済み＝【適用のあと】の結果を見る）');
        } else {
            console.log(`未適用: ${pending.length} 本`);
            for (const name of pending) console.log(`  - ${name}`);
            const onlyOurs = pending.length === 1 && pending[0].endsWith(MIGRATION_SUFFIX);
            console.log(`適用の前の判定（評価ポイントの1本だけか）: ${ok(onlyOurs)}`);
            if (!onlyOurs) {
                problems++;
                console.log('  ✗ 評価ポイント以外にも未適用がある（または評価ポイントの1本が無い）。migrate deploy を頼まずに kei に知らせる。');
            }
        }
        if (failed.length > 0) {
            problems++;
            console.log(`  ✗ 途中で失敗したままのマイグレーションがある: ${failed.join(', ')}`);
        }

        // ================================================================ 適用のあと
        console.log('\n=== 【適用のあと】 ===');

        // 1. テーブルがあるか（無くても例外にしない）
        const existingRows = await prisma.$queryRaw<{ relname: string }[]>`
            SELECT c.relname
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname LIKE 'EvaluationPoint%' AND c.relkind = 'r'`;
        const existing = new Set(existingRows.map((r) => r.relname));
        console.log('--- 1) テーブル ---');
        for (const t of TABLES) console.log(`  ${existing.has(t) ? 'ある  ' : 'まだ無い'} ${t}`);
        const allTables = TABLES.every((t) => existing.has(t));
        if (existing.size === 0) {
            console.log('評価ポイントのテーブルは、まだ1つも無い（適用の前なら、これで正しい）。2〜4 は飛ばす。');
            return;
        }
        console.log(`5つともあるか: ${ok(allTables)}`);
        if (!allTables) problems++;

        // 2. 公開の設定の初期行
        console.log('\n--- 2) 公開の設定（EvaluationPointSetting） ---');
        if (existing.has('EvaluationPointSetting')) {
            const settings = await prisma.evaluationPointSetting.findMany({ select: { id: true, showToMembers: true } });
            const def = settings.find((s) => s.id === 'default');
            console.log(`  行数: ${settings.length} / id='default' の行: ${def ? 'ある' : '無い'} / showToMembers: ${def ? String(def.showToMembers) : '—'}`);
            const settingOk = settings.length === 1 && !!def && def.showToMembers === false;
            console.log(`  判定: ${ok(settingOk)}`);
            if (!settingOk) problems++;
        } else {
            console.log('  テーブルがまだ無い');
        }

        // 3. Supabase の公開キー（anon・authenticated）から読み書きできないこと・RLS が有効なこと
        console.log('\n--- 3) 権限と RLS ---');
        const privileges = await prisma.$queryRaw<{ relname: string; anon_any: boolean; auth_any: boolean; rls_on: boolean }[]>`
            SELECT c.relname,
                   has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')          AS anon_any,
                   has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS auth_any,
                   c.relrowsecurity                                                              AS rls_on
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname LIKE 'EvaluationPoint%' AND c.relkind = 'r'
            ORDER BY c.relname`;
        for (const p of privileges) {
            const rowOk = !p.anon_any && !p.auth_any && p.rls_on;
            console.log(`  ${ok(rowOk)} ${p.relname}: anon_any=${p.anon_any} auth_any=${p.auth_any} rls_on=${p.rls_on}`);
            if (!rowOk) problems++;
        }
        if (privileges.some((p) => p.anon_any || p.auth_any || !p.rls_on)) {
            console.log('  ✗ anon_any・auth_any に true がある、または rls_on に false がある。push せずに kei に知らせる。');
        }

        // 4. 件数（確認用）
        console.log('\n--- 4) 件数 ---');
        const count = async (table: (typeof TABLES)[number], fn: () => Promise<number>) =>
            console.log(`  ${table}: ${existing.has(table) ? `${await fn()} 件` : 'テーブルがまだ無い'}`);
        await count('EvaluationPointItem', () => prisma.evaluationPointItem.count());
        await count('EvaluationPointRate', () => prisma.evaluationPointRate.count());
        await count('EvaluationPointRecord', () => prisma.evaluationPointRecord.count());
        await count('EvaluationPointLog', () => prisma.evaluationPointLog.count());
    } finally {
        console.log(`\n問題の数: ${problems}`);
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
