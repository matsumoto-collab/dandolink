'use client';

import { pdf } from '@react-pdf/renderer';
import {
    AttendanceMonthlyPDF,
    type AttendanceCellKind,
    type AttendanceMonthlyPdfDay,
    type AttendanceMonthlyPdfSummary,
    type AttendanceMonthlyPdfTotals,
} from '@/components/pdf/AttendanceMonthlyPDF';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

/** 出勤簿PDFに必要な最小のレコード形（GET /api/attendance のレスポンス部分集合） */
export interface AttendancePdfRecord {
    userId: string;
    date: string;
    status: string;
    earlyStartMinutes: number;
    morningLoadingMinutes: number;
    overtimeMinutes: number;
    eveningLoadingMinutes: number;
    earlyEndTime: string | null;
    note: string | null;
}

const WEEK_LABEL = ['日', '月', '火', '水', '木', '金', '土'];

const STATUS_LABEL_MAP: Record<string, string> = {
    present: '出勤',
    absent: '欠勤',
    paid_leave: '有給',
    holiday: '休日',
    night_shift: '夜勤',
    compensatory_holiday: '代休',
    holiday_work: '休日出勤',
};

/** 時刻セルを埋める区分（これ以外と未登録日は時刻列すべて空欄） */
const TIME_FILLED_STATUSES = new Set(['present', 'paid_leave', 'night_shift', 'holiday_work']);

const START_MIN = 8 * 60; // 現場開始 8:00 固定
const STANDARD_END_MIN = 17 * 60; // 現場終了の既定 17:00
const BREAK_MIN = 120; // 休憩 2:00 固定
const STANDARD_WORK_MIN = 7 * 60; // 所定労働 7:00

function pad2(n: number): string {
    return n.toString().padStart(2, '0');
}

/** 0 は空欄（画面側 minutesToHm と同じ挙動） */
function minutesToHm(min: number): string {
    if (min === 0) return '';
    const h = Math.floor(min / 60);
    return `${h}:${pad2(min % 60)}`;
}

/** 0 も "0:00" で表示 */
function minutesToHmZero(min: number): string {
    const h = Math.floor(min / 60);
    return `${h}:${pad2(min % 60)}`;
}

/** 符号付き（マイナスは全角マイナス） */
function minutesToSignedHm(min: number): string {
    if (min === 0) return '0:00';
    return min > 0 ? minutesToHmZero(min) : `−${minutesToHmZero(Math.abs(min))}`;
}

/** "HH:mm" → 分。不正・null は null */
function parseHm(time: string | null): number | null {
    if (!time) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (Number.isNaN(h) || Number.isNaN(min) || min >= 60) return null;
    return h * 60 + min;
}

/** 早終時間（分）= 17:00 − earlyEndTime。画面側 calcEarlyEndMinutes と同一 */
function calcEarlyEndMinutes(earlyEndTime: string | null): number {
    const min = parseHm(earlyEndTime);
    if (min === null) return 0;
    return Math.max(0, STANDARD_END_MIN - min);
}

export interface AttendanceMonthlyPdfData {
    days: AttendanceMonthlyPdfDay[];
    totals: AttendanceMonthlyPdfTotals;
    summary: AttendanceMonthlyPdfSummary;
}

/**
 * 対象ユーザー・対象月のレコードからPDF用の行データ／合計／サマリーを組み立てる。
 * 集計式は MonthlyAttendanceView の aggregates と揃えてある。
 */
