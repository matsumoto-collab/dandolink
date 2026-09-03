/**
 * 受注明細書（信用保証協会様式）Excelテンプレート生成スクリプト
 * （開発時に1回だけ実行し、生成物をコミットする）
 *
 * 入力: C:\Users\yushink\Desktop\受注明細書.xlsx（第1引数で上書き可）
 *       **読み取り専用。絶対に書き換えない・リポジトリにコピーしない**（顧客名が入っているため）
 * 出力: public/templates/order-backlog-template.xlsx
 *
 * 提出済みシート「受注工事明細20260601」の見た目（罫線・塗り・列幅・行高・結合セル・印刷設定）を
 * 1ビットも劣化させずに保つため、xlsx を ZIP として直接編集する。
 * ExcelJS 等でスタイルを往復させると劣化するので使わない。
 *
 * やること:
 *   1. 対象シート1枚だけを残し、他シート・その付随パーツ・calcChain を削除
 *   2. 残したシートを sheet1.xml へ正規化（出勤簿テンプレと同じ位置＝utils/xlsxTemplate.ts が前提にしている）
 *   3. 明細（行10〜62）と F5・K9〜S9 の値と数式を消す（<c> と s属性・結合・列幅・印刷設定は残す）
 *   4. sharedStrings のうち参照されなくなった文字列を空にする（顧客名をリポジトリに持ち込まないため）
 *
 * 実行: npx tsx scripts/build-order-backlog-excel-template.ts [元ファイルのパス]
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const DEFAULT_SOURCE_XLSX = 'C:\\Users\\yushink\\Desktop\\受注明細書.xlsx';
const SOURCE_XLSX = process.argv[2] || DEFAULT_SOURCE_XLSX;
const OUTPUT_XLSX = path.join(process.cwd(), 'public', 'templates', 'order-backlog-template.xlsx');

/** 元ブックで残すシート名（提出済みの最新回） */
const KEEP_SHEET_NAME = '受注工事明細20260601';
/** テンプレ上のシート名（2ページ目以降は実行時に「受注明細書(2)」等へリネームされる） */
const TEMPLATE_SHEET_NAME = '受注明細書';

/**
 * 明細の先頭行と「計」の行（この範囲の値・数式を全て消す）。
 * 62行目は B62 の「計」というラベルごと消える＝出力側（orderBacklogExcelBuilder）が
 * B62 に '計' を書くこと。テンプレに値を残すと「行10〜62に値が無い」検証が濁るのでこうしている。
 */
const FIRST_DETAIL_ROW = 10;
const TOTAL_ROW = 62;
/** 見出しのうち回ごとに変わるセル: F5=基準日ラベル、K9〜S9=入金予定の月 */
const HEADER_VALUE_CELLS = ['F5', 'K9', 'L9', 'M9', 'N9', 'O9', 'P9', 'Q9', 'R9', 'S9'];

function assert(cond: unknown, message: string): asserts cond {
    if (!cond) throw new Error(`検証失敗: ${message}`);
}

/** XMLとして最低限 well-formed か（タグの対応と不正文字）をざっくり検証 */
function assertWellFormedXml(xml: string, label: string): void {
    assert(xml.startsWith('<?xml'), `${label}: XML宣言が無い`);
    const badAmp = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(xml);
    assert(!badAmp, `${label}: 未エスケープの & がある (pos ${badAmp?.index})`);

    const stack: string[] = [];
    const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(xml)) !== null) {
        const [, closing, name, attrs, selfClose] = m;
        if (closing) {
            const top = stack.pop();
            assert(top === name, `${label}: タグ不整合 </${name}> (期待 </${top}>)`);
        } else if (!selfClose && !attrs.endsWith('/') && !name.startsWith('?')) {
            stack.push(name);
        }
    }
    assert(stack.length === 0, `${label}: 閉じられていないタグ ${stack.join(',')}`);
}

/** <c> から値（<v>）・数式（<f>）・型（t属性）を落とし、参照とスタイルだけ残す */
function clearCell(cellXml: string): string {
    const ref = /\br="([A-Z]+\d+)"/.exec(cellXml)?.[1];
    if (!ref) return cellXml;
    const style = /\ss="(\d+)"/.exec(cellXml)?.[1];
    return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
}

