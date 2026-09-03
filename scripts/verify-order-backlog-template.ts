/**
 * 受注明細書Excelテンプレート（public/templates/order-backlog-template.xlsx）の検証。
 *
 * scripts/build-order-backlog-excel-template.ts が作ったテンプレが
 *   - シート1枚・シート名「受注明細書」になっていること
 *   - 明細（行10〜62）と見出しの回ごとに変わるセル（F5・K9〜S9）に値も数式も残っていないこと
 *     （残ると前回の提出内容が出力に混ざる）
 *   - 様式そのもの（結合セル348個・列幅・A3横61%の印刷設定・定型文）が失われていないこと
 *   - 顧客名（元ブックの sharedStrings）を持ち込んでいないこと
 * を確かめる。元ファイルには一切アクセスしない。
 *
 * 実行: npx tsx scripts/verify-order-backlog-template.ts
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'templates', 'order-backlog-template.xlsx');
const SHEET_NAME = '受注明細書';
const SHEET_PATH = 'xl/worksheets/sheet1.xml';

const FIRST_DETAIL_ROW = 10;
const TOTAL_ROW = 62;
const HEADER_VALUE_CELLS = ['F5', 'K9', 'L9', 'M9', 'N9', 'O9', 'P9', 'Q9', 'R9', 'S9'];

/**
 * 列幅（xl 上の値。Excel の画面表示はこれから約 0.875 引いた値）。
 * 表示値では B=3.5 C=14.5 D=27.5 E=24.83 F=23.83 G〜J=18.5 K〜S=14.5。
 */
const EXPECTED_COLS: { min: number; max: number; width: string; label: string }[] = [
    { min: 2, max: 2, width: '4.375', label: 'B(3.5)' },
    { min: 3, max: 3, width: '15.375', label: 'C(14.5)' },
    { min: 4, max: 4, width: '28.375', label: 'D(27.5)' },
    { min: 5, max: 5, width: '25.75', label: 'E(24.83)' },
    { min: 6, max: 6, width: '24.75', label: 'F(23.83)' },
    { min: 7, max: 10, width: '19.375', label: 'G〜J(18.5)' },
    { min: 11, max: 19, width: '15.375', label: 'K〜S(14.5)' },
];

let ok = 0;
const failures: string[] = [];

