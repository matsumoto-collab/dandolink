/**
 * 出勤簿Excelテンプレート生成スクリプト（開発時に1回だけ実行し、生成物をコミットする）
 *
 * 入力: C:\Users\yushink\Desktop\新出勤簿6月.xlsx（読み取り専用・絶対に書き換えない）
 * 出力: public/templates/attendance-monthly-template.xlsx
 *
 * 紙の出勤簿の見た目（罫線・塗り・列幅・行高・結合セル・条件付き書式・印刷設定）を
 * 1ビットも劣化させずに保つため、xlsx を ZIP として直接編集する。
 * ExcelJS 等でスタイルを往復させると劣化するので使わない。
 *
 * 実行: npx tsx scripts/build-attendance-excel-template.ts
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const SOURCE_XLSX = 'C:\\Users\\yushink\\Desktop\\新出勤簿6月.xlsx';
const OUTPUT_XLSX = path.join(process.cwd(), 'public', 'templates', 'attendance-monthly-template.xlsx');

/** 残すシート（元ブックの先頭シート「田畑」= xl/worksheets/sheet1.xml） */
const KEEP_SHEET_PATH = 'xl/worksheets/sheet1.xml';
/** テンプレ上のシート名（実行時に氏名へリネームされる） */
const TEMPLATE_SHEET_NAME = '出勤簿';

function assert(cond: unknown, message: string): asserts cond {
    if (!cond) throw new Error(`検証失敗: ${message}`);
}

