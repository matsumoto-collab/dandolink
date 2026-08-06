'use client';

import * as XLSX from 'xlsx';
import {
    buildAttendanceMonthlyPdfData,
    type AttendancePdfRecord,
    type ExportAttendanceMonthlyPdfParams,
    type ExportAttendanceMonthlyBulkPdfParams,
} from '@/utils/attendanceMonthlyPdf';
import { saveBlobWithShare, sanitizeFileName } from '@/utils/saveBlobWithShare';
import { logger } from '@/lib/logger';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 13列（紙の出勤簿／PDFと同じ並び） */
const HEADER_ROW = [
    '日付',
    '曜',
    '区分',
    '早出',
    '朝積',
    '現場開始',
    '現場終了',
    '残業',
    '夕積',
    '休憩',
    '実働',
    '差時間',
    '備考',
];

/** 列幅（日付・曜は狭く、備考は広く） */
const COL_WIDTHS = [5, 4, 8, 7, 7, 9, 9, 7, 7, 7, 7, 8, 30];

/** 氏名を書き込む列（1行目・タイトルの右側） */
const NAME_CELL_COLUMN = 9;

type SheetCell = string | number;

/** シート名に使えない文字を除去し、31文字以内に収める */
function sanitizeSheetName(name: string): string {
    const cleaned = name.replace(/[\\/?*[\]:]/g, '').trim();
    const truncated = cleaned.slice(0, 31).trim();
    return truncated || '出勤簿';
}

/** 同名シートが既にある場合に " (2)" 等を付けて一意化（31文字以内を維持） */
function uniqueSheetName(base: string, used: Set<string>): string {
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

/** 1人ぶんのシートを組み立てる（個人出力・まとめ出力で共用） */
function buildAttendanceSheet(
    year: number,
    month: number,
    userId: string,
    userName: string,
    records: AttendancePdfRecord[]
): XLSX.WorkSheet {
    const { days, totals, summary } = buildAttendanceMonthlyPdfData(year, month, userId, records);

    const titleRow: SheetCell[] = [`${year}年${month}月 出勤簿`];
    titleRow[NAME_CELL_COLUMN] = `氏名: ${userName}`;

    const rows: SheetCell[][] = [
        titleRow,
        [],
        HEADER_ROW,
    ];

    for (const d of days) {
        rows.push([
            d.day,
            d.weekday,
            d.statusLabel,
            d.earlyStart,
            d.morningLoading,
            d.startTime,
            d.endTime,
            d.overtime,
            d.eveningLoading,
            d.breakTime,
            d.actual,
            d.diff,
            d.note,
        ]);
    }

    // 合計時間行（開始・終了・休憩・実働・備考は空欄）
    rows.push([
        '合計時間',
        '',
        '',
        totals.earlyStart,
        totals.morningLoading,
        '',
        '',
        totals.overtime,
        totals.eveningLoading,
        '',
        '',
        totals.diff,
        '',
    ]);

    // サマリー（画面下部のサマリーパネルと同じ項目）
    rows.push([]);
    rows.push(['出勤', `${summary.presentDays} 日`]);
    rows.push(['欠勤', `${summary.absentDays} 日`]);
    rows.push(['有給', `${summary.paidLeaveDays} 日`]);
    rows.push(['朝積', summary.morningLoading]);
    rows.push(['夕積', summary.eveningLoading]);
    rows.push(['早出/残業', summary.earlyStartOvertime]);
    rows.push(['時間外合計', summary.overtimeTotal]);
    rows.push(['早終', summary.earlyEnd]);
    rows.push(['合計', summary.grandTotal]);
    rows.push(['※「時間外合計」= 朝積 + 早出 + 残業 + 夕積']);
    rows.push(['※「合計」= 時間外合計 − 早終']);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = COL_WIDTHS.map((wch) => ({ wch }));
    return ws;
}

/** ブックを xlsx の Blob 化して保存 */
async function saveWorkbook(wb: XLSX.WorkBook, fileName: string): Promise<void> {
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const blob = new Blob([buffer], { type: XLSX_MIME });
    await saveBlobWithShare(blob, fileName, XLSX_MIME, '出勤簿をお送りします');
}

/**
 * 個人別の月次出勤簿をExcel（1シート）で出力してダウンロード
 */
export async function exportAttendanceMonthlyExcel({
    year,
    month,
    userId,
    userName,
    records,
}: ExportAttendanceMonthlyPdfParams): Promise<void> {
    try {
        const wb = XLSX.utils.book_new();
        const ws = buildAttendanceSheet(year, month, userId, userName, records);
        XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(userName));

        const fileName = sanitizeFileName(`出勤簿_${userName}_${year}年${month}月.xlsx`);
        await saveWorkbook(wb, fileName);
    } catch (error) {
        logger.error('出勤簿Excel生成エラー:', error);
        throw error;
    }
}

/**
 * 複数人ぶんの月次出勤簿を1つのExcelブックにまとめて出力してダウンロード。
 * people の配列順どおりに 1人=1シート で並べる。
 */
export async function exportAttendanceMonthlyBulkExcel({
    year,
    month,
    people,
    records,
}: ExportAttendanceMonthlyBulkPdfParams): Promise<void> {
    if (people.length === 0) {
        throw new Error('出力する対象者が選択されていません');
    }
    try {
        const wb = XLSX.utils.book_new();
        const usedNames = new Set<string>();
        for (const p of people) {
            const ws = buildAttendanceSheet(year, month, p.userId, p.userName, records);
            const sheetName = uniqueSheetName(sanitizeSheetName(p.userName), usedNames);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }

        const fileName = sanitizeFileName(`出勤簿_${year}年${month}月_${people.length}名.xlsx`);
        await saveWorkbook(wb, fileName);
    } catch (error) {
        logger.error('出勤簿まとめExcel生成エラー:', error);
        throw error;
    }
}
