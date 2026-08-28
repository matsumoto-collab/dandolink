/**
 * 出勤簿Excel（紙の出勤簿と同じ見た目）のブック組み立て。
 *
 * 方式: public/templates/attendance-monthly-template.xlsx（元の紙の出勤簿から作った1シートのテンプレ）を
 * ZIP のまま開き、シートXMLの**セルの中身だけ**を差し替える。
 * s属性（スタイル）・結合セル・条件付き書式・データ検証・列幅・行高・印刷設定は一切触らないので、
 * 見た目は元ファイルと完全に一致する。数式は全て除去し、計算済みの値を書き込む。
 *
 * ブラウザ・Node の双方から使えるよう、このモジュールは DOM API と react-pdf に依存しない。
 * （テンプレのバイト列は呼び出し側が用意する）
 */
import JSZip from 'jszip';
// 集計の型は react-pdf 非依存のモジュールから取る（サーバーからも使うため）
import type { AttendanceMonthlyPdfData } from '@/utils/attendanceMonthlyData';

/** テンプレのシート（元ブックの先頭シート）のパス */
const BASE_SHEET_PATH = 'xl/worksheets/sheet1.xml';
const BASE_SHEET_RELS_PATH = 'xl/worksheets/_rels/sheet1.xml.rels';
const BASE_PRINTER_SETTINGS_PATH = 'xl/printerSettings/printerSettings1.bin';

/** 日別行は 5〜35 行目（1行目=day1）。31日ぶん確保されている */
const FIRST_DAY_ROW = 5;
const LAST_DAY_ROW = 35;
/** 13列（A=日付 … M=備考） */
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'] as const;

/** Excelのシリアル値の起点（1899-12-30） */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MINUTES_PER_DAY = 1440;

export interface AttendanceExcelSheetInput {
    /** シート名の元になる氏名（H2 にも入る） */
    userName: string;
    /** buildAttendanceMonthlyPdfData の戻り値（PDFと同じ集計） */
    data: AttendanceMonthlyPdfData;
}

// ---------------------------------------------------------------- 小物

