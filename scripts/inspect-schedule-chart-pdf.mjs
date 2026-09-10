/**
 * 生成済みの工程表PDFからテキストの位置を取り出し、はみ出し・並びを検証する。
 * 罫線やバーの色は別途（描画命令の集計）で見ている。
 *
 * 実行: node scripts/inspect-schedule-chart-pdf.mjs <file.pdf>
 */
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
    console.error('使い方: node scripts/inspect-schedule-chart-pdf.mjs <file.pdf>');
    process.exit(1);
}

// PDF内の寸法（ScheduleChartPDF.tsx と同じ値）
const PAGE_WIDTH = 1190.55;
const PADDING_X = 24;
const NAME_COL_WIDTH = 118;
const TYPE_COL_WIDTH = 44;
const GRID_LEFT = PADDING_X + NAME_COL_WIDTH + TYPE_COL_WIDTH;

const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
console.log(`ページ数: ${doc.numPages}`);

const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1 });
console.log(`ページサイズ: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)} pt (A3横=1190.55 x 841.89)`);

const content = await page.getTextContent();
const items = content.items
    .filter(i => i.str && i.str.trim())
    .map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5], width: i.width }));

console.log(`テキスト要素: ${items.length}個`);

const title = items.find(i => i.text.includes('工') && i.text.includes('程') && i.text.includes('表'));
if (title) {
    console.log(`\nタイトル "${title.text}" 中心x=${(title.x + title.width / 2).toFixed(1)} (ページ中央=${(PAGE_WIDTH / 2).toFixed(1)})`);
}

// 工程行のラベルが案件ごとに3つ揃っているか
for (const label of ['組立', 'その他', '解体']) {
    const found = items.filter(i => i.text === label && i.x < GRID_LEFT && i.x >= PADDING_X + NAME_COL_WIDTH - 1);
    console.log(`工程行 "${label}": ${found.length}行`);
}

// 現場名・工程名が列からはみ出していないか
const leftBlock = items.filter(i => i.x >= PADDING_X - 1 && i.x < GRID_LEFT && i.y < 700);
const overflow = leftBlock.filter(i => i.x + i.width > GRID_LEFT - 1);
console.log(`\n左2列のテキスト: ${leftBlock.length}個 / はみ出し: ${overflow.length}個`);
for (const o of overflow.slice(0, 5)) {
    console.log(`  はみ出し: "${o.text}" 右端=${(o.x + o.width).toFixed(1)} > ${(GRID_LEFT - 1).toFixed(1)}`);
}

const pageRight = PAGE_WIDTH - PADDING_X;
const outside = items.filter(i => i.x + i.width > pageRight + 1);
console.log(`用紙の右余白を越える文字: ${outside.length}個`);

// 目盛の並び
const dateRow = items
    .filter(i => /^\d{1,2}$/.test(i.text) && i.x >= GRID_LEFT)
    .reduce((acc, i) => { const k = i.y.toFixed(1); (acc[k] ??= []).push(i); return acc; }, {});
const scaleRow = Object.entries(dateRow).sort((a, b) => b[1].length - a[1].length)[0];
if (scaleRow) {
    const scales = scaleRow[1].sort((a, b) => a.x - b.x);
    console.log(`\n日付の目盛: ${scales.length}個  先頭12個: ${scales.slice(0, 12).map(s => s.text).join(' ')}`);
}

// 描画命令から色ごとの図形数（バーが出ているかの確認）
const ops = await page.getOperatorList();
const colorCounts = new Map();
let current = null;
for (let i = 0; i < ops.fnArray.length; i += 1) {
    if (ops.fnArray[i] === OPS.setFillRGBColor) {
        const a = ops.argsArray[i];
        current = Array.isArray(a) ? String(a[0]) : String(a);
    } else if (ops.fnArray[i] === OPS.constructPath) {
        colorCounts.set(current, (colorCounts.get(current) ?? 0) + 1);
    }
}
console.log('\n色ごとの図形数（多い順・上位10）:');
[...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([c, n]) => console.log(`  ${c}\t${n}`));
