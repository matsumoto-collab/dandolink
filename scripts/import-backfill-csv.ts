/**
 * 過去データCSV取込をコマンドで行う（画面「設定 > 過去データ取込」と同じ処理 lib/backfill/engine）。
 * 画面から取り込むと Vercel の時間制限に当たる場合の逃げ道。
 *
 *   ドライラン : npx tsx scripts/import-backfill-csv.ts
 *   リハーサル : npx tsx scripts/import-backfill-csv.ts --rehearse
 *                （本実行と同じ書き込みを最後まで流して合計を数え、必ず取り消す。DB には何も残らない）
 *   本実行     : npx tsx scripts/import-backfill-csv.ts --apply
 *   取り消し   : npx tsx scripts/import-backfill-csv.ts --rollback=<バッチID>          （確認だけ）
 *                npx tsx scripts/import-backfill-csv.ts --rollback=<バッチID> --apply  （実行）
 *   フォルダ指定: BACKFILL_DIR="C:/…/Claude outputs" npx tsx scripts/import-backfill-csv.ts
 *
 * 前提: マイグレーション 20260911180000_add_backfill_import が適用済みであること。
 */
export {};
import fs from 'fs';
import path from 'path';

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const DIR = process.env.BACKFILL_DIR ?? 'C:/Users/yushink/Desktop/段取日報/Claude outputs';
const APPLY = process.argv.includes('--apply');
const REHEARSE = process.argv.includes('--rehearse');
const rollbackArg = process.argv.find((a) => a.startsWith('--rollback='));
const ROLLBACK_ID = rollbackArg ? rollbackArg.split('=')[1] : null;

const yen = (n: number) => n.toLocaleString('ja-JP');

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { preparePlan, applyPlan, previewRollback, rollbackBatch } = await import('../lib/backfill/engine');
    const { BACKFILL_FILE_LABELS } = await import('../lib/backfill/parse');

    try {
        if (ROLLBACK_ID) {
            const preview = await previewRollback(prisma, ROLLBACK_ID);
            console.log(`バッチ ${ROLLBACK_ID}（${preview.status}）を取り消すと消えるもの:`);
            console.log(`  案件 ${preview.counts.projects} / 請求書 ${preview.counts.invoices} / 作業履歴 ${preview.counts.assignments} / 売上調整 ${preview.counts.adjustments}`);
            if (preview.blocked.length) console.log(`  進行中のデータが紐づいているので消さない案件 ${preview.blocked.length}件`);
            if (!APPLY) { console.log('\n確認だけです。実行するには --apply を付けてください。'); return; }
            const done = await rollbackBatch(prisma, ROLLBACK_ID, null);
            console.log('取り消しました:', done);
            return;
        }

        const files = {
            projects: fs.readFileSync(path.join(DIR, BACKFILL_FILE_LABELS.projects), 'utf8'),
            sales: fs.readFileSync(path.join(DIR, BACKFILL_FILE_LABELS.sales), 'utf8'),
            works: fs.readFileSync(path.join(DIR, BACKFILL_FILE_LABELS.works), 'utf8'),
            adjustments: fs.readFileSync(path.join(DIR, BACKFILL_FILE_LABELS.adjustments), 'utf8'),
        };

        console.log(
            REHEARSE ? '=== リハーサル（書き込んで数えたあと必ず取り消します）===\n'
                : APPLY ? '=== 本実行（DB に書き込みます）===\n'
                    : '=== ドライラン（書き込みません）===\n',
        );
        const t0 = Date.now();
        const prepared = await preparePlan(prisma, files);
        const s = prepared.summary;
        const c = s.counts;
        const line = (label: string, x: typeof c.projects) =>
            console.log(`  ${label.padEnd(6)} ${String(x.total).padStart(5)}行  新規 ${x.create} / 上書き ${x.update} / 消す ${x.delete}`);
        line('案件', c.projects); line('売上', c.sales); line('作業履歴', c.works); line('売上調整', c.adjustments);
        console.log(`\n  現場別売上 ${yen(s.totals.salesAmount)} ＋ 売上調整 ${yen(s.totals.adjustmentAmount)} ＝ ${yen(s.totals.grandTotal)}（税抜）`);
        console.log(`  自社の延べ人工 ${yen(s.totals.ownManDays)} ／ 外注の行 ${s.totals.subcontractRows}（人数0で登録）／ 人数補完 ${s.totals.filledRows}行 ／ 非現場 ${s.totals.nonSiteProjects}件`);
        console.log('\n  期別:');
        for (const t of s.terms) {
            console.log(`    ${t.label}（${t.from}〜${t.to}）売上 ${yen(t.sales)} / 人工 ${yen(t.manDays)} / 売上÷人工 ${t.salesPerManDay === null ? '—' : yen(t.salesPerManDay)}`);
        }
        console.log(`\n  職長: 既存ユーザーと一致 ${s.mapping.foremenMatched}名 / 一致しない ${s.mapping.foremenUnmatched.length}名（${s.mapping.foremenUnmatched.slice(0, 8).map((f) => `${f.name}${f.rows}`).join('・')}…）`);
        console.log(`  顧客: 顧客マスタと一致 ${s.mapping.customersMatched}件 / 一致しない ${s.mapping.customersUnmatched.length}社`);
        if (s.blockedDeletes.length) console.log(`\n  消さない案件（進行中のデータが紐づいている）${s.blockedDeletes.length}件`);
        console.log(`\n  エラー ${s.errors.length}件 / 注意 ${s.warnings.length}件`);
        for (const e of s.errors.slice(0, 20)) console.log(`    [エラー] ${BACKFILL_FILE_LABELS[e.file]} ${e.line}行目: ${e.message}`);
        for (const w of s.warnings.slice(0, 5)) console.log(`    [注意] ${BACKFILL_FILE_LABELS[w.file]} ${w.line}行目: ${w.message}`);
        console.log(`\n  （ドライラン ${((Date.now() - t0) / 1000).toFixed(1)}秒）`);

        if (!APPLY && !REHEARSE) { console.log('\n書き込みは行っていません。取り込むには --apply を付けてください。'); return; }
        if (!s.canApply) { console.log('\n中止: エラーのある行があります。'); process.exitCode = 1; return; }

        const t1 = Date.now();
        const result = await applyPlan(
            prisma,
            prepared,
            { userId: null, userName: 'コマンド取込', fileNames: { ...BACKFILL_FILE_LABELS } },
            { rehearse: REHEARSE },
        );
        const secs = ((Date.now() - t1) / 1000).toFixed(1);
        console.log(result.rehearsed
            ? `\nリハーサル完了（${secs}秒）。書き込みはすべて取り消したので DB は変わっていません。`
            : `\n取り込みました（バッチ ${result.batchId}・${secs}秒）`);
        console.log('  書いた行:', result.written, '\n  消した行:', result.deleted);
        const t = result.totalsAfter;
        console.log(`  書いた直後の過去データ: 案件 ${yen(t.projects)} / 現場別売上 ${yen(t.salesAmount)} / 売上調整 ${yen(t.adjustmentAmount)} / 合計 ${yen(t.salesAmount + t.adjustmentAmount)} / 自社人工 ${yen(t.ownManDays)}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
