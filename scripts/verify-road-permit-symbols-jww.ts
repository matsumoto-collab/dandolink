/* eslint-disable no-console */
/**
 * 道路申請の記号（Phase 2b）: JWW を ezjww で読んで parseJwwBlocks にかけ、ブロックごとの結果を表に出す（DB は使わない）。
 *
 *   npx tsx scripts/verify-road-permit-symbols-jww.ts --file <jww か jws のパス> [--name <ブロック名の一部>]
 *
 * 出すもの: 番号・名前（掃除したもの）・大きさ（長さ×幅 mm）・線の本数・倍率・簡略化・近くの文字。最後に注意（warnings）と読むのにかかった時間。
 * ※ データ（kei の JWW）はこのスクリプトに入れない。パスは引数で受け取る。
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { parseJwwBlocks } from '@/lib/roadPermit/symbols/jwwImport';
import { formatSymbolSize } from '@/lib/roadPermit/symbols/normalize';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
    const file = arg('--file');
    const filter = arg('--name');
    if (!file) {
        console.error('使い方: npx tsx scripts/verify-road-permit-symbols-jww.ts --file <jww のパス> [--name <ブロック名の一部>]');
        process.exit(1);
    }
    const ez = await import('ezjww');
    const bytes = new Uint8Array(readFileSync(file));
    const t0 = Date.now();
    const format = ez.detectFileFormat(bytes);
    if (format !== 'jww' && format !== 'jws') {
        console.error(`JWW / JWS として読めません（判定: ${format ?? '不明'}）`);
        process.exit(1);
    }
    const doc = format === 'jws' ? ez.readJwsDocument(bytes) : ez.readDocument(bytes);
    const t1 = Date.now();
    const result = parseJwwBlocks(doc);
    const t2 = Date.now();

    const totalEntities = Object.values(doc.entity_counts ?? {}).reduce((a, b) => a + b, 0)
        + (doc.block_defs ?? []).reduce((a, d) => a + (d.entities?.length ?? 0), 0);
    console.log(`ファイル: ${basename(file)}（${format}）・ブロック ${doc.block_defs?.length ?? 0} 個・要素 ${totalEntities.toLocaleString('ja-JP')}`);
    console.log(`読み込み ${t1 - t0}ms・変換 ${t2 - t1}ms・候補 ${result.blocks.length} 個`);

    const rows = result.blocks
        .filter((b) => !filter || b.name.includes(filter) || b.rawName.includes(filter))
        .map((b) => ({
            番号: b.key,
            名前: b.name,
            '大きさ(長さ×幅)': formatSymbolSize(b),
            '長さ(mm)': Math.round(b.lengthMm * 100) / 100,
            '幅(mm)': Math.round(b.widthMm * 100) / 100,
            線の本数: b.primitiveCount,
            倍率: b.scaleApplied,
            簡略化: b.simplified ? `${b.simplified.before}→${b.simplified.after}` : '',
            近くの文字: b.nearbyTexts.join(' / '),
        }));
    console.table(rows);
    if (result.warnings.length > 0) {
        console.log('注意:');
        for (const w of result.warnings) console.log(`  - ${w}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