/** XMLとして最低限 well-formed か（タグの対応と不正文字）をざっくり検証 */
function assertWellFormedXml(xml: string, label: string): void {
    assert(xml.startsWith('<?xml'), `${label}: XML宣言が無い`);
    // 生の & （エンティティでない）が無いこと
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

async function main(): Promise<void> {
    assert(fs.existsSync(SOURCE_XLSX), `元ファイルが見つからない: ${SOURCE_XLSX}`);
    const srcBuf = fs.readFileSync(SOURCE_XLSX);
    const zip = await JSZip.loadAsync(srcBuf);

    // ---------------------------------------------------------------- 1. 不要シートの削除
    let workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    let workbookRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    let contentTypes = await zip.file('[Content_Types].xml')!.async('string');

    // 元ブックのシート一覧（順＝workbook.xml の並び）
    const sheetEntries = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]);
    assert(sheetEntries.length > 1, 'シートが1枚しかない（元ファイルが想定と違う）');
    const firstSheetRid = /r:id="([^"]+)"/.exec(sheetEntries[0])![1];
    const firstSheetTarget = new RegExp(
        `<Relationship Id="${firstSheetRid}"[^>]*Target="([^"]+)"`
    ).exec(workbookRels)![1];
    assert(
        `xl/${firstSheetTarget}` === KEEP_SHEET_PATH,
        `先頭シートが ${KEEP_SHEET_PATH} でない: xl/${firstSheetTarget}`
    );

    // 先頭以外のシート実体・rels・Content_Types Override を削除
    const removedSheetPaths: string[] = [];
    for (const entry of sheetEntries.slice(1)) {
        const rid = /r:id="([^"]+)"/.exec(entry)![1];
        const target = new RegExp(`<Relationship Id="${rid}"[^>]*Target="([^"]+)"`).exec(workbookRels)![1];
        const sheetPath = `xl/${target}`;
        removedSheetPaths.push(sheetPath);
        zip.remove(sheetPath);
        zip.remove(sheetPath.replace(/worksheets\/(.+)$/, 'worksheets/_rels/$1.rels'));
        workbookRels = workbookRels.replace(
            new RegExp(`<Relationship Id="${rid}"[^>]*/>`),
            ''
        );
        contentTypes = contentTypes.replace(
            new RegExp(`<Override PartName="/${sheetPath}"[^>]*/>`),
            ''
        );
    }

    // 削除したシートに紐づいていたコメント・VML・印刷設定も落とす
    zip.remove('xl/comments1.xml');
    zip.remove('xl/drawings/vmlDrawing1.vml');
    contentTypes = contentTypes.replace(/<Override PartName="\/xl\/comments1\.xml"[^>]*\/>/, '');
    const keptSheetRels = await zip.file(`${KEEP_SHEET_PATH.replace('xl/worksheets/', 'xl/worksheets/_rels/')}.rels`)!.async('string');
    const keptPrinterSettings = /Target="\.\.\/printerSettings\/([^"]+)"/.exec(keptSheetRels)?.[1] ?? null;
    zip.forEach((relPath) => {
        if (relPath.startsWith('xl/printerSettings/')) {
            const base = relPath.replace('xl/printerSettings/', '');
            if (base !== keptPrinterSettings) zip.remove(relPath);
        }
    });

    // シート名を「出勤簿」に変更し、シート定義を1件だけにする
    const keptSheet = `<sheet name="${TEMPLATE_SHEET_NAME}" sheetId="1" r:id="${firstSheetRid}"/>`;
    workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${keptSheet}</sheets>`);

    // ---------------------------------------------------------------- 2. calcChain 削除
    // 実行時に全数式を値へ置き換えるため、残すと「修復しました」ダイアログの原因になる
    zip.remove('xl/calcChain.xml');
    contentTypes = contentTypes.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    workbookRels = workbookRels.replace(
        /<Relationship Id="[^"]+" Type="[^"]*\/calcChain"[^>]*\/>/,
        ''
    );

    // ---------------------------------------------------------------- 3. definedNames の整理
    // 削除したシートを参照する Print_Area を全て除去し、残すシートぶんだけ張り直す
    workbookXml = workbookXml.replace(
        /<definedNames>[\s\S]*?<\/definedNames>/,
        `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'${TEMPLATE_SHEET_NAME}'!$A$1:$M$40</definedName></definedNames>`
    );
    // 削除済みシートを選択状態にしていると開けないので activeTab を落とす
    workbookXml = workbookXml.replace(/\sactiveTab="\d+"/, '');

    // ---------------------------------------------------------------- 4. シートXMLの調整
    let sheetXml = await zip.file(KEEP_SHEET_PATH)!.async('string');
    // まとめ出力でシートを複製したときに uid が重複しないよう除去（mc:Ignorable 指定済みなので安全）
    sheetXml = sheetXml.replace(/\sxr:uid="\{[^}]*\}"/g, '');
    // J39「早残合計」→「時間外合計」（PDF側と用語を統一）。sharedStrings参照をインライン文字列に置換
    const j39Before = /<c r="J39"[^>]*>[\s\S]*?<\/c>/.exec(sheetXml);
    assert(j39Before, 'J39 セルが見つからない');
    const j39Style = /\ss="(\d+)"/.exec(j39Before![0])?.[1] ?? '';
    sheetXml = sheetXml.replace(
        j39Before![0],
        `<c r="J39"${j39Style ? ` s="${j39Style}"` : ''} t="inlineStr"><is><t>時間外合計</t></is></c>`
    );
    zip.file(KEEP_SHEET_PATH, sheetXml);

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

    // ---------------------------------------------------------------- 5. 保存
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.mkdirSync(path.dirname(OUTPUT_XLSX), { recursive: true });
    fs.writeFileSync(OUTPUT_XLSX, out);

    // ---------------------------------------------------------------- 6. 検証
    const verifyZip = await JSZip.loadAsync(fs.readFileSync(OUTPUT_XLSX));
    for (const p of removedSheetPaths) {
        assert(!verifyZip.file(p), `削除したはずのシートが残っている: ${p}`);
    }
    assert(!verifyZip.file('xl/calcChain.xml'), 'calcChain.xml が残っている');
    assert(verifyZip.file(KEEP_SHEET_PATH), 'sheet1.xml が無い');

    for (const p of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', KEEP_SHEET_PATH]) {
        assertWellFormedXml(await verifyZip.file(p)!.async('string'), p);
    }

    const finalSheetXml = await verifyZip.file(KEEP_SHEET_PATH)!.async('string');
    assert(finalSheetXml.includes('<is><t>時間外合計</t></is>'), 'J39 の「時間外合計」置換が反映されていない');
    assert(finalSheetXml.includes('<conditionalFormatting sqref="A5:C35">'), '条件付き書式が失われている');
    assert(finalSheetXml.includes('<mergeCells count="5">'), '結合セルが失われている');
    assert(finalSheetXml.includes('scale="87"'), 'pageSetup scale=87 が失われている');
    assert(finalSheetXml.includes('<dataValidation'), 'データ検証が失われている');

    const finalWorkbook = await verifyZip.file('xl/workbook.xml')!.async('string');
    assert(
        [...finalWorkbook.matchAll(/<sheet\b[^>]*\/>/g)].length === 1,
        'workbook.xml のシートが1枚になっていない'
    );

    // SheetJS でも読めること
    const wb = XLSX.read(fs.readFileSync(OUTPUT_XLSX), { type: 'buffer' });
    assert(wb.SheetNames.length === 1, `シート数が1でない: ${wb.SheetNames.join(',')}`);
    assert(wb.SheetNames[0] === TEMPLATE_SHEET_NAME, `シート名が違う: ${wb.SheetNames[0]}`);
    const ws = wb.Sheets[TEMPLATE_SHEET_NAME];
    const label = (ref: string) => (ws[ref]?.w ?? ws[ref]?.v ?? '') as string;
    assert(String(label('J39')) === '時間外合計', `J39 が「時間外合計」でない: ${label('J39')}`);
    assert(String(label('E38')).includes('出勤'), `E38 ラベルが想定外: ${label('E38')}`);
    assert(String(label('E39')).includes('欠勤'), `E39 ラベルが想定外: ${label('E39')}`);
    assert(String(label('E40')).includes('有給'), `E40 ラベルが想定外: ${label('E40')}`);
    assert(String(label('G2')).includes('氏名'), `G2 ラベルが想定外: ${label('G2')}`);

    // eslint-disable-next-line no-console
    console.log(`テンプレートを生成しました: ${OUTPUT_XLSX} (${out.length.toLocaleString()} bytes)`);
    // eslint-disable-next-line no-console
    console.log(`  シート: ${wb.SheetNames[0]} / 削除したシート: ${removedSheetPaths.length}枚`);
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