function escapeXml(value: string): string {
    return value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** PDF側は全角マイナス（−）を使うが、Excelでは半角に揃える */
export function normalizeMinusSign(value: string): string {
    return value.replace(/[−‒–—－]/g, '-');
}

/** "h:mm" → 分。空文字・不正は null */
export function parseHmToMinutes(value: string): number | null {
    const m = /^(\d{1,3}):(\d{2})$/.exec(value.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (Number.isNaN(h) || Number.isNaN(min) || min >= 60) return null;
    return h * 60 + min;
}

/** 年月日 → Excelシリアル値（日付のみ・1899-12-30起点） */
export function excelSerialFromDate(year: number, month: number, day: number): number {
    return Math.round((Date.UTC(year, month - 1, day) - EXCEL_EPOCH_UTC) / 86400000);
}

/** シート名に使えない文字を除去し、31文字以内に収める */
export function sanitizeSheetName(name: string): string {
    const cleaned = name.replace(/[\\/?*[\]:]/g, '').trim();
    const truncated = cleaned.slice(0, 31).trim();
    return truncated || '出勤簿';
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

type CellValue =
    /** 数値（日付・時刻シリアルを含む） */
    | { kind: 'number'; value: number }
    /** インライン文字列（sharedStrings を汚さない） */
    | { kind: 'text'; value: string }
    /** 空セル（スタイルだけ残す） */
    | { kind: 'empty' };

const EMPTY: CellValue = { kind: 'empty' };
const num = (value: number): CellValue => ({ kind: 'number', value });
const text = (value: string): CellValue => ({ kind: 'text', value });
/** 空文字なら空セル、それ以外は文字列セル */
const textOrEmpty = (value: string): CellValue => (value ? text(value) : EMPTY);
/** "h:mm" が実値なら時刻シリアル、空・0 なら空セル */
function timeSerialOrEmpty(value: string, { allowZero = false } = {}): CellValue {
    const min = parseHmToMinutes(value);
    if (min === null) return EMPTY;
    if (min === 0 && !allowZero) return EMPTY;
    return num(min / MINUTES_PER_DAY);
}

/**
 * セル1個を差し替える。s属性（スタイル）は必ず保持し、数式（<f>）は落とす。
 * テンプレに存在しないセル参照は無視する。
 */
export function setCell(xml: string, ref: string, value: CellValue): string {
    const re = new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
    const m = re.exec(xml);
    if (!m) return xml;
    const styleMatch = /\ss="(\d+)"/.exec(m[1]);
    const style = styleMatch ? ` s="${styleMatch[1]}"` : '';

    let replacement: string;
    if (value.kind === 'empty') {
        replacement = `<c r="${ref}"${style}/>`;
    } else if (value.kind === 'number') {
        replacement = `<c r="${ref}"${style}><v>${value.value}</v></c>`;
    } else {
        replacement = `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            value.value
        )}</t></is></c>`;
    }
    return xml.slice(0, m.index) + replacement + xml.slice(m.index + m[0].length);
}

function setCells(xml: string, cells: Record<string, CellValue>): string {
    let out = xml;
    for (const [ref, value] of Object.entries(cells)) {
        out = setCell(out, ref, value);
    }
    return out;
}

// ---------------------------------------------------------------- シート1枚の値埋め

/**
 * テンプレのシートXMLに1人ぶんの値を書き込む。
 * 触らないのは固定ラベル（2行目のC/E/G/K・4行目のヘッダー・A36・E38:J40のラベル）だけ。
 */
export function fillSheetXml(
    templateSheetXml: string,
    year: number,
    month: number,
    userName: string,
    { days, totals, summary }: AttendanceMonthlyPdfData
): string {
    let xml = templateSheetXml;

    // --- 見出し（2行目）
    xml = setCells(xml, {
        A2: num(year),
        D2: num(month),
        H2: textOrEmpty(userName),
    });

    // --- 日別（5〜35行目）
    for (let row = FIRST_DAY_ROW; row <= LAST_DAY_ROW; row++) {
        const day = row - FIRST_DAY_ROW + 1;
        const d = days[day - 1];
        if (!d) {
            // 当月に存在しない日（30日以下の月の末尾行）は全列を空に
            for (const col of COLUMNS) xml = setCell(xml, `${col}${row}`, EMPTY);
            continue;
        }
        const serial = excelSerialFromDate(year, month, day);
        xml = setCells(xml, {
            [`A${row}`]: num(serial),
            [`B${row}`]: num(serial),
            [`C${row}`]: textOrEmpty(d.statusLabel),
            [`D${row}`]: timeSerialOrEmpty(d.earlyStart),
            [`E${row}`]: timeSerialOrEmpty(d.morningLoading),
            [`F${row}`]: timeSerialOrEmpty(d.startTime),
            [`G${row}`]: timeSerialOrEmpty(d.endTime),
            [`H${row}`]: timeSerialOrEmpty(d.overtime),
            [`I${row}`]: timeSerialOrEmpty(d.eveningLoading),
            [`J${row}`]: timeSerialOrEmpty(d.breakTime),
            // 実働は 0:00 でも「勤務した日」であることを示すため 0 を残す
            [`K${row}`]: timeSerialOrEmpty(d.actual, { allowZero: true }),
            [`L${row}`]: textOrEmpty(normalizeMinusSign(d.diff)),
            [`M${row}`]: textOrEmpty(d.note),
        });
    }

    // --- 合計時間行（36行目）。A36:E36 は結合ラベルなので触らない
    xml = setCells(xml, {
        F36: EMPTY,
        G36: EMPTY,
        H36: EMPTY,
        I36: EMPTY,
        J36: EMPTY,
        K36: EMPTY,
        L36: textOrEmpty(normalizeMinusSign(totals.diff)),
        M36: EMPTY,
    });

    // --- サマリー（38〜40行目）
    // 月合計は 24 時間を超えうるので時刻シリアルではなく文字列で書く（h:mm 表示が壊れるため）
    xml = setCells(xml, {
        F38: num(summary.presentDays),
        F39: num(summary.absentDays),
        F40: num(summary.paidLeaveDays),
        I38: text(normalizeMinusSign(summary.morningLoading)), // 朝積
        I39: text(normalizeMinusSign(summary.earlyStartOvertime)), // 早出/残業
        I40: text(normalizeMinusSign(summary.earlyEnd)), // 早終
        M38: text(normalizeMinusSign(summary.eveningLoading)), // 夕積
        M39: text(normalizeMinusSign(summary.overtimeTotal)), // 時間外合計
        M40: text(normalizeMinusSign(summary.grandTotal)), // 合計
    });

    return xml;
}

// ---------------------------------------------------------------- ブック組み立て

/** definedNames などでシート名を参照するときの引用（' は '' にエスケープ） */
function quoteSheetName(name: string): string {
    return `'${escapeXml(name.replace(/'/g, "''"))}'`;
}

/**
 * テンプレ xlsx のバイト列と各人のデータから、xlsx のバイト列を組み立てる。
 * sheets の配列順どおりにシートを並べる（1人=1シート）。
 */
export async function buildAttendanceWorkbook(
    templateBytes: ArrayBuffer | Uint8Array,
    year: number,
    month: number,
    sheets: AttendanceExcelSheetInput[]
): Promise<ArrayBuffer> {
    if (sheets.length === 0) throw new Error('出力する対象者が選択されていません');

    const zip = await JSZip.loadAsync(templateBytes);
    const baseSheetXml = await zip.file(BASE_SHEET_PATH)!.async('string');
    const baseSheetRels = await zip.file(BASE_SHEET_RELS_PATH)!.async('string');
    const basePrinterSettings = await zip.file(BASE_PRINTER_SETTINGS_PATH)?.async('uint8array');

    const usedNames = new Set<string>();
    const sheetNames = sheets.map((s) => uniqueSheetName(sanitizeSheetName(s.userName), usedNames));

    sheets.forEach((sheet, index) => {
        const n = index + 1;
        const sheetPath = `xl/worksheets/sheet${n}.xml`;
        zip.file(sheetPath, fillSheetXml(baseSheetXml, year, month, sheet.userName, sheet.data));

        if (n > 1) {
            // 2枚目以降はシート付随パーツ（印刷設定）も複製する
            const printerName = `printerSettings${n}.bin`;
            if (basePrinterSettings) {
                zip.file(`xl/printerSettings/${printerName}`, basePrinterSettings);
            }
            zip.file(
                `xl/worksheets/_rels/sheet${n}.xml.rels`,
                baseSheetRels.replace(/printerSettings\d+\.bin/, printerName)
            );
        }
    });

    // --- workbook.xml（シート一覧・印刷範囲）
    let workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    const sheetTags = sheetNames
        .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rIdSheet${i + 1}"/>`)
        .join('');
    workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetTags}</sheets>`);

    const definedNames = sheetNames
        .map(
            (name, i) =>
                `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${quoteSheetName(
                    name
                )}!$A$1:$M$40</definedName>`
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
    zip.file('xl/workbook.xml', workbookXml);

    // --- workbook.xml.rels（シートのリレーション）
    let workbookRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    workbookRels = workbookRels.replace(
        /<Relationship\b[^>]*Type="[^"]*\/worksheet"[^>]*\/>/g,
        ''
    );
    const relTags = sheetNames
        .map(
            (_name, i) =>
                `<Relationship Id="rIdSheet${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
                    i + 1
                }.xml"/>`
        )
        .join('');
    workbookRels = workbookRels.replace('</Relationships>', `${relTags}</Relationships>`);
    zip.file('xl/_rels/workbook.xml.rels', workbookRels);

    // --- [Content_Types].xml（2枚目以降の Override を追加）
    let contentTypes = await zip.file('[Content_Types].xml')!.async('string');
    const overrides = sheetNames
        .slice(1)
        .map(
            (_name, i) =>
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
