'use client';

/**
 * 工程表（A3横）の Excel 出力。PDF（components/pdf/ScheduleChartPDF.tsx）と同じ様式・同じデータ。
 *
 * 出勤簿・受注明細書は「会社の Excel をテンプレにして ZIP 直編集」方式だが、工程表は
 * 日付列の数が期間で変わり（最大185列）テンプレでは持てないため、ExcelJS で**新規生成**する。
 * 既存方針の「ExcelJS でスタイルを往復させると劣化する」はテンプレ読み込み→書き出しの話で、
 * 白紙から作る分には当たらない。
 *
 * ・1案件＝組立/その他/解体の3行。現場名は3行結合
 * ・横軸は lib/scheduleChart.ts の目盛（1日1列 or 5日刻み）をそのまま列にする
 * ・工程バーはセルの塗りつぶし（工事種別の色）＝Excel 上でセルを塗り直して調整できる
 * ・A3横・横1ページに収める印刷設定
 */
import type ExcelJS from 'exceljs';
import {
    buildScheduleChart,
    type ScheduleChart,
    type ScheduleChartConstructionTypeInput,
    type ScheduleChartInputProject,
} from '@/lib/scheduleChart';
import { saveBlobWithShare, sanitizeFileName } from '@/utils/saveBlobWithShare';
import { logger } from '@/lib/logger';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FONT = 'Meiryo UI';

// 罫線・地色（PDF と同じ）
const LINE = 'FFB9D7E4';
const LINE_MID = 'FF8FB9CC';
const LINE_STRONG = 'FF4C7F99';
const HEAD_BG = 'FFEAF4F9';
const NAME_BG = 'FFDCEEF6';
const TYPE_BG = 'FFF2F9FC';

/** '#a8c8e8' → 'FFA8C8E8'（ExcelJS の ARGB） */
function argb(hex: string, fallback = 'FFF59E0B'): string {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    return m ? `FF${m[1].toUpperCase()}` : fallback;
}

type Border = Partial<ExcelJS.Borders>;
const thin = (color: string): ExcelJS.Border => ({ style: 'thin', color: { argb: color } });
const medium = (color: string): ExcelJS.Border => ({ style: 'medium', color: { argb: color } });

export interface ScheduleChartExcelMeta {
    projectName?: string;
    processName?: string;
    term?: string;
    supervisor?: string;
    author?: string;
    createdAt?: string;
}

export interface ExportScheduleChartExcelParams {
    projects: ScheduleChartInputProject[];
    constructionTypes: ScheduleChartConstructionTypeInput[];
    meta?: ScheduleChartExcelMeta;
    fileName?: string;
}

/**
 * ブックを組み立てる（保存はしない）。検証スクリプトからも使う。
 */
