/**
 * 出勤簿Excel（紙の出勤簿と同じ見た目）のブック組み立て。
 *
 * 方式: public/templates/attendance-monthly-template.xlsx（元の紙の出勤簿から作った1シートのテンプレ）を
 * ZIP のまま開き、シートXMLの**セルの中身**を差し替える。
 * 結合セル・条件付き書式・データ検証・列幅・行高・印刷設定は一切触らない。
 * 数式は全て除去し、計算済みの値を書き込む。
 *
 * スタイル（s属性）は、日別行の「区分〜備考」（C〜M列）だけ付け直す:
 * 区分が 休日＝うすいオレンジ／休日出勤＝黄色／有給＝水色、それ以外は塗りなし。
 * テンプレは 2026年6月の出勤簿から作ったので、その月の休日・有給の位置の塗りや
 * 備考の太字・赤字がセルに残っている。素の行（6行目）のスタイルを基準に毎回付け直すことで、
 * 残っている書式を消し、その月の区分どおりの色にする。罫線・表示形式・フォントは基準の行のまま。
 *
 * ブラウザ・Node の双方から使えるよう、このモジュールは DOM API と react-pdf に依存しない。
 * （テンプレのバイト列は呼び出し側が用意する）
 */
// 集計の型は react-pdf 非依存のモジュールから取る（サーバーからも使うため）
import type { AttendanceMonthlyPdfData } from '@/utils/attendanceMonthlyData';
// セル書き換え・シート複製は受注明細書と共通（utils/xlsxTemplate.ts）
import {
    EMPTY,
    addFillVariants,
    buildWorkbookFromTemplate,
    getCellStyleId,
    num,
    openXlsxTemplate,
    sanitizeSheetName,
    setCell,
    setCellStyle,
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
/**
 * 区分に合わせて塗る列（C=区分 … M=備考）。
 * A・B（日付・曜日）は条件付き書式が土日の色を付けているので触らない。
 */
const FILL_COLUMNS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'] as const;
/** スタイルの基準にする行。テンプレの中で塗り・太字・赤字が残っていない素の行 */
const STYLE_REFERENCE_ROW = 6;
const STYLES_PATH = 'xl/styles.xml';

/** 行の塗りの種類 */
export type AttendanceRowFill = 'holiday' | 'holidayWork' | 'paidLeave';

/** 塗りの色（<fgColor> 要素）。社労士へ出す出勤簿で手塗りしていた色と同じ */
const ROW_FILL_COLORS: Record<AttendanceRowFill, string> = {
    /** 休日: うすいオレンジ（テンプレの休日色と同じ定義） */
    holiday: '<fgColor theme="5" tint="0.59999389629810485"/>',
    /** 休日出勤: 黄色 */
    holidayWork: '<fgColor rgb="FFFFFF00"/>',
    /** 有給: 水色 */
    paidLeave: '<fgColor rgb="FF00B0F0"/>',
};

/** 区分（元の値）→ 行の塗り。塗らない区分（出勤・欠勤・夜勤・代休・未登録）は null */
export function attendanceRowFillOf(status: string): AttendanceRowFill | null {
    if (status === 'holiday') return 'holiday';
    if (status === 'holiday_work') return 'holidayWork';
    if (status === 'paid_leave') return 'paidLeave';
    return null;
}

/** 日別行のスタイル番号の対応表（prepareAttendanceRowStyles の戻り値） */
export interface AttendanceRowStyles {
    /** 列 → 塗りなしの基準スタイル番号 */
    base: Record<string, number>;
    /** 基準スタイル番号 → 塗りごとのスタイル番号 */
    variants: Map<number, Record<AttendanceRowFill, number>>;
}

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
 *
 * rowStyles を渡すと、日別行の C〜M 列のスタイルを区分に合わせて付け直す
 * （渡さなければスタイルはテンプレのまま＝従来どおり）。
 */
export function fillSheetXml(
    templateSheetXml: string,
    year: number,
    month: number,
    userName: string,
    { days, totals, summary }: AttendanceMonthlyPdfData,
    rowStyles?: AttendanceRowStyles
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
        // 区分に合わせて C〜M のスタイルを付け直す（当月に無い日・塗らない区分は塗りなしの基準スタイル）
        if (rowStyles) {
            const fill = d ? attendanceRowFillOf(d.status) : null;
            for (const col of FILL_COLUMNS) {
                const baseId = rowStyles.base[col];
                const styleId = fill ? rowStyles.variants.get(baseId)![fill] : baseId;
                xml = setCellStyle(xml, `${col}${row}`, styleId);
            }
        }
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

// ---------------------------------------------------------------- 行の塗り分け用スタイル

/**
 * 日別行を区分で塗り分けるためのスタイルを styles.xml に足す。
 * 基準は STYLE_REFERENCE_ROW（素の行）の C〜M 各列のスタイル。そこから塗りだけ変えた複製を作る。
 */
export function prepareAttendanceRowStyles(
    templateSheetXml: string,
    stylesXml: string
): { stylesXml: string; rowStyles: AttendanceRowStyles } {
    const base: Record<string, number> = {};
    for (const col of FILL_COLUMNS) {
        const id = getCellStyleId(templateSheetXml, `${col}${STYLE_REFERENCE_ROW}`);
        if (id === null) {
            throw new Error(`出勤簿テンプレートに ${col}${STYLE_REFERENCE_ROW} のセルがありません`);
        }
        base[col] = id;
    }
    const added = addFillVariants(stylesXml, Object.values(base), ROW_FILL_COLORS);
    return { stylesXml: added.stylesXml, rowStyles: { base, variants: added.variants } };
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

    // 区分で塗り分けるためのスタイルを足す（テンプレは毎回バイト列から開き直すので、ここでの書き換えは他の出力に残らない）
    const stylesFile = template.zip.file(STYLES_PATH);
    if (!stylesFile) throw new Error(`テンプレートに ${STYLES_PATH} がありません`);
    const { stylesXml, rowStyles } = prepareAttendanceRowStyles(
        template.baseSheetXml,
        await stylesFile.async('string')
    );
    template.zip.file(STYLES_PATH, stylesXml);

    const usedNames = new Set<string>();
    return buildWorkbookFromTemplate(
        template,
        sheets.map((sheet) => ({
            name: uniqueSheetName(sanitizeSheetName(sheet.userName, '出勤簿'), usedNames),
            xml: fillSheetXml(template.baseSheetXml, year, month, sheet.userName, sheet.data, rowStyles),
        })),
        { printAreaRef: '$A$1:$M$40' }
    );
}
