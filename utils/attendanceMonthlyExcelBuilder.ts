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
// 集計の型は react-pdf 非依存のモジュールから取る（サーバーからも使うため）
import type { AttendanceMonthlyPdfData } from '@/utils/attendanceMonthlyData';
// セル書き換え・シート複製は受注明細書と共通（utils/xlsxTemplate.ts）
import {
    EMPTY,
    buildWorkbookFromTemplate,
    num,
    openXlsxTemplate,
    sanitizeSheetName,
    setCell,
    setCells,
    text,
    textOrEmpty,
    uniqueSheetName,
    type CellValue,
} from '@/utils/xlsxTemplate';

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

// ---------------------------------------------------------------- セル書き換え

/** "h:mm" が実値なら時刻シリアル、空・0 なら空セル */
function timeSerialOrEmpty(value: string, { allowZero = false } = {}): CellValue {
    const min = parseHmToMinutes(value);
    if (min === null) return EMPTY;
    if (min === 0 && !allowZero) return EMPTY;
    return num(min / MINUTES_PER_DAY);
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

    const template = await openXlsxTemplate(templateBytes);
    const usedNames = new Set<string>();
    return buildWorkbookFromTemplate(
        template,
        sheets.map((sheet) => ({
            name: uniqueSheetName(sanitizeSheetName(sheet.userName, '出勤簿'), usedNames),
            xml: fillSheetXml(template.baseSheetXml, year, month, sheet.userName, sheet.data),
        })),
        { printAreaRef: '$A$1:$M$40' }
    );
}