function check(label: string, cond: unknown, detail = ''): void {
    if (cond) {
        ok += 1;
        // eslint-disable-next-line no-console
        console.log(`  OK   ${label}`);
    } else {
        failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
        // eslint-disable-next-line no-console
        console.log(`  NG   ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

/** 指定行の <row> 要素を取り出す */
function rowXml(sheetXml: string, row: number): string | null {
    const re = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
    return re.exec(sheetXml)?.[0] ?? null;
}

/** 指定セルの <c> 要素を取り出す */
function cellXml(sheetXml: string, ref: string): string | null {
    const re = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    return re.exec(sheetXml)?.[0] ?? null;
}

async function main(): Promise<void> {
    /* eslint-disable no-console */
    console.log(`受注明細書テンプレートの検証: ${TEMPLATE_PATH}`);
    if (!fs.existsSync(TEMPLATE_PATH)) {
        console.error('テンプレートがありません。先に npx tsx scripts/build-order-backlog-excel-template.ts を実行してください');
        process.exit(1);
    }
    const bytes = fs.readFileSync(TEMPLATE_PATH);
    const zip = await JSZip.loadAsync(bytes);

    console.log('\n【1】ブックの構成');
    const sheetFile = zip.file(SHEET_PATH);
    check(`${SHEET_PATH} がある`, !!sheetFile);
    if (!sheetFile) {
        console.error('シートが無いので以降の検証はできません');
        process.exit(1);
    }
    const worksheetPaths: string[] = [];
    zip.forEach((filePath, file) => {
        if (!file.dir && /^xl\/worksheets\/sheet\d+\.xml$/.test(filePath)) worksheetPaths.push(filePath);
    });
    check('シート実体が1枚だけ', worksheetPaths.length === 1, worksheetPaths.join(', '));
    check('calcChain.xml が無い', !zip.file('xl/calcChain.xml'));
    check('コメント・図形が無い', !zip.file('xl/comments1.xml') && !zip.file('xl/drawings/drawing1.xml'));

    const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)];
    check('workbook.xml のシート定義が1件', sheetTags.length === 1, `${sheetTags.length}件`);
    check(
        `シート名が「${SHEET_NAME}」`,
        sheetTags.length === 1 && /name="([^"]*)"/.exec(sheetTags[0][0])?.[1] === SHEET_NAME,
        sheetTags[0] ? /name="([^"]*)"/.exec(sheetTags[0][0])?.[1] : ''
    );
    check('消したシートを参照する定義名(definedNames)が残っていない', !/<definedNames>/.test(workbookXml));
    check('activeTab / firstSheet が残っていない', !/\sactiveTab="/.test(workbookXml) && !/\sfirstSheet="/.test(workbookXml));

    const wb = XLSX.read(bytes, { type: 'buffer' });
    check('SheetJS で開けてシートが1枚', wb.SheetNames.length === 1, wb.SheetNames.join(','));
    check(`SheetJS 上のシート名が「${SHEET_NAME}」`, wb.SheetNames[0] === SHEET_NAME, wb.SheetNames[0]);

    const sheetXml = await sheetFile.async('string');

    console.log('\n【2】明細（行10〜62）と見出しの値が消えている');
    let rowsWithValue = 0;
    let rowsMissing = 0;
    for (let row = FIRST_DETAIL_ROW; row <= TOTAL_ROW; row++) {
        const xml = rowXml(sheetXml, row);
        if (!xml) {
            rowsMissing += 1;
            continue;
        }
        if (/<v>|<f[\s>/]/.test(xml)) rowsWithValue += 1;
    }
    check(`行${FIRST_DETAIL_ROW}〜${TOTAL_ROW} が全て存在する`, rowsMissing === 0, `欠けている行 ${rowsMissing}`);
    check(`行${FIRST_DETAIL_ROW}〜${TOTAL_ROW} に値(<v>)も数式(<f>)も無い`, rowsWithValue === 0, `残っている行 ${rowsWithValue}`);

    for (const ref of HEADER_VALUE_CELLS) {
        const xml = cellXml(sheetXml, ref);
        check(`${ref} が空セル`, !!xml && !/<v>|<f[\s>/]/.test(xml), xml ?? '(セルが無い)');
    }

    console.log('\n【3】様式（結合・列幅・印刷設定）が残っている');
    const mergeCount = /<mergeCells count="(\d+)">/.exec(sheetXml)?.[1];
    check('結合セルが348個', mergeCount === '348', `count=${mergeCount}`);

    for (const col of EXPECTED_COLS) {
        const re = new RegExp(`<col min="${col.min}" max="${col.max}" width="([^"]+)"`);
        const width = re.exec(sheetXml)?.[1];
        check(`列幅 ${col.label}`, width === col.width, `width=${width}`);
    }

    check(
        'pageSetup paperSize="8" scale="61" orientation="landscape"',
        /<pageSetup paperSize="8" scale="61" orientation="landscape"/.test(sheetXml)
    );
    check('余白（左右0・上0.3937in・下0.3149in）', /<pageMargins left="0" right="0" top="0\.39/.test(sheetXml));
    check('枠線非表示（showGridLines="0"）', /showGridLines="0"/.test(sheetXml));
    check('印刷設定パーツ(printerSettings1.bin)がある', !!zip.file('xl/printerSettings/printerSettings1.bin'));

    console.log('\n【4】固定の見出し・定型文が残っている');
    const ws = wb.Sheets[SHEET_NAME];
    const label = (ref: string): string => String(ws[ref]?.w ?? ws[ref]?.v ?? '');
    check('B1 表題', label('B1').includes('受') && label('B1').includes('細'), label('B1'));
    check('B6 申込人', label('B6').startsWith('申込人'), label('B6'));
    check('O7 （単位　千円）', label('O7').includes('千円'), label('O7'));
    check('C8 契約先 / C9 工事名', label('C8') === '契約先' && label('C9') === '工事名', `${label('C8')} / ${label('C9')}`);
    check('E8 契約額', label('E8') === '契約額', label('E8'));
    check('F8 工事着工日 / F9 完成予定日', label('F8') === '工事着工日' && label('F9') === '完成予定日');
    check('G9 ％ / H9 金額', label('G9') === '％' && label('H9') === '金額');
    check('I8 既受領金額 / J8 未受領金額', label('I8') === '既受領金額' && label('J8').includes('未受領金額'));
    check('K8 入金予定', label('K8') === '入金予定', label('K8'));
    check('65行目の定型文', label('B65').startsWith('※') && label('B65').includes('入金予定'), label('B65').slice(0, 20));
    check('68行目の定型文', label('B68').includes('金融機関名'), label('B68').slice(0, 20));
    check('70行目の定型文', label('B70').startsWith('※') && label('B70').includes('返済財源'), label('B70').slice(0, 20));

    console.log('\n【5】元ブックの顧客名を持ち込んでいない');
    const sharedStrings = await zip.file('xl/sharedStrings.xml')!.async('string');
    const items = [...sharedStrings.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, '')
    );
    const referenced = new Set(
        [...sheetXml.matchAll(/<c\b[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>/g)].map((m) => Number(m[1]))
    );
    const leaked = items
        .map((t, i) => ({ i, t }))
        .filter((x) => x.t.trim() !== '' && !referenced.has(x.i));
    check('参照されていない共有文字列が全て空', leaked.length === 0, leaked.slice(0, 5).map((x) => `${x.i}:${x.t}`).join(' / '));
    check('残っている共有文字列は見出しと定型文だけ', referenced.size <= 20, `${referenced.size}件`);

    console.log('');
    if (failures.length > 0) {
        console.error(`受注明細書テンプレート検証 NG（${failures.length}件 / OK ${ok}件）`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log(`受注明細書テンプレート検証 全パス（${ok} チェック）`);
    /* eslint-enable no-console */
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