export async function buildScheduleChartWorkbook(
    chart: ScheduleChart,
    meta: ScheduleChartExcelMeta,
): Promise<ExcelJS.Workbook> {
    const ExcelJSModule = await import('exceljs');
    const Excel = ExcelJSModule.default ?? ExcelJSModule;
    const wb = new Excel.Workbook();
    wb.creator = 'DandoLink';
    wb.created = new Date();

    const ws = wb.addWorksheet('工程表', {
        views: [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 7 }],
        pageSetup: {
            paperSize: 8 as ExcelJS.PaperSize, // A3（ExcelJS の enum 値。型だけ import しているため数値で指定）
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
        },
    });

    const columnCount = Math.max(1, chart.columnCount);
    const isDay = chart.scale === 'day';
    const NAME_COL = 1;
    const TYPE_COL = 2;
    const GRID_FIRST = 3;
    const GRID_LAST = GRID_FIRST + columnCount - 1;
    const REMARK_COL = GRID_LAST + 1;

    // ---- 列幅 ----
    ws.getColumn(NAME_COL).width = 24;
    ws.getColumn(TYPE_COL).width = 8;
    for (let c = GRID_FIRST; c <= GRID_LAST; c += 1) ws.getColumn(c).width = isDay ? 2.4 : 4.2;
    ws.getColumn(REMARK_COL).width = 14;

    // ---- 1行目: タイトル ----
    const TITLE_ROW = 1;
    ws.mergeCells(TITLE_ROW, NAME_COL, TITLE_ROW, REMARK_COL);
    const title = ws.getCell(TITLE_ROW, NAME_COL);
    title.value = '工 程 表';
    title.font = { name: FONT, size: 16, bold: true };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(TITLE_ROW).height = 28;

    // ---- 2〜4行目: 記入欄（左: 工事名/工程名/工期、右: 責任者/作成者/作成日） ----
    const leftFields: [string, string][] = [
        ['工事名', meta.projectName ?? ''],
        ['工程名', meta.processName ?? ''],
        ['工期', meta.term ?? ''],
    ];
    const rightFields: [string, string][] = [
        ['責任者', meta.supervisor ?? ''],
        ['作成者', meta.author ?? ''],
        ['作成日', meta.createdAt ?? ''],
    ];
    // 値欄は日付列を何列か結合して幅を作る（列数が少ない表でも成立するよう上限を取る）
    const leftValueLast = Math.min(GRID_FIRST + 11, GRID_LAST - 8);
    const rightLabelCol = Math.max(leftValueLast + 2, REMARK_COL - 7);
    const rightValueFirst = rightLabelCol + 1;
    leftFields.forEach(([label, value], i) => {
        const r = 2 + i;
        ws.getRow(r).height = 20;
        const l = ws.getCell(r, NAME_COL);
        l.value = label;
        l.font = { name: FONT, size: 10 };
        l.alignment = { vertical: 'middle' };
        ws.mergeCells(r, TYPE_COL, r, leftValueLast);
        const v = ws.getCell(r, TYPE_COL);
        v.value = value;
        v.font = { name: FONT, size: 10 };
        v.alignment = { vertical: 'middle', indent: 1 };
        v.border = { top: thin(LINE_STRONG), bottom: thin(LINE_STRONG), left: thin(LINE_STRONG), right: thin(LINE_STRONG) };
    });
    rightFields.forEach(([label, value], i) => {
        const r = 2 + i;
        const l = ws.getCell(r, rightLabelCol);
        l.value = label;
        l.font = { name: FONT, size: 10 };
        l.alignment = { vertical: 'middle', horizontal: 'right' };
        ws.mergeCells(r, rightValueFirst, r, REMARK_COL);
        const v = ws.getCell(r, rightValueFirst);
        v.value = value;
        v.font = { name: FONT, size: 10 };
        v.alignment = { vertical: 'middle', indent: 1 };
        v.border = { top: thin(LINE_STRONG), bottom: thin(LINE_STRONG), left: thin(LINE_STRONG), right: thin(LINE_STRONG) };
    });

    // ---- 5行目: 凡例（実際に使われた工事種別の色） ----
    const LEGEND_ROW = 5;
    ws.getRow(LEGEND_ROW).height = 16;
    let legendCol = REMARK_COL;
    for (const type of [...chart.usedTypes].reverse()) {
        // 名前セル（右）→ 色セル（左）の順に右端から詰める
        const nameWidthCols = Math.max(3, Math.ceil(type.name.length * (isDay ? 1.2 : 0.7)));
        const nameFirst = Math.max(GRID_FIRST, legendCol - nameWidthCols + 1);
        if (nameFirst < legendCol) ws.mergeCells(LEGEND_ROW, nameFirst, LEGEND_ROW, legendCol);
        const nameCell = ws.getCell(LEGEND_ROW, nameFirst);
        nameCell.value = type.name;
        nameCell.font = { name: FONT, size: 8 };
        nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
        const swatchCol = nameFirst - 1;
        if (swatchCol < GRID_FIRST) break;
        const swatch = ws.getCell(LEGEND_ROW, swatchCol);
        swatch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(type.color) } };
        legendCol = swatchCol - 2;
        if (legendCol < GRID_FIRST) break;
    }

    // ---- 6〜7行目: 表ヘッダー（月・日付） ----
    const MONTH_ROW = 6;
    const DAY_ROW = 7;
    ws.getRow(MONTH_ROW).height = 18;
    ws.getRow(DAY_ROW).height = 16;

    const headCells = [
        [MONTH_ROW, NAME_COL, DAY_ROW, NAME_COL, '現場名'],
        [MONTH_ROW, TYPE_COL, DAY_ROW, TYPE_COL, '工程'],
        [MONTH_ROW, REMARK_COL, DAY_ROW, REMARK_COL, '備考'],
    ] as const;
    for (const [r1, c1, r2, c2, label] of headCells) {
        ws.mergeCells(r1, c1, r2, c2);
        const cell = ws.getCell(r1, c1);
        cell.value = label;
        cell.font = { name: FONT, size: 9, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
    }

    // 月見出し（月の列数ぶん結合）と日付
    let col = GRID_FIRST;
    // 各列の「月の先頭か」「5日ごとの区切りか」＝罫線の濃さ
    const columnKind: ('month' | 'five' | 'day')[] = [];
    for (const month of chart.months) {
        const first = col;
        const last = col + month.cellCount - 1;
        if (last > first) ws.mergeCells(MONTH_ROW, first, MONTH_ROW, last);
        const mc = ws.getCell(MONTH_ROW, first);
        mc.value = month.label;
        mc.font = { name: FONT, size: 9, bold: true };
        mc.alignment = { horizontal: 'center', vertical: 'middle' };
        mc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };

        month.cellLabels.forEach((label, i) => {
            const c = first + i;
            const dc = ws.getCell(DAY_ROW, c);
            // 日単位は数値で入れておく（Excel 上で扱いやすい）
            dc.value = isDay ? Number(label) : label;
            dc.font = { name: FONT, size: isDay ? 7 : 8 };
            dc.alignment = { horizontal: 'center', vertical: 'middle' };
            dc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
            const day = isDay ? Number(label) : null;
            columnKind.push(i === 0 ? 'month' : day !== null && (day - 1) % 5 === 0 ? 'five' : 'day');
        });
        col = last + 1;
    }

    // ---- 8行目〜: 案件（3行ずつ） ----
    const FIRST_BODY_ROW = 8;
    const LINES = 3;
    let row = FIRST_BODY_ROW;
    for (const project of chart.rows) {
        const top = row;
        const bottom = row + LINES - 1;
        for (let r = top; r <= bottom; r += 1) ws.getRow(r).height = 18;

        // 現場名（3行結合）
        ws.mergeCells(top, NAME_COL, bottom, NAME_COL);
        const nameCell = ws.getCell(top, NAME_COL);
        nameCell.value = project.label;
        nameCell.font = { name: FONT, size: 9 };
        nameCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAME_BG } };

        project.lines.forEach((line, i) => {
            const r = top + i;
            const typeCell = ws.getCell(r, TYPE_COL);
            typeCell.value = line.label;
            typeCell.font = { name: FONT, size: 9 };
            typeCell.alignment = { vertical: 'middle', indent: 1 };
            typeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TYPE_BG } };

            // 工程バー＝該当セルを塗る。列座標 [start, end) をセルに落とす
            for (const bar of line.bars) {
                const from = Math.max(0, Math.floor(bar.start));
                const to = Math.min(columnCount, Math.ceil(bar.end));
                for (let x = from; x < to; x += 1) {
                    ws.getCell(r, GRID_FIRST + x).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: argb(bar.color) },
                    };
                }
            }
        });
        row = bottom + 1;
    }
    const LAST_BODY_ROW = Math.max(FIRST_BODY_ROW, row - 1);

    // ---- 最下段: 備考欄 ----
    const REMARKS_ROW = LAST_BODY_ROW + 1;
    ws.getRow(REMARKS_ROW).height = 44;
    const remarksLabel = ws.getCell(REMARKS_ROW, NAME_COL);
    remarksLabel.value = '備考';
    remarksLabel.font = { name: FONT, size: 9, bold: true };
    remarksLabel.alignment = { horizontal: 'center', vertical: 'middle' };
    remarksLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAME_BG } };
    ws.mergeCells(REMARKS_ROW, TYPE_COL, REMARKS_ROW, REMARK_COL);
    ws.getCell(REMARKS_ROW, TYPE_COL).alignment = { vertical: 'top', wrapText: true };

    // ---- 罫線（ヘッダー〜備考欄まで一括。縦線の濃さは列の種類で変える） ----
    for (let r = MONTH_ROW; r <= REMARKS_ROW; r += 1) {
        const isProjectEnd = r >= FIRST_BODY_ROW && r <= LAST_BODY_ROW && (r - FIRST_BODY_ROW) % LINES === LINES - 1;
        const isHeader = r <= DAY_ROW;
        for (let c = NAME_COL; c <= REMARK_COL; c += 1) {
            const cell = ws.getCell(r, c);
            const kind = c >= GRID_FIRST && c <= GRID_LAST ? columnKind[c - GRID_FIRST] : null;
            const leftColor =
                c === NAME_COL || c === TYPE_COL || c === GRID_FIRST || c === REMARK_COL || kind === 'month'
                    ? LINE_STRONG
                    : kind === 'five'
                        ? LINE_MID
                        : LINE;
            const bottomColor = isHeader || isProjectEnd || r === REMARKS_ROW ? LINE_STRONG : LINE;
            const border: Border = {
                top: r === MONTH_ROW ? medium(LINE_STRONG) : undefined,
                left: c === NAME_COL ? medium(LINE_STRONG) : thin(leftColor),
                right: c === REMARK_COL ? medium(LINE_STRONG) : undefined,
                bottom: r === REMARKS_ROW ? medium(LINE_STRONG) : thin(bottomColor),
            };
            // 現場名の結合セル内側は「工程どうしの線」を引かない（結合セルに見せる）
            if (c === NAME_COL && r >= FIRST_BODY_ROW && r <= LAST_BODY_ROW && !isProjectEnd) {
                border.bottom = undefined;
            }
            cell.border = border;
        }
    }

    // 印刷範囲・タイトル行の繰り返し
    ws.pageSetup.printArea = `A1:${ws.getColumn(REMARK_COL).letter}${REMARKS_ROW}`;
    ws.pageSetup.printTitlesRow = `${MONTH_ROW}:${DAY_ROW}`;
    ws.headerFooter = { oddFooter: '&R&P / &N' };

    return wb;
}

export async function exportScheduleChartExcel({
    projects,
    constructionTypes,
    meta = {},
    fileName,
}: ExportScheduleChartExcelParams): Promise<void> {
    try {
        const chart = buildScheduleChart(projects, constructionTypes);
        const wb = await buildScheduleChartWorkbook(chart, { ...meta, term: meta.term ?? chart.termLabel });
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: XLSX_MIME });
        const base = sanitizeFileName(fileName || '工程表') || '工程表';
        const name = base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
        await saveBlobWithShare(blob, name, XLSX_MIME, '工程表');
    } catch (error) {
        logger.error('工程表Excel生成エラー:', error);
        throw error;
    }
}
