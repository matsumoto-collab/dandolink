/**
 * 受注明細書 PDF（components/pdf/OrderBacklogPDF.tsx）の検証。
 *
 * サーバー用フォント（lib/pdf/registerServerFonts.ts）を登録して **実際に描画** し、
 * 出来上がった PDF を pdfjs で読み直して測る。DB には触らない。
 *
 *   - 26件までは1ページ・27件で2ページになる（1ページ26枠）
 *   - 全ての描画要素が A3 横の紙（1190.55 × 841.89pt）の内側に収まっている
 *     ＝右端がはみ出さない・上下で1行も欠けない
 *   - 見出し・明細・区分行・計・定型文の文字が実際に出ている
 *   - 2ページ目にも見出しが繰り返され、計は最終ページにだけ出る
 *
 * 実行: npx tsx scripts/verify-order-backlog-pdf.tsx
 */
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { COL, OrderBacklogPDF, TABLE_WIDTH } from '../components/pdf/OrderBacklogPDF';
import { bucketBottomLabel, bucketTopLabel } from '../lib/orderBacklog/buckets';
import { buildOrderBacklogSheet, type OrderBacklogSheetReport } from '../lib/orderBacklog/render';
import type { OrderBacklogLineInput } from '../lib/orderBacklog/types';
import '../lib/pdf/registerServerFonts';

/* eslint-disable no-console */

/** A3 横（pt） */
const PAGE_WIDTH = 1190.55;
const PAGE_HEIGHT = 841.89;

let ok = 0;
const failures: string[] = [];