/** 指定した行範囲のセルを全て空にする（行の属性＝行高などはそのまま） */
function clearRowRange(xml: string, firstRow: number, lastRow: number): { xml: string; cleared: number } {
    let cleared = 0;
    const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
    const out = xml.replace(rowRe, (rowXml, rowNumber: string) => {
        const row = Number(rowNumber);
        if (row < firstRow || row > lastRow) return rowXml;
        return rowXml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cellXml) => {
            const next = clearCell(cellXml);
            if (next !== cellXml) cleared += 1;
            return next;
        });
    });
    return { xml: out, cleared };
}

/** 単独セルを空にする */
function clearCellRef(xml: string, ref: string): string {
    const re = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    return xml.replace(re, (cellXml) => clearCell(cellXml));
}

/**
 * シートから参照されなくなった sharedStrings を空文字にする。
 * 元ブックには全シートぶんの顧客名が入っており、テンプレはリポジトリにコミットするので落とす。
 * 添字は詰めない（残った見出し・定型文の <v> が指す番号を変えないため）。
 */
function stripUnusedSharedStrings(sharedStringsXml: string, sheetXml: string): { xml: string; kept: number; blanked: number } {
    const used = new Set<number>();
    const cellRe = /<c\b[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>/g;
    let m: RegExpExecArray | null;
    let refCount = 0;
    while ((m = cellRe.exec(sheetXml)) !== null) {
        used.add(Number(m[1]));
        refCount += 1;
    }

    let index = 0;
    let blanked = 0;
    let total = 0;
    const xml = sharedStringsXml.replace(/<si>[\s\S]*?<\/si>/g, (si) => {
        const i = index;
        index += 1;
        total += 1;
        if (used.has(i)) return si;
        blanked += 1;
        return '<si><t/></si>';
    });

    return {
        xml: xml.replace(
            /<sst\b[^>]*?>/,
            (sst) =>
                sst
                    .replace(/\scount="\d+"/, ` count="${refCount}"`)
                    .replace(/\suniqueCount="\d+"/, ` uniqueCount="${total}"`)
        ),
        kept: used.size,
        blanked,
    };
}

async function main(): Promise<void> {
    assert(fs.existsSync(SOURCE_XLSX), `元ファイルが見つからない: ${SOURCE_XLSX}`);
    const zip = await JSZip.loadAsync(fs.readFileSync(SOURCE_XLSX));

    let workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    let workbookRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    let contentTypes = await zip.file('[Content_Types].xml')!.async('string');

    // ---------------------------------------------------------------- 1. 残すシートの特定
    // sheetN.xml の N は決め打ちしない（workbook.xml の r:id → rels の Target で引く）
    const sheetEntries = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map((tag) => {
        const name = /name="([^"]*)"/.exec(tag[0])![1];
        const rid = /r:id="([^"]+)"/.exec(tag[0])![1];
        const target = new RegExp(`<Relationship Id="${rid}"[^>]*Target="([^"]+)"`).exec(workbookRels)![1];
        return { tag: tag[0], name, rid, path: `xl/${target}` };
    });
    const keep = sheetEntries.find((s) => s.name === KEEP_SHEET_NAME);
    assert(keep, `シート「${KEEP_SHEET_NAME}」が見つからない（あるのは ${sheetEntries.map((s) => s.name).join(' / ')}）`);

    const removedEntries: string[] = [];
    const removeFile = (filePath: string): void => {
        if (zip.file(filePath)) {
            zip.remove(filePath);
            removedEntries.push(filePath);
        }
    };

    // ---------------------------------------------------------------- 2. 他シートと付随パーツの削除
    for (const sheet of sheetEntries) {
        if (sheet === keep) continue;
        removeFile(sheet.path);
        removeFile(sheet.path.replace(/worksheets\/(.+)$/, 'worksheets/_rels/$1.rels'));
        workbookRels = workbookRels.replace(new RegExp(`<Relationship Id="${sheet.rid}"[^>]*/>`), '');
        contentTypes = contentTypes.replace(new RegExp(`<Override PartName="/${sheet.path}"[^>]*/>`), '');
    }

    // コメント・図形は消したシート（記入例）に付いていたもの
    for (const part of ['xl/comments1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/vmlDrawing1.vml']) {
        removeFile(part);
        contentTypes = contentTypes.replace(
            new RegExp(`<Override PartName="/${part.replace(/\./g, '\\.')}"[^>]*/>`),
            ''
        );
    }

    // 実行時に全数式を値へ置き換えるため、calcChain を残すと「修復しました」ダイアログの原因になる
    removeFile('xl/calcChain.xml');
    contentTypes = contentTypes.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    workbookRels = workbookRels.replace(/<Relationship Id="[^"]+" Type="[^"]*\/calcChain"[^>]*\/>/, '');

    // ---------------------------------------------------------------- 3. 残したシートを sheet1 へ正規化
    // utils/xlsxTemplate.ts は「テンプレの唯一のシート = sheet1.xml」を前提にしている
    const keptRelsPath = keep.path.replace(/worksheets\/(.+)$/, 'worksheets/_rels/$1.rels');
    let keptSheetRels = await zip.file(keptRelsPath)!.async('string');
    const printerSettingsName = /Target="\.\.\/printerSettings\/([^"]+)"/.exec(keptSheetRels)?.[1] ?? null;
    assert(printerSettingsName, '残すシートの印刷設定（printerSettings）が見つからない');

    const printerSettings = await zip.file(`xl/printerSettings/${printerSettingsName}`)!.async('uint8array');
    // 消したシートぶんの印刷設定を落とし、残すシートのものを printerSettings1.bin として置き直す
    const printerSettingsPaths: string[] = [];
    zip.forEach((filePath, file) => {
        if (!file.dir && filePath.startsWith('xl/printerSettings/')) printerSettingsPaths.push(filePath);
    });
    for (const filePath of printerSettingsPaths) removeFile(filePath);
    zip.file('xl/printerSettings/printerSettings1.bin', printerSettings);
    keptSheetRels = keptSheetRels.replace(/printerSettings\d+\.bin/, 'printerSettings1.bin');

    let sheetXml = await zip.file(keep.path)!.async('string');
    removeFile(keep.path);
    removeFile(keptRelsPath);
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', keptSheetRels);
    contentTypes = contentTypes.replace(
        new RegExp(`<Override PartName="/${keep.path}"[^>]*/>`),
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    );

    // ---------------------------------------------------------------- 4. シートXMLの掃除
    // まとめ出力でシートを複製したときに uid が重複しないよう除去（mc:Ignorable 指定済みなので安全）
    sheetXml = sheetXml.replace(/\sxr:uid="\{[^}]*\}"/g, '');
    // 開いたときに先頭が見えるようにする（提出時の表示位置＝行39あたりが保存されている）
    sheetXml = sheetXml.replace(/\stopLeftCell="[A-Z]+\d+"/, '');
    sheetXml = sheetXml.replace(/<selection[^>]*\/>/, '<selection activeCell="B1" sqref="B1"/>');

    const detail = clearRowRange(sheetXml, FIRST_DETAIL_ROW, TOTAL_ROW);
    sheetXml = detail.xml;
    for (const ref of HEADER_VALUE_CELLS) sheetXml = clearCellRef(sheetXml, ref);
    zip.file('xl/worksheets/sheet1.xml', sheetXml);

    // ---------------------------------------------------------------- 5. sharedStrings から顧客名を落とす
    const sharedStringsXml = await zip.file('xl/sharedStrings.xml')!.async('string');
    const stripped = stripUnusedSharedStrings(sharedStringsXml, sheetXml);
    zip.file('xl/sharedStrings.xml', stripped.xml);

    // ---------------------------------------------------------------- 6. workbook の整合
    workbookXml = workbookXml.replace(
        /<sheets>[\s\S]*?<\/sheets>/,
        `<sheets><sheet name="${TEMPLATE_SHEET_NAME}" sheetId="1" r:id="${keep.rid}"/></sheets>`
    );
    workbookRels = workbookRels.replace(
        new RegExp(`(<Relationship Id="${keep.rid}"[^>]*Target=")[^"]+(")`),
        '$1worksheets/sheet1.xml$2'
    );
    // 消したシートを参照する定義名（Print_Area・_FilterDatabase）は残せない
    workbookXml = workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
    // 消したシートを選択・先頭表示にしていると開けないので落とす
    workbookXml = workbookXml.replace(/\sactiveTab="\d+"/, '').replace(/\sfirstSheet="\d+"/, '');

    // docProps/app.xml は削除済みシート名の一覧を持っているので最小構成に差し替える
    zip.file(
        'docProps/app.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
            'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
            '<Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
            '<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>' +
            '<AppVersion>16.0300</AppVersion></Properties>'
    );

    zip.file('xl/workbook.xml', workbookXml);
    zip.file('xl/_rels/workbook.xml.rels', workbookRels);
    zip.file('[Content_Types].xml', contentTypes);

    // ---------------------------------------------------------------- 7. 保存
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.mkdirSync(path.dirname(OUTPUT_XLSX), { recursive: true });
    fs.writeFileSync(OUTPUT_XLSX, out);

    // ---------------------------------------------------------------- 8. 生成物の検証
    const verifyZip = await JSZip.loadAsync(fs.readFileSync(OUTPUT_XLSX));
    const keptPaths: string[] = [];
    verifyZip.forEach((filePath, file) => {
        if (!file.dir) keptPaths.push(filePath);
    });
    keptPaths.sort();

    // 残したシートを sheet1.xml へ置き直しているので、シート実体は1つだけになる
    const worksheetPaths = keptPaths.filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
    assert(
        worksheetPaths.length === 1 && worksheetPaths[0] === 'xl/worksheets/sheet1.xml',
        `シート実体が1枚になっていない: ${worksheetPaths.join(', ')}`
    );
    assert(!verifyZip.file('xl/calcChain.xml'), 'calcChain.xml が残っている');
    assert(verifyZip.file('xl/worksheets/sheet1.xml'), 'sheet1.xml が無い');

    for (const filePath of [
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/_rels/sheet1.xml.rels',
        'xl/sharedStrings.xml',
    ]) {
        assertWellFormedXml(await verifyZip.file(filePath)!.async('string'), filePath);
    }

    const finalSheetXml = await verifyZip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert(finalSheetXml.includes('<mergeCells count="348">'), '結合セルが失われている');
    assert(
        finalSheetXml.includes('<pageSetup paperSize="8" scale="61" orientation="landscape"'),
        '印刷設定（A3横・61%）が失われている'
    );

    // SheetJS でも読めること（＝Excel が開ける形になっていること）
    const wb = XLSX.read(fs.readFileSync(OUTPUT_XLSX), { type: 'buffer' });
    assert(wb.SheetNames.length === 1, `シート数が1でない: ${wb.SheetNames.join(',')}`);
    assert(wb.SheetNames[0] === TEMPLATE_SHEET_NAME, `シート名が違う: ${wb.SheetNames[0]}`);
    const ws = wb.Sheets[TEMPLATE_SHEET_NAME];
    const label = (ref: string): string => String(ws[ref]?.w ?? ws[ref]?.v ?? '');
    assert(label('B1').includes('受'), `B1 の表題が失われている: ${label('B1')}`);
    assert(label('C8') === '契約先', `C8 の見出しが違う: ${label('C8')}`);
    assert(label('B62') === '', `B62（計）は出力側が書くので空でなければならない: ${label('B62')}`);
    assert(label('B65').startsWith('※'), `65行目の定型文が失われている: ${label('B65')}`);
    assert(label('B68').includes('金融機関名'), `68行目の定型文が失われている: ${label('B68')}`);
    assert(label('B70').startsWith('※'), `70行目の定型文が失われている: ${label('B70')}`);
    assert(label('E10') === '', `E10 に値が残っている: ${label('E10')}`);
    assert(label('F5') === '', `F5 に値が残っている: ${label('F5')}`);
    assert(label('K9') === '', `K9 に値が残っている: ${label('K9')}`);

    /* eslint-disable no-console */
    console.log(`テンプレートを生成しました: ${OUTPUT_XLSX} (${out.length.toLocaleString()} bytes)`);
    console.log(`  元シート: ${keep.name} (${keep.path}) → xl/worksheets/sheet1.xml / シート名「${TEMPLATE_SHEET_NAME}」`);
    console.log(`  削除したZIPエントリ(${removedEntries.length}): ${removedEntries.sort().join(', ')}`);
    console.log(`  置き直したZIPエントリ: xl/printerSettings/${printerSettingsName} → xl/printerSettings/printerSettings1.bin`);
    console.log(`  残したZIPエントリ(${keptPaths.length}): ${keptPaths.join(', ')}`);
    console.log(`  値・数式を消したセル: 行${FIRST_DETAIL_ROW}〜${TOTAL_ROW} で ${detail.cleared}個 ＋ 見出し ${HEADER_VALUE_CELLS.join(',')}`);
    console.log(`  sharedStrings: 参照あり ${stripped.kept}件を残し、${stripped.blanked}件を空にした（顧客名を持ち込まないため）`);
    /* eslint-enable no-console */
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
