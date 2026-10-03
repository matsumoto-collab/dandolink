/**
 * 支払明細書（常用で来ている一人親方向け）の API ↔ 画面の型。
 *
 * PDF の部品（components/pdf/JoyoStatementPDF.tsx）は 'use client' だが、
 * **`import type` なら実行時に残らない**ので API 側から読んでよい（utils/attendanceMonthlyData.ts と同じ）。
 */
import type { AttendancePdfRecord } from '@/utils/attendanceMonthlyData';
import type { JoyoDayCounts, JoyoStatementItem } from '@/lib/joyoStatement';
import type { JoyoStatementPdfIssuer, JoyoStatementPdfRecipient } from '@/components/pdf/JoyoStatementPDF';

export type JoyoStatementStatus = 'draft' | 'issued';

/** 金額に関わる日数（明細に覚えておく・画面から送る） */
export type JoyoPaidDayCounts = Pick<JoyoDayCounts, 'present' | 'holidayWork' | 'nightShift'>;

export interface JoyoContractorDto {
    id: string;
    userId: string;
    /** 出勤簿の名前（User.displayName）。ユーザーが見つからなければ空文字 */
    userDisplayName: string;
    code: number;
    recipientName: string;
    honorific: string;
    postalCode: string | null;
    address: string | null;
    registrationNumber: string | null;
    unitPrice: number;
    payeeId: string | null;
    /** 口座番号・名義そのものは返さない（有無だけ） */
    payee: { id: string; name: string; bankLabel: string; hasAccount: boolean; isActive: boolean } | null;
    sortOrder: number;
    isActive: boolean;
    notes: string | null;
}

/** 発行した時点の写し（発行済みの PDF はここから作る） */
export interface JoyoIssuedSnapshot {
    title: string;
    footerNote: string;
    recipient: JoyoStatementPdfRecipient;
    issuer: JoyoStatementPdfIssuer;
    /** 出勤簿ページの氏名（User.displayName） */
    attendanceUserName: string;
    /** 対象月の出勤簿（1か月ぶん） */
    attendanceRecords: AttendancePdfRecord[];
}

export interface JoyoStatementDto {
    id: string;
    contractorId: string;
    year: number;
    month: number;
    status: JoyoStatementStatus;
    statementNo: string | null;
    issueDate: string; // YYYY-MM-DD
    paymentDate: string; // YYYY-MM-DD
    subject: string;
    items: JoyoStatementItem[];
    total: number;
    tax: number;
    includeAttendance: boolean;
    attendanceCounts: JoyoPaidDayCounts | null;
    issuedSnapshot: JoyoIssuedSnapshot | null;
    issuedAt: string | null;
    paymentScheduleId: string | null;
    notes: string | null;
    updatedAt: string;
}

/** 一覧の1行（対象者1人ぶん） */
export interface JoyoStatementRow {
    contractor: JoyoContractorDto;
    /** 今の出勤簿（対象月） */
    attendance: { counts: JoyoDayCounts; records: AttendancePdfRecord[] };
    /** 保存済みの明細。無ければ null（未作成） */
    statement: JoyoStatementDto | null;
    /** 明細に覚えていた日数と今の出勤簿が違う */
    attendanceChanged: boolean;
    /** 支払予定に追加済みで、その行がまだあるとき */
    paymentSchedule: { id: string; paymentDate: string; amount: number; isPaid: boolean } | null;
}

export interface JoyoStatementsResponse {
    year: number;
    month: number;
    /** 今日（JST）'YYYY-MM-DD' */
    today: string;
    settings: { title: string; footerNote: string };
    /** 自社情報。未登録なら null */
    issuer: JoyoStatementPdfIssuer | null;
    rows: JoyoStatementRow[];
}

/** 設定画面用（GET /api/joyo-statements/contractors） */
export interface JoyoContractorsResponse {
    /** 利用停止も含む全件。sortOrder → code */
    contractors: JoyoContractorDto[];
    /** 対象者に選べるユーザー（まだ登録されていない人） */
    userOptions: { id: string; displayName: string }[];
    /** 利用中の振込先。口座番号・名義は返さない */
    payeeOptions: { id: string; name: string; bankLabel: string; hasAccount: boolean }[];
}