function check(label: string, cond: unknown, detail = ''): void {
    if (cond) {
        ok += 1;
        console.log(`  OK   ${label}`);
    } else {
        failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
        console.log(`  NG   ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

const REPORT: OrderBacklogSheetReport = {
    asOfDate: '2026-06-01',
    applicantName: null,
    individualThreshold: 1000000,
    unreceivedMode: 'remaining',
};

const line = (
    over: Partial<OrderBacklogLineInput> &
        Pick<OrderBacklogLineInput, 'customerName' | 'projectName' | 'contractAmount'>
): OrderBacklogLineInput => ({
    projectMasterId: null,
    workKind: 'temp',
    siteKind: 'other',
    startYm: null,
    endYm: null,
    progressRate: 0,
    receivedAmount: 0,
    schedule: {},
    excluded: false,
    isManual: false,
    sortOrder: 0,
    ...over,
});

/** 個別行3件（長い契約先・工事名を含む）＋ 区分に落ちる小口5件 */
const LINES: OrderBacklogLineInput[] = [
    line({
        customerName: '株式会社アレスホーム名古屋支店',
        projectName: '中央区丸の内三丁目マンション新築工事　仮設足場一式',
        contractAmount: 12_000_000,
        startYm: '2026-05',
        endYm: '2026-08',
        progressRate: 50,
        receivedAmount: 3_000_000,
        schedule: { '2026-06': 5_400_000, '2026-08': 3_600_000 },
        sortOrder: 1,
    }),
    line({
        customerName: '今井建設',
        projectName: '倉庫改修　仮設工事',
        contractAmount: 8_000_000,
        startYm: '2026-03',
        endYm: '2026-06',
        progressRate: 100,
        schedule: { '2026-04': 8_000_000 },
        sortOrder: 2,
    }),
    line({
        customerName: '髙橋工務店',
        projectName: '濵田様邸　新築足場',
        contractAmount: 2_500_000,
        workKind: 'new',
        siteKind: 'house',
        startYm: '2026-06',
        endYm: '2027-03',
        progressRate: 20,
        receivedAmount: 500_000,
        schedule: { later: 2_500_000 },
        sortOrder: 3,
    }),
    line({ customerName: 'A社', projectName: '小口1', contractAmount: 800_000, schedule: { '2026-07': 800_000 }, sortOrder: 4 }),
    line({ customerName: 'B社', projectName: '小口2', contractAmount: 600_000, schedule: { '2026-07': 600_000 }, sortOrder: 5 }),
    line({ customerName: 'C社', projectName: '小口3', contractAmount: 300_000, siteKind: 'house', schedule: { '2026-06': 300_000 }, sortOrder: 6 }),
    line({ customerName: 'D社', projectName: '小口4', contractAmount: 900_000, workKind: 'new', schedule: { '2026-09': 900_000 }, sortOrder: 7 }),
    line({ customerName: 'E社', projectName: '小口5', contractAmount: 400_000, workKind: 'new', siteKind: 'house', schedule: { later: 400_000 }, sortOrder: 8 }),
];

interface PageMetrics {
    text: string;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
}

/** 描画済み PDF を pdfjs で読み、ページごとの文字と描画範囲を測る */
async function measure(buf: Buffer): Promise<PageMetrics[]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const pages: PageMetrics[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        let text = '';
        let minX = Number.POSITIVE_INFINITY;
        let maxX = 0;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = 0;
        for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
            if (!it.str) continue;
            text += it.str;
            if (!it.transform || !it.str.trim()) continue;
            const x = it.transform[4];
            const y = it.transform[5];
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x + (it.width ?? 0));
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y + (it.height ?? 0));
        }
        pages.push({
            text,
            minX: Number.isFinite(minX) ? minX : 0,
            maxX,
            minY: Number.isFinite(minY) ? minY : 0,
            maxY,
            width: viewport.width,
            height: viewport.height,
        });
    }
    return pages;
}

/** 空白（半角・全角）を落として比較する（描画時に文字が分割されるため） */
const squash = (s: string): string => s.replace(/[\s　]/g, '');

async function main(): Promise<void> {
    console.log('受注明細書PDFの検証（実際に描画して測る）');

    console.log('\n【0】列幅（Excel の列幅比を A3 横の印字幅へ按分）');
    console.log(
        `  符号 ${COL.code} / 契約先・工事名 ${COL.name} / 契約額 ${COL.contract} / 着工・完成 ${COL.term} / ` +
            `出来高％ ${COL.rate} / 出来高金額 ${COL.progress} / 既受領 ${COL.received} / 未受領 ${COL.unreceived} / 入金予定 ${COL.month}×9`
    );
    console.log(`  表の総幅 ${TABLE_WIDTH.toFixed(2)}pt`);
    // 左右の余白 18pt ずつ ＝ 印字幅 1154.55pt
    check('表の総幅が印字幅（1154.55pt）以内', TABLE_WIDTH <= 1154.55, `${TABLE_WIDTH.toFixed(2)}pt`);
    check(
        '列幅比が Excel と同じ（契約先・工事名 = 符号の12倍）',
        Math.abs(COL.name / COL.code - 42 / 3.5) < 0.05,
        `${(COL.name / COL.code).toFixed(3)}`
    );

    // ---------------------------------------------------------------- 8件（1ページ）
    console.log('\n【1】8件（個別3＋区分4＝7行）→ 1ページ');
    const sheet = buildOrderBacklogSheet(REPORT, LINES);
    const pages = await measure(await renderToBuffer(<OrderBacklogPDF sheet={sheet} />));

    check('ページ数が1', pages.length === 1, `${pages.length}ページ`);
    const p1 = pages[0];
    console.log(
        `  （描画範囲 x: ${p1.minX.toFixed(1)}〜${p1.maxX.toFixed(1)} / y: ${p1.minY.toFixed(1)}〜${p1.maxY.toFixed(1)}` +
            ` ＝ 用紙 ${PAGE_WIDTH} × ${PAGE_HEIGHT} の内側）`
    );
    check(
        `用紙が A3 横（${PAGE_WIDTH} × ${PAGE_HEIGHT}）`,
        Math.abs(p1.width - PAGE_WIDTH) < 1 && Math.abs(p1.height - PAGE_HEIGHT) < 1,
        `${p1.width.toFixed(2)} × ${p1.height.toFixed(2)}`
    );
    check('右端が用紙内に収まる', p1.maxX <= PAGE_WIDTH, `maxX=${p1.maxX.toFixed(2)} / ${PAGE_WIDTH}`);
    check('左端が用紙内に収まる', p1.minX >= 0, `minX=${p1.minX.toFixed(2)}`);
    check('上端が用紙内に収まる（1行も欠けていない）', p1.maxY <= PAGE_HEIGHT, `maxY=${p1.maxY.toFixed(2)} / ${PAGE_HEIGHT}`);
    check('下端が用紙内に収まる（1行も欠けていない）', p1.minY >= 0, `minY=${p1.minY.toFixed(2)}`);

    const t1 = squash(p1.text);
    check('表題が出ている', t1.includes('受注明細書'), t1.slice(0, 12));
    check('基準日ラベルが出ている', t1.includes('令和8年6月1日現在'));
    check('申込人欄が出ている', t1.includes('申込人'));
    check('（単位　千円）が出ている', t1.includes('（単位千円）'));
    check(
        '見出しが揃っている',
        ['符号', '契約先', '工事名', '契約額', '工事着工日', '完成予定日', '現在出来高', '既受領金額', '未受領金額', '入金予定'].every(
            (h) => t1.includes(h)
        )
    );
    check('入金予定の月見出し（6月〜2月以降）', t1.includes('6月') && t1.includes('12月') && t1.includes('2月以降'));
    check('1件目の契約先が出ている', t1.includes('株式会社アレスホーム名古屋支店'));
    check('1件目の工事名が出ている', t1.includes('中央区丸の内三丁目マンション新築工事仮設足場一式'));
    check('着工・完成予定が出ている', t1.includes('2026/5') && t1.includes('2026/8'));
    check('出来高％が出ている', t1.includes('50%'));
    check('金額が3桁区切りで出ている', t1.includes('12,000') && t1.includes('5,400'));
    check(
        '区分行の見出しが出ている',
        squash(p1.text).includes(squash(bucketTopLabel('temp_other_mid', 2))) &&
            squash(p1.text).includes(squash(bucketBottomLabel('temp_other_mid')).replace('～', '〜')),
        bucketTopLabel('temp_other_mid', 2)
    );
    check('計が出ている', t1.includes('計'));
    check(
        `計の契約額 ${sheet.totals.contractK.toLocaleString('en-US')} が出ている`,
        t1.includes(sheet.totals.contractK.toLocaleString('en-US'))
    );
    check('定型文3行が出ている', t1.includes('資金管理をいたします') && t1.includes('金融機関名') && t1.includes('返済財源'));

    // ---------------------------------------------------------------- 26件（ちょうど1ページ）
    console.log('\n【2】26件（枠ぴったり）→ 1ページ');
    const makeLines = (count: number): OrderBacklogLineInput[] =>
        Array.from({ length: count }, (_, i) =>
            line({
                customerName: `顧客${i + 1}`,
                projectName: `工事${i + 1}`,
                contractAmount: 30_000_000 - i * 100_000,
                startYm: '2026-05',
                endYm: '2026-09',
                progressRate: 50,
                receivedAmount: 1_000_000,
                schedule: { '2026-06': 1_000_000, '2026-08': 500_000 },
                sortOrder: i,
            })
        );

    const sheet26 = buildOrderBacklogSheet(REPORT, makeLines(26));
    const pages26 = await measure(await renderToBuffer(<OrderBacklogPDF sheet={sheet26} />));
    check('26件は1ページ', pages26.length === 1, `${pages26.length}ページ`);
    check('26件でも右端が収まる', pages26[0].maxX <= PAGE_WIDTH, `maxX=${pages26[0].maxX.toFixed(2)}`);
    check('26件でも上端が収まる', pages26[0].maxY <= PAGE_HEIGHT, `maxY=${pages26[0].maxY.toFixed(2)}`);
    check('26件でも下端が収まる', pages26[0].minY >= 0, `minY=${pages26[0].minY.toFixed(2)}`);
    check('26枠目（符号26）が出ている', squash(pages26[0].text).includes('顧客26'));
    check('26件でも計が同じページに出る', squash(pages26[0].text).includes('計'));

    // ---------------------------------------------------------------- 27件（2ページ）
    console.log('\n【3】27件 → 2ページ・計は最終ページだけ');
    const sheet27 = buildOrderBacklogSheet(REPORT, makeLines(27));
    const pages27 = await measure(await renderToBuffer(<OrderBacklogPDF sheet={sheet27} />));
    check('27件は2ページ', pages27.length === 2, `${pages27.length}ページ`);
    for (const [i, p] of pages27.entries()) {
        check(`${i + 1}ページ目の右端が収まる`, p.maxX <= PAGE_WIDTH, `maxX=${p.maxX.toFixed(2)}`);
        check(`${i + 1}ページ目の上端が収まる`, p.maxY <= PAGE_HEIGHT, `maxY=${p.maxY.toFixed(2)}`);
        check(`${i + 1}ページ目の下端が収まる`, p.minY >= 0, `minY=${p.minY.toFixed(2)}`);
    }
    const t27a = squash(pages27[0]?.text ?? '');
    const t27b = squash(pages27[1]?.text ?? '');
    check('1ページ目に1件目〜26件目', t27a.includes('顧客1') && t27a.includes('顧客26'));
    check('2ページ目に27件目', t27b.includes('顧客27'));
    check('2ページ目にも見出しが繰り返される', t27b.includes('契約先') && t27b.includes('入金予定') && t27b.includes('2月以降'));
    check('計は2ページ目にだけ出る', !t27a.includes('計') && t27b.includes('計'), `1p:${t27a.includes('計')} / 2p:${t27b.includes('計')}`);
    check(
        `2ページ目の計 ${sheet27.totals.contractK.toLocaleString('en-US')}`,
        t27b.includes(sheet27.totals.contractK.toLocaleString('en-US'))
    );

    // ---------------------------------------------------------------- 0件
    console.log('\n【4】0件でも様式1枚を出す');
    const empty = buildOrderBacklogSheet(REPORT, []);
    const pagesEmpty = await measure(await renderToBuffer(<OrderBacklogPDF sheet={empty} />));
    check('0件でも1ページ', pagesEmpty.length === 1, `${pagesEmpty.length}ページ`);
    check('0件でも用紙内に収まる', pagesEmpty[0].maxY <= PAGE_HEIGHT && pagesEmpty[0].minY >= 0);
    check('0件でも表題と定型文が出る', squash(pagesEmpty[0].text).includes('受注明細書') && squash(pagesEmpty[0].text).includes('金融機関名'));

    console.log('');
    if (failures.length > 0) {
        console.error(`受注明細書PDF検証 NG（${failures.length}件 / OK ${ok}件）`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log(`受注明細書PDF検証 全パス（${ok} チェック）`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
/* eslint-enable no-console */