export function buildAttendanceMonthlyPdfData(
    year: number,
    month: number,
    userId: string,
    records: AttendancePdfRecord[]
): AttendanceMonthlyPdfData {
    const mine = records.filter((r) => r.userId === userId);
    const byDate = new Map<string, AttendancePdfRecord>();
    for (const r of mine) byDate.set(r.date.split('T')[0], r);

    const daysInMonth = new Date(year, month, 0).getDate();
    const days: AttendanceMonthlyPdfDay[] = [];
    let diffTotal = 0;

    for (let day = 1; day <= daysInMonth; day++) {
        const dow = new Date(year, month - 1, day).getDay();
        const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
        const r = byDate.get(dateStr) ?? null;
        const isSunday = dow === 0;

        // 未登録の日曜は「休日」扱い（画面表示と同じ）
        const status = r?.status ?? (isSunday ? 'holiday' : '');
        const statusLabel = status ? STATUS_LABEL_MAP[status] ?? '' : '';

        let kind: AttendanceCellKind = 'normal';
        if (status === 'holiday') kind = 'holiday';
        else if (status === 'paid_leave') kind = 'paidLeave';

        const filled = TIME_FILLED_STATUSES.has(status);
        const endMin = filled ? parseHm(r?.earlyEndTime ?? null) ?? STANDARD_END_MIN : null;
        const actualMin = endMin === null ? null : endMin - START_MIN - BREAK_MIN;
        const diffMin = actualMin === null ? null : actualMin - STANDARD_WORK_MIN;
        if (diffMin !== null) diffTotal += diffMin;

        days.push({
            day,
            dow,
            weekday: WEEK_LABEL[dow],
            statusLabel,
            kind,
            earlyStart: minutesToHm(r?.earlyStartMinutes ?? 0),
            morningLoading: minutesToHm(r?.morningLoadingMinutes ?? 0),
            startTime: filled ? minutesToHmZero(START_MIN) : '',
            endTime: endMin === null ? '' : minutesToHmZero(endMin),
            overtime: minutesToHm(r?.overtimeMinutes ?? 0),
            eveningLoading: minutesToHm(r?.eveningLoadingMinutes ?? 0),
            breakTime: filled ? minutesToHmZero(BREAK_MIN) : '',
            actual: actualMin === null ? '' : minutesToHmZero(Math.max(0, actualMin)),
            diff: diffMin === null ? '' : minutesToSignedHm(diffMin),
            note: r?.note ?? '',
        });
    }

    // 月合計（対象月のレコード全件。画面 aggregates と同じ集計）
    let presentDays = 0;
    let absentDays = 0;
    let paidLeaveDays = 0;
    let earlyStart = 0;
    let morningLoading = 0;
    let overtime = 0;
    let eveningLoading = 0;
    let earlyEnd = 0;
    for (const r of mine) {
        if (r.status === 'present') presentDays += 1;
        if (r.status === 'absent') absentDays += 1;
        if (r.status === 'paid_leave') paidLeaveDays += 1;
        earlyStart += r.earlyStartMinutes;
        morningLoading += r.morningLoadingMinutes;
        overtime += r.overtimeMinutes;
        eveningLoading += r.eveningLoadingMinutes;
        earlyEnd += calcEarlyEndMinutes(r.earlyEndTime);
    }

    const totals: AttendanceMonthlyPdfTotals = {
        earlyStart: minutesToHm(earlyStart),
        morningLoading: minutesToHm(morningLoading),
        overtime: minutesToHm(overtime),
        eveningLoading: minutesToHm(eveningLoading),
        diff: minutesToSignedHm(diffTotal),
    };

    const summary: AttendanceMonthlyPdfSummary = {
        presentDays,
        absentDays,
        paidLeaveDays,
        morningLoading: minutesToHmZero(morningLoading),
        eveningLoading: minutesToHmZero(eveningLoading),
        earlyStartOvertime: minutesToHmZero(earlyStart + overtime),
        // 時間外合計 = 朝積 + 早出 + 残業 + 夕積
        overtimeTotal: minutesToHmZero(morningLoading + earlyStart + overtime + eveningLoading),
        earlyEnd: minutesToHmZero(earlyEnd),
        // 合計 = 時間外合計 − 早終
        grandTotal: minutesToSignedHm(morningLoading + earlyStart + overtime + eveningLoading - earlyEnd),
    };

    return { days, totals, summary };
}

/** ファイル名に使えない文字を除去 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * PDF Blob を保存する（モバイルではWeb Share対応）
 */
async function savePdfBlob(blob: Blob, fileName: string, shareTitle?: string): Promise<void> {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    // iPadOS 13+ の Safari は UA を Mac と名乗るため iPad 文字列で判定不可。
    // タッチ可能(maxTouchPoints>1)な Mac を iPad とみなす（本物の Mac は 0）。
    const isIpadOS = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || isIpadOS;
    if (
        isMobile &&
        typeof nav.share === 'function' &&
        typeof nav.canShare === 'function' &&
        nav.canShare({ files: [file] })
    ) {
        try {
            await nav.share(shareTitle ? { files: [file], title: shareTitle } : { files: [file] });
            return;
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') return;
        }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
