'use client';

/**
 * 出勤簿のExcel出力（紙の出勤簿と同じ見た目）。
 *
 * public/templates/attendance-monthly-template.xlsx を取得し、
 * 罫線・塗り・列幅・行高・結合セル・条件付き書式・印刷設定はそのままに、
 * セルの値だけを差し替えて配布する（詳細は attendanceMonthlyExcelBuilder.ts）。
 * 集計はPDF出力と同じ buildAttendanceMonthlyPdfData を使うので、PDFとExcelで数字は必ず一致する。
 */
import {
    buildAttendanceMonthlyPdfData,
    type ExportAttendanceMonthlyPdfParams,
    type ExportAttendanceMonthlyBulkPdfParams,
} from '@/utils/attendanceMonthlyPdf';
import {
    buildAttendanceWorkbook,
    type AttendanceExcelSheetInput,
} from '@/utils/attendanceMonthlyExcelBuilder';
import { saveBlobWithShare, sanitizeFileName } from '@/utils/saveBlobWithShare';
import { logger } from '@/lib/logger';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 紙の出勤簿から作ったテンプレート（ビルド生成物・scripts/build-attendance-excel-template.ts） */
const TEMPLATE_URL = '/templates/attendance-monthly-template.xlsx';

/** テンプレートを取得（同一セッション内では使い回す） */
let templateCache: Promise<ArrayBuffer> | null = null;
async function loadTemplate(): Promise<ArrayBuffer> {
    if (!templateCache) {
        templateCache = (async () => {
            const res = await fetch(TEMPLATE_URL, { cache: 'force-cache' });
            if (!res.ok) throw new Error(`出勤簿テンプレートの取得に失敗しました (${res.status})`);
            return res.arrayBuffer();
        })().catch((e) => {
            templateCache = null;
            throw e;
        });
    }
    return templateCache;
}

/** 組み立てたブックを保存する */
async function saveWorkbook(buffer: ArrayBuffer, fileName: string): Promise<void> {
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
        const template = await loadTemplate();
        const sheets: AttendanceExcelSheetInput[] = [
            { userName, data: buildAttendanceMonthlyPdfData(year, month, userId, records) },
        ];
        const buffer = await buildAttendanceWorkbook(template, year, month, sheets);

        const fileName = sanitizeFileName(`出勤簿_${userName}_${year}年${month}月.xlsx`);
        await saveWorkbook(buffer, fileName);
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
        const template = await loadTemplate();
        const sheets: AttendanceExcelSheetInput[] = people.map((p) => ({
            userName: p.userName,
            data: buildAttendanceMonthlyPdfData(year, month, p.userId, records),
        }));
        const buffer = await buildAttendanceWorkbook(template, year, month, sheets);

        const fileName = sanitizeFileName(`出勤簿_${year}年${month}月_${people.length}名.xlsx`);
        await saveWorkbook(buffer, fileName);
    } catch (error) {
        logger.error('出勤簿まとめExcel生成エラー:', error);
        throw error;
    }
}
