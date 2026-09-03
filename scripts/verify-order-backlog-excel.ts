/**
 * 受注明細書 Excel（utils/orderBacklogExcelBuilder.ts）の検証。
 *
 * ダミーの明細（個別行3件＋区分に落ちる小口5件・入金予定は複数月／基準月より前／later を含む）から
 * buildOrderBacklogSheet → buildOrderBacklogWorkbook で **実際に xlsx を生成し**、
 * JSZip で開いて中身（セルの値・数式の不在・シート数）を確かめる。DB には触らない。
 *
 * 見ているのは
 *   - 数式（<f>）が1つも残っていないこと（テンプレの `=E*G` / SUM を値に置き換えているか）
 *   - 明細1枠目（B10・C10・C11・E10・F10・F11・G10・H10・I10・J10・K10〜S10）の値
 *   - 区分行（集約）の見出し文字列
 *   - K9〜S9 の月数値と 12→1 の巻き戻り
 *   - B62='計' と E62・K62 の合計が「表示している千円の合計」と一致すること
 *   - 27件で2シートに分かれ、「計」が2枚目にだけ出ること
 *
 * 実行: npx tsx scripts/verify-order-backlog-excel.ts
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { bucketBottomLabel, bucketTopLabel } from '../lib/orderBacklog/buckets';
import { buildOrderBacklogSheet, type OrderBacklogSheetReport } from '../lib/orderBacklog/render';
import type { OrderBacklogLineInput } from '../lib/orderBacklog/types';
import { buildOrderBacklogWorkbook } from '../utils/orderBacklogExcelBuilder';

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'templates', 'order-backlog-template.xlsx');
const SCHEDULE_COLUMNS = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'] as const;

/* eslint-disable no-console */

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

// ---------------------------------------------------------------- ダミーデータ

const REPORT: OrderBacklogSheetReport = {
    asOfDate: '2026-06-01',
    applicantName: null,
    individualThreshold: 1000000,
    unreceivedMode: 'remaining',
};

