/**
 * xlsx テンプレート（ZIP直編集方式）の共通部品。
 *
 * 出勤簿・受注明細書は「元の Excel から作った1シートのテンプレを ZIP のまま開き、
 * シートXMLのセルの中身だけを差し替える」方式で出力している。
 * s属性（スタイル）・結合セル・条件付き書式・列幅・行高・印刷設定を一切触らないので
 * 見た目が元ファイルと完全に一致する。ExcelJS 等でスタイルを往復させると劣化するので使わない。
 *
 * ブラウザ・Node の双方から使えるよう、DOM API と react-pdf に依存しない。
 * （テンプレのバイト列は呼び出し側が用意する）
 */
import JSZip from 'jszip';

/** テンプレの唯一のシート（どのテンプレも sheet1 に正規化してある） */
export const BASE_SHEET_PATH = 'xl/worksheets/sheet1.xml';
export const BASE_SHEET_RELS_PATH = 'xl/worksheets/_rels/sheet1.xml.rels';

// ---------------------------------------------------------------- XML の小物

export function escapeXml(value: string): string {
    return value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** definedNames などでシート名を参照するときの引用（' は '' にエスケープ） */
export function quoteSheetName(name: string): string {
    return `'${escapeXml(name.replace(/'/g, "''"))}'`;
}

/** シート名に使えない文字を除去し、31文字以内に収める */
export function sanitizeSheetName(name: string, fallback: string): string {
    const cleaned = name.replace(/[\\/?*[\]:]/g, '').trim();
    const truncated = cleaned.slice(0, 31).trim();
    return truncated || fallback;
}

/** 同名シートが既にある場合に " (2)" 等を付けて一意化（31文字以内を維持） */
export function uniqueSheetName(base: string, used: Set<string>): string {
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    for (let i = 2; ; i++) {
        const suffix = ` (${i})`;
        const name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
        if (!used.has(name)) {
            used.add(name);
            return name;
        }
    }
}

// ---------------------------------------------------------------- セル書き換え

export type CellValue =
    /** 数値（日付・時刻シリアルを含む） */
    | { kind: 'number'; value: number }
    /** インライン文字列（sharedStrings を汚さない） */
    | { kind: 'text'; value: string }
    /** 空セル（スタイルだけ残す） */
    | { kind: 'empty' };

export const EMPTY: CellValue = { kind: 'empty' };
export const num = (value: number): CellValue => ({ kind: 'number', value });
export const text = (value: string): CellValue => ({ kind: 'text', value });
/** 空文字なら空セル、それ以外は文字列セル */
export const textOrEmpty = (value: string): CellValue => (value ? text(value) : EMPTY);

/** "AB12" → { col: 'AB', colIndex: 28, row: 12 }。不正な参照は null */
function parseRef(ref: string): { col: string; colIndex: number; row: number } | null {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return null;
    let colIndex = 0;
    for (const ch of m[1]) colIndex = colIndex * 26 + (ch.charCodeAt(0) - 64);
    return { col: m[1], colIndex, row: Number(m[2]) };
}

/** セル1個ぶんの XML を組み立てる（s属性は呼び出し側が渡した文字列をそのまま使う） */
function renderCell(ref: string, style: string, value: CellValue): string {
    if (value.kind === 'empty') return `<c r="${ref}"${style}/>`;
    if (value.kind === 'number') return `<c r="${ref}"${style}><v>${value.value}</v></c>`;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
        value.value
    )}</t></is></c>`;
}

/**
 * セル1個を差し替える。s属性（スタイル）は必ず保持し、数式（<f>）は落とす。
 *
 * テンプレに <c> が無い参照は、その行の**列順を保った位置に挿入**する（行ごと無ければ行も作る）。
 * 受注明細書のテンプレのように空セルが省略されている様式でも書けるようにするため。
 * ただし空セルの書き込みだけは挿入しない＝書くものが無く、スタイル無しのセルが増えるだけなので。
 */
export function setCell(xml: string, ref: string, value: CellValue): string {
    const re = new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
    const m = re.exec(xml);
    if (m) {
        const styleMatch = /\ss="(\d+)"/.exec(m[1]);
        const style = styleMatch ? ` s="${styleMatch[1]}"` : '';
        return xml.slice(0, m.index) + renderCell(ref, style, value) + xml.slice(m.index + m[0].length);
    }
    if (value.kind === 'empty') return xml;

    const parsed = parseRef(ref);
    if (!parsed) return xml;
    const cell = renderCell(ref, '', value);

    // --- 行があれば、その中の列順を保つ位置へ差し込む
    const rowRe = new RegExp(`<row[^>]*\\br="${parsed.row}"[^>]*?(/>|>[\\s\\S]*?</row>)`);
    const rowMatch = rowRe.exec(xml);
    if (rowMatch) {
        const rowXml = rowMatch[0];
        if (rowXml.endsWith('/>')) {
            // 空行（<row .../>）は開閉タグに開いてから入れる
            const opened = `${rowXml.slice(0, -2)}>${cell}</row>`;
            return xml.slice(0, rowMatch.index) + opened + xml.slice(rowMatch.index + rowXml.length);
        }
        let insertAt = rowXml.lastIndexOf('</row>');
        const cellRe = /<c r="([A-Z]+)\d+"/g;
        let cm: RegExpExecArray | null;
        while ((cm = cellRe.exec(rowXml)) !== null) {
            const other = parseRef(`${cm[1]}1`);
            if (other && other.colIndex > parsed.colIndex) {
                insertAt = cm.index;
                break;
            }
        }
        const newRowXml = rowXml.slice(0, insertAt) + cell + rowXml.slice(insertAt);
        return xml.slice(0, rowMatch.index) + newRowXml + xml.slice(rowMatch.index + rowXml.length);
    }

    // --- 行ごと無ければ、行番号順を保つ位置へ新しい <row> を差し込む
    const sheetDataEnd = xml.indexOf('</sheetData>');
    if (sheetDataEnd < 0) return xml;
    let insertAt = sheetDataEnd;
    const rowTagRe = /<row[^>]*\br="(\d+)"/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowTagRe.exec(xml)) !== null) {
        if (rm.index >= sheetDataEnd) break;
        if (Number(rm[1]) > parsed.row) {
            insertAt = rm.index;
            break;
        }
    }
    const newRow = `<row r="${parsed.row}">${cell}</row>`;
    return xml.slice(0, insertAt) + newRow + xml.slice(insertAt);
}

export function setCells(xml: string, cells: Record<string, CellValue>): string {
    let out = xml;
    for (const [ref, value] of Object.entries(cells)) {
        out = setCell(out, ref, value);
    }
    return out;
}

// ---------------------------------------------------------------- ブック組み立て

export interface XlsxTemplate {
    zip: JSZip;
    /** テンプレの唯一のシートXML（これに値を書き込んでから buildWorkbookFromTemplate へ渡す） */
    baseSheetXml: string;
    baseSheetRels: string | null;
    basePrinterSettings: Uint8Array | null;
    /** シートrelsが指している印刷設定のファイル名（例 printerSettings1.bin） */
    basePrinterSettingsName: string | null;
}

/** テンプレ xlsx を開き、シート複製に必要なパーツを取り出す */
export async function openXlsxTemplate(templateBytes: ArrayBuffer | Uint8Array): Promise<XlsxTemplate> {
    const zip = await JSZip.loadAsync(templateBytes);
    const sheetFile = zip.file(BASE_SHEET_PATH);
    if (!sheetFile) throw new Error(`テンプレートに ${BASE_SHEET_PATH} がありません`);
    const baseSheetXml = await sheetFile.async('string');
    const baseSheetRels = (await zip.file(BASE_SHEET_RELS_PATH)?.async('string')) ?? null;
    const basePrinterSettingsName = baseSheetRels
        ? /Target="\.\.\/printerSettings\/([^"]+)"/.exec(baseSheetRels)?.[1] ?? null
        : null;
    const basePrinterSettings = basePrinterSettingsName
        ? (await zip.file(`xl/printerSettings/${basePrinterSettingsName}`)?.async('uint8array')) ?? null
        : null;
    return { zip, baseSheetXml, baseSheetRels, basePrinterSettings, basePrinterSettingsName };
}

export interface WorkbookSheet {
    /** シート名（サニタイズ・一意化は呼び出し側で済ませておく） */
    name: string;
    /** 値を書き込み済みのシートXML */
    xml: string;
}

export interface BuildWorkbookOptions {
    /**
     * 各シートに張り直す印刷範囲（例 '$A$1:$M$40'）。
     * null / 未指定なら definedNames には触らない（テンプレのまま）
     */
    printAreaRef?: string | null;
}

/**
 * テンプレのシートを人数（ページ数）ぶん複製し、xlsx のバイト列を組み立てる。
 * sheets の配列順どおりにシートを並べる。
 */
export async function buildWorkbookFromTemplate(
    template: XlsxTemplate,
    sheets: WorkbookSheet[],
    { printAreaRef = null }: BuildWorkbookOptions = {}
): Promise<ArrayBuffer> {
    if (sheets.length === 0) throw new Error('出力するシートがありません');
    const { zip, baseSheetRels, basePrinterSettings, basePrinterSettingsName } = template;

    sheets.forEach((sheet, index) => {
        const n = index + 1;
        zip.file(`xl/worksheets/sheet${n}.xml`, sheet.xml);

        if (n > 1) {
            // 2枚目以降はシート付随パーツ（印刷設定）も複製する
            if (basePrinterSettings && basePrinterSettingsName && baseSheetRels) {
                const printerName = basePrinterSettingsName.replace(/\d+(?=\.bin$)/, String(n));
                zip.file(`xl/printerSettings/${printerName}`, basePrinterSettings);
                zip.file(
                    `xl/worksheets/_rels/sheet${n}.xml.rels`,
                    baseSheetRels.replace(/printerSettings\d+\.bin/, printerName)
                );
            } else if (baseSheetRels) {
                zip.file(`xl/worksheets/_rels/sheet${n}.xml.rels`, baseSheetRels);
            }
        }
    });

    // --- workbook.xml（シート一覧・印刷範囲）
    let workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    const sheetTags = sheets
        .map(
            (sheet, i) =>
                `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rIdSheet${i + 1}"/>`
        )
        .join('');
    workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetTags}</sheets>`);

    if (printAreaRef) {
        const definedNames = sheets
            .map(
                (sheet, i) =>
                    `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${quoteSheetName(
                        sheet.name
                    )}!${printAreaRef}</definedName>`
            )
            .join('');
        if (/<definedNames>[\s\S]*?<\/definedNames>/.test(workbookXml)) {
            workbookXml = workbookXml.replace(
                /<definedNames>[\s\S]*?<\/definedNames>/,
                `<definedNames>${definedNames}</definedNames>`
            );
        } else {
            workbookXml = workbookXml.replace('<calcPr', `<definedNames>${definedNames}</definedNames><calcPr`);
        }
    }
    zip.file('xl/workbook.xml', workbookXml);

    // --- workbook.xml.rels（シートのリレーション）
    let workbookRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    workbookRels = workbookRels.replace(/<Relationship\b[^>]*Type="[^"]*\/worksheet"[^>]*\/>/g, '');
    const relTags = sheets
        .map(
            (_sheet, i) =>
                `<Relationship Id="rIdSheet${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
                    i + 1
                }.xml"/>`
        )
        .join('');
    workbookRels = workbookRels.replace('</Relationships>', `${relTags}</Relationships>`);
    zip.file('xl/_rels/workbook.xml.rels', workbookRels);

    // --- [Content_Types].xml（2枚目以降の Override を追加）
    let contentTypes = await zip.file('[Content_Types].xml')!.async('string');
    const overrides = sheets
        .slice(1)
        .map(
            (_sheet, i) =>
                `<Override PartName="/xl/worksheets/sheet${
                    i + 2
                }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('');
    if (overrides) {
        contentTypes = contentTypes.replace('</Types>', `${overrides}</Types>`);
        zip.file('[Content_Types].xml', contentTypes);
    }

    return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
