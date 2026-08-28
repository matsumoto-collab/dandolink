'use client';

import { pdf } from '@react-pdf/renderer';
import {
    AttendanceMonthlyPDF,
    AttendanceMonthlyBulkPDF,
    type AttendanceMonthlyPerson,
} from '@/components/pdf/AttendanceMonthlyPDF';
import { logger } from '@/lib/logger';
import { saveBlobWithShare, sanitizeFileName } from '@/utils/saveBlobWithShare';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

// 集計は react-pdf 非依存の attendanceMonthlyData.ts に移した。
// 既存の import 先（attendanceMonthlyExcel など）を変えずに済むよう、ここから再エクスポートする。
import {
    buildAttendanceMonthlyPdfData,
    type AttendancePdfRecord,
} from '@/utils/attendanceMonthlyData';

export { buildAttendanceMonthlyPdfData };
export type {
    AttendancePdfRecord,
    AttendanceMonthlyPdfData,
} from '@/utils/attendanceMonthlyData';

/** Excel出力側とも共有する保存ヘルパー（再エクスポート） */
export { saveBlobWithShare, sanitizeFileName };

/** PDF Blob を保存する（モバイルではWeb Share対応） */
async function savePdfBlob(blob: Blob, fileName: string, shareTitle?: string): Promise<void> {
    await saveBlobWithShare(blob, fileName, 'application/pdf', shareTitle);
}

export interface ExportAttendanceMonthlyPdfParams {
    year: number;
    month: number;
    userId: string;
    userName: string;
    records: AttendancePdfRecord[];
}

/**
 * 個人別の月次出勤簿をPDF出力してダウンロード
 */
export async function exportAttendanceMonthlyPDF({
    year,
    month,
    userId,
    userName,
    records,
}: ExportAttendanceMonthlyPdfParams): Promise<void> {
    try {
        const { days, totals, summary } = buildAttendanceMonthlyPdfData(year, month, userId, records);
        const blob = await pdf(
            <AttendanceMonthlyPDF
                year={year}
                month={month}
                userName={userName}
                days={days}
                totals={totals}
                summary={summary}
            />
        ).toBlob();

        const fileName = sanitizeFileName(`出勤簿_${userName}_${year}年${month}月.pdf`);
        await savePdfBlob(blob, fileName, '出勤簿をお送りします');
    } catch (error) {
        logger.error('出勤簿PDF生成エラー:', error);
        throw error;
    }
}

export interface ExportAttendanceMonthlyBulkPdfParams {
    year: number;
    month: number;
    /** 出力対象。**この配列順どおり**にページを並べる（1人=1ページ） */
    people: { userId: string; userName: string }[];
    records: AttendancePdfRecord[];
}

/**
 * 複数人ぶんの月次出勤簿を1つのPDFにまとめて出力してダウンロード。
 * 各ページのレイアウトは個人出力（exportAttendanceMonthlyPDF）と同一。
 */
export async function exportAttendanceMonthlyBulkPDF({
    year,
    month,
    people,
    records,
}: ExportAttendanceMonthlyBulkPdfParams): Promise<void> {
    if (people.length === 0) {
        throw new Error('出力する対象者が選択されていません');
    }
    try {
        const pages: AttendanceMonthlyPerson[] = people.map((p) => ({
            userName: p.userName,
            ...buildAttendanceMonthlyPdfData(year, month, p.userId, records),
        }));
        const blob = await pdf(
            <AttendanceMonthlyBulkPDF year={year} month={month} people={pages} />
        ).toBlob();

        const fileName = sanitizeFileName(`出勤簿_${year}年${month}月_${people.length}名.pdf`);
        await savePdfBlob(blob, fileName, '出勤簿をお送りします');
    } catch (error) {
        logger.error('出勤簿まとめPDF生成エラー:', error);
        throw error;
    }
}