const line = (
    over: Partial<OrderBacklogLineInput> & Pick<OrderBacklogLineInput, 'customerName' | 'projectName' | 'contractAmount'>
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

/** 個別行3件（契約額 ≥ 100万）＋ 区分に落ちる小口5件 */
const LINES: OrderBacklogLineInput[] = [
    line({
        customerName: 'アレスホーム',
        projectName: '中央区マンション　仮設足場',
        contractAmount: 12_000_000,
        startYm: '2026-05',
        endYm: '2026-08',
        progressRate: 50,
        receivedAmount: 3_000_000,
        // 複数月に分けた入金予定（6月＝第1列 / 8月＝第3列）
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
        receivedAmount: 0,
        // 基準月（2026-06）より前のキーは第1列に寄る
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
        // 基準月+8 以降は最終列（S＝「2月以降」）へ
        schedule: { later: 2_500_000 },
        sortOrder: 3,
    }),
    // --- 区分に落ちる小口（100万未満）
    line({ customerName: 'A社', projectName: '小口1', contractAmount: 800_000, schedule: { '2026-07': 800_000 }, sortOrder: 4 }),
    line({ customerName: 'B社', projectName: '小口2', contractAmount: 600_000, schedule: { '2026-07': 600_000 }, sortOrder: 5 }),
    line({ customerName: 'C社', projectName: '小口3', contractAmount: 300_000, siteKind: 'house', schedule: { '2026-06': 300_000 }, sortOrder: 6 }),
    line({ customerName: 'D社', projectName: '小口4', contractAmount: 900_000, workKind: 'new', schedule: { '2026-09': 900_000 }, sortOrder: 7 }),
    line({ customerName: 'E社', projectName: '小口5', contractAmount: 400_000, workKind: 'new', siteKind: 'house', schedule: { later: 400_000 }, sortOrder: 8 }),
];

// ---------------------------------------------------------------- xlsx 読み出しの小物

interface SheetCells {
    xml: string;
    /** ref → 表示上の値（数値はそのまま・inlineStr は文字列） */
    value: (ref: string) => string | number | null;
}

function cellReader(xml: string): SheetCells {
    return {
        xml,
        value: (ref: string) => {
            const m = new RegExp(`<c r="${ref}"[^>]*?(/>|>[\\s\\S]*?</c>)`).exec(xml);
            if (!m) return null;
            const cell = m[0];
            const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(cell);
            if (inline) {
                return inline[1]
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'")
                    .replace(/&amp;/g, '&');
            }
            const v = /<v>([\s\S]*?)<\/v>/.exec(cell);
            if (!v) return null;
            const n = Number(v[1]);
            return Number.isFinite(n) ? n : v[1];
        },
    };
}

async function readSheets(bytes: Uint8Array): Promise<{ names: string[]; sheets: SheetCells[]; zip: JSZip }> {
    const zip = await JSZip.loadAsync(bytes);
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    const names = [...workbookXml.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    const sheets: SheetCells[] = [];
    for (let i = 1; i <= names.length; i++) {
        const file = zip.file(`xl/worksheets/sheet${i}.xml`);
        if (!file) throw new Error(`xl/worksheets/sheet${i}.xml がありません`);
        sheets.push(cellReader(await file.async('string')));
    }
    return { names, sheets, zip };
}

// ---------------------------------------------------------------- 本体

async function main(): Promise<void> {
    console.log(`受注明細書Excelの検証（テンプレ: ${TEMPLATE_PATH}）`);
    if (!fs.existsSync(TEMPLATE_PATH)) {
        console.error('テンプレートがありません。先に npx tsx scripts/build-order-backlog-excel-template.ts を実行してください');
        process.exit(1);
    }
    const templateBytes = fs.readFileSync(TEMPLATE_PATH);

    const sheet = buildOrderBacklogSheet(REPORT, LINES);
    const bytes = await buildOrderBacklogWorkbook(templateBytes, sheet);
    const { names, sheets, zip } = await readSheets(bytes);
    const s1 = sheets[0];

    console.log('\n【0】組み立てた行（前提の確認）');
    check('行数が7（個別3＋区分4）', sheet.rows.length === 7, `${sheet.rows.length}行`);
    check('1ページに収まる', sheet.pages.length === 1, `${sheet.pages.length}ページ`);
    check('シート名が「受注明細書」1枚', names.length === 1 && names[0] === '受注明細書', names.join(','));

    console.log('\n【1】数式が残っていない');
    let formulas = 0;
    for (const sh of sheets) formulas += (sh.xml.match(/<f[\s>/]/g) ?? []).length;
    check('全シートに <f>（数式）が無い', formulas === 0, `${formulas}個`);
    check('calcChain.xml が無い', !zip.file('xl/calcChain.xml'));

    console.log('\n【2】見出し（基準日・申込人・入金予定の月）');
    check('F5 = 基準日ラベル', s1.value('F5') === '（令和8年6月1日現在）', String(s1.value('F5')));
    const applicant = String(s1.value('B6') ?? '');
    check('B6 が「申込人」で始まる', applicant.startsWith('申込人　'), applicant.slice(0, 6));
    check('B6 の字数がテンプレと同じ39文字（下線の長さを保つ）', applicant.length === 39, `${applicant.length}文字`);

    // 基準月 6 から 6,7,8,9,10,11,12,1,2（12 の次は 1 に巻き戻る）
    const expectedMonths = [6, 7, 8, 9, 10, 11, 12, 1, 2];
    SCHEDULE_COLUMNS.forEach((col, i) => {
        check(`${col}9 = ${expectedMonths[i]}`, s1.value(`${col}9`) === expectedMonths[i], String(s1.value(`${col}9`)));
    });
    check('R9→S9 で 12月 の次が 1月・2月（巻き戻り）', s1.value('R9') === 1 && s1.value('S9') === 2);

    console.log('\n【3】明細1枠目（行10・11）＝契約額が最大の個別行');
    const r0 = sheet.rows[0];
    check('B10 = 1（符号）', s1.value('B10') === 1, String(s1.value('B10')));
    check('C10 = 契約先', s1.value('C10') === 'アレスホーム', String(s1.value('C10')));
    check('C11 = 工事名', s1.value('C11') === '中央区マンション　仮設足場', String(s1.value('C11')));
    check('E10 = 契約額12,000千円', s1.value('E10') === 12000, String(s1.value('E10')));
    check('F10 = 着工 2026/5', s1.value('F10') === '2026/5', String(s1.value('F10')));
    check('F11 = 完成予定 2026/8', s1.value('F11') === '2026/8', String(s1.value('F11')));
    check('G10 = 0.5（書式 0% で 50%）', s1.value('G10') === 0.5, String(s1.value('G10')));
    check('H10 = 出来高金額6,000千円', s1.value('H10') === 6000, String(s1.value('H10')));
    check('I10 = 既受領3,000千円', s1.value('I10') === 3000, String(s1.value('I10')));
    check('J10 = 未受領6,000千円（契約額−出来高金額）', s1.value('J10') === 6000, String(s1.value('J10')));
    SCHEDULE_COLUMNS.forEach((col, i) => {
        const expected = r0.scheduleK[i];
        const actual = s1.value(`${col}10`);
        check(
            `${col}10 = ${expected || '(空欄)'}`,
            expected ? actual === expected : actual === null,
            String(actual)
        );
    });
    check('K10 = 5,400（6月ぶん）', s1.value('K10') === 5400, String(s1.value('K10')));
    check('M10 = 3,600（8月ぶん）', s1.value('M10') === 3600, String(s1.value('M10')));
    check('L10 は空欄（0 は書かない）', s1.value('L10') === null, String(s1.value('L10')));

    console.log('\n【4】基準月より前 / later の寄せ先');
    // 2番目の枠（行12・13）＝ 8,000千円の案件。2026-04 は基準月より前 → 第1列(K)
    check('K12 = 8,000（基準月より前の入金予定が第1列へ）', s1.value('K12') === 8000, String(s1.value('K12')));
    // 3番目の枠（行14・15）＝ later
    check('S14 = 2,500（later が最終列へ）', s1.value('S14') === 2500, String(s1.value('S14')));
    check('K14 は空欄', s1.value('K14') === null, String(s1.value('K14')));

    console.log('\n【5】区分行（集約）の見出し');
    // 4番目の枠（行16・17）＝ 最初の区分（その他仮設工事 2件）
    const bucketRow = sheet.rows[3];
    check('区分行が4行目から', bucketRow.kind === 'bucket', bucketRow.kind);
    check(
        `C16 = ${bucketTopLabel('temp_other_mid', 2)}`,
        s1.value('C16') === bucketTopLabel('temp_other_mid', 2),
        String(s1.value('C16'))
    );
    check(
        `C17 = ${bucketBottomLabel('temp_other_mid')}`,
        s1.value('C17') === bucketBottomLabel('temp_other_mid'),
        String(s1.value('C17'))
    );
    check('E16 = 1,400千円（80万＋60万）', s1.value('E16') === 1400, String(s1.value('E16')));
    check('F16 は空欄（区分行は着工日を書かない）', s1.value('F16') === null, String(s1.value('F16')));
    check('F17 は空欄（区分行は完成予定日を書かない）', s1.value('F17') === null, String(s1.value('F17')));
    check('G16 は空欄（区分行は出来高％を書かない）', s1.value('G16') === null, String(s1.value('G16')));
    check('H16 は空欄（区分行は出来高金額を書かない）', s1.value('H16') === null, String(s1.value('H16')));

    console.log('\n【6】計（行62）＝表示値の合計');
    const sumContract = sheet.rows.reduce((s, r) => s + r.contractK, 0);
    const sumK = sheet.rows.reduce((s, r) => s + (r.scheduleK[0] ?? 0), 0);
    check('B62 = 計', s1.value('B62') === '計', String(s1.value('B62')));
    check(`E62 = ${sumContract}（契約額の合計）`, s1.value('E62') === sumContract, String(s1.value('E62')));
    check(
        `I62 = ${sheet.totals.receivedK}（既受領の合計）`,
        s1.value('I62') === sheet.totals.receivedK,
        String(s1.value('I62'))
    );
    check(
        `J62 = ${sheet.totals.unreceivedK}（未受領の合計）`,
        s1.value('J62') === sheet.totals.unreceivedK,
        String(s1.value('J62'))
    );
    check(`K62 = ${sumK}（第1列の合計）`, s1.value('K62') === sumK, String(s1.value('K62')));
    SCHEDULE_COLUMNS.forEach((col, i) => {
        check(
            `${col}62 = ${sheet.totals.scheduleK[i]}`,
            s1.value(`${col}62`) === sheet.totals.scheduleK[i],
            String(s1.value(`${col}62`))
        );
    });

    console.log('\n【7】27件で2シートになり、計は2枚目だけ');
    const many: OrderBacklogLineInput[] = Array.from({ length: 27 }, (_, i) =>
        line({
            customerName: `顧客${i + 1}`,
            projectName: `工事${i + 1}`,
            // 契約額の降順で 1..27 の符号が付くように単調減少させる
            contractAmount: 30_000_000 - i * 1_000_000,
            progressRate: 50,
            schedule: { '2026-06': 1_000_000 },
            sortOrder: i,
        })
    );
    const bigSheet = buildOrderBacklogSheet(REPORT, many);
    const bigBytes = await buildOrderBacklogWorkbook(templateBytes, bigSheet);
    const big = await readSheets(bigBytes);

    check('行が27・ページが2', bigSheet.rows.length === 27 && bigSheet.pages.length === 2, `${bigSheet.rows.length}行 / ${bigSheet.pages.length}ページ`);
    check('シートが2枚', big.names.length === 2, big.names.join(','));
    check('シート名が 受注明細書 / 受注明細書(2)', big.names[0] === '受注明細書' && big.names[1] === '受注明細書(2)', big.names.join(','));
    let bigFormulas = 0;
    for (const sh of big.sheets) bigFormulas += (sh.xml.match(/<f[\s>/]/g) ?? []).length;
    check('2シートとも数式が無い', bigFormulas === 0, `${bigFormulas}個`);
    check('1枚目 B10 = 1（符号は通し番号）', big.sheets[0].value('B10') === 1, String(big.sheets[0].value('B10')));
    check('1枚目 B60 = 26（26枠目）', big.sheets[0].value('B60') === 26, String(big.sheets[0].value('B60')));
    check('2枚目 B10 = 27（通し番号が続く）', big.sheets[1].value('B10') === 27, String(big.sheets[1].value('B10')));
    check('2枚目 B12 は空欄（27件目までしか無い）', big.sheets[1].value('B12') === null, String(big.sheets[1].value('B12')));
    check('1枚目に「計」が無い', big.sheets[0].value('B62') === null, String(big.sheets[0].value('B62')));
    check('2枚目に「計」がある', big.sheets[1].value('B62') === '計', String(big.sheets[1].value('B62')));
    check(
        `2枚目 E62 = ${bigSheet.totals.contractK}（全27件の合計）`,
        big.sheets[1].value('E62') === bigSheet.totals.contractK,
        String(big.sheets[1].value('E62'))
    );
    check('2枚目にも見出し（K9=6）がある', big.sheets[1].value('K9') === 6, String(big.sheets[1].value('K9')));
    check(
        '[Content_Types].xml に sheet2 の Override がある',
        (await big.zip.file('[Content_Types].xml')!.async('string')).includes('/xl/worksheets/sheet2.xml'),
    );

    console.log('\n【8】Excel が開ける形になっている（SheetJS で読み直して書式込みの表示を確認）');
    const wb = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
    check('SheetJS で開けてシートが1枚', wb.SheetNames.length === 1, wb.SheetNames.join(','));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const shown = (ref: string): string => String(ws[ref]?.w ?? ws[ref]?.v ?? '');
    check('K9 の表示が「6月」（書式 0"月"）', shown('K9') === '6月', shown('K9'));
    check('S9 の表示が「2月以降」（書式 0"月以降"）', shown('S9') === '2月以降', shown('S9'));
    check('G10 の表示が「50%」（書式 0%）', shown('G10') === '50%', shown('G10'));
    check('E10 の表示が「12,000」（書式 #,##0）', shown('E10') === '12,000', shown('E10'));
    check('B65 の定型文が残っている', shown('B65').startsWith('※'), shown('B65').slice(0, 12));

    console.log('');
    if (failures.length > 0) {
        console.error(`受注明細書Excel検証 NG（${failures.length}件 / OK ${ok}件）`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log(`受注明細書Excel検証 全パス（${ok} チェック）`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
/* eslint-enable no-console */
