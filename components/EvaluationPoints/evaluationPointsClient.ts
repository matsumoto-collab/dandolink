/**
 * 「評価ポイント」の画面で使う、API の形と小さな関数（画面の部品どうしで共有する）。
 * API は app/api/evaluation-points/ 以下（docs/指示書_評価ポイント.md の 6-3・6-4）。
 */
import type { EvaluationPointStatus } from '@/lib/evaluationPoints';

export const EVALUATION_POINTS_API = '/api/evaluation-points';

/** 知らせの名前（「出勤簿入力」・設定の「評価ポイント」タブと同じ） */
export const EVALUATION_POINTS_UPDATED_EVENT = 'evaluation_points_updated';

// ---------------------------------------------------------------- API の形

export interface SummaryItem {
    id: string;
    name: string;
    inputBy: string;
    isActive: boolean;
}

export interface SummaryCell {
    count: number;
    points: number;
}

export interface SummaryPerson {
    userId: string;
    displayName: string;
    role: string;
    byItem: Record<string, SummaryCell>;
    totalCount: number;
    totalPoints: number;
    pendingCount: number;
    pendingPoints: number;
}

export interface EligiblePerson {
    userId: string;
    displayName: string;
    role: string;
}

export interface SummaryData {
    startDate: string;
    endDate: string;
    items: SummaryItem[];
    people: SummaryPerson[];
    totals: { byItem: Record<string, SummaryCell>; totalCount: number; totalPoints: number; pendingCount: number };
    eligiblePeople: EligiblePerson[];
}

export interface PointRecord {
    id: string;
    userId: string;
    userName: string;
    date: string;
    itemId: string;
    itemName: string;
    points: number;
    status: EvaluationPointStatus;
    source: string;
    note: string | null;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    confirmedByName: string | null;
    confirmedAt: string | null;
    canRemove: boolean;
    canConfirm: boolean;
}

/** GET /items の1行のうち、「記録を足す」で使う部分 */
export interface ItemOption {
    id: string;
    name: string;
    isActive: boolean;
    inputBy: string;
}

/** GET /me（本人の点数と内訳。6-4）。付けた人の名前・メモは入っていない */
export interface MyPointsData {
    startDate: string;
    endDate: string;
    notice: string | null;
    totalPoints: number;
    totalCount: number;
    pendingCount: number;
    /** 回数のある項目だけ。点数の多い順。itemName は今の項目名 */
    byItem: { itemId: string; itemName: string; count: number; points: number }[];
    /** 日付の新しい順。itemName は記録に写してある名前 */
    records: { id: string; date: string; itemName: string; points: number; status: EvaluationPointStatus }[];
}

export const STATUS_LABEL: Record<EvaluationPointStatus, string> = {
    confirmed: '確定',
    pending: '確認待ち',
};

export const SOURCE_LABEL: Record<string, string> = {
    attendance: '出勤簿入力',
    manual: '評価ポイントの画面',
};

// ---------------------------------------------------------------- 日付

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD'（その年・月の1日〜末日） */
export function monthRange(year: number, month: number): { startDate: string; endDate: string } {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { startDate: `${year}-${pad2(month)}-01`, endDate: `${year}-${pad2(month)}-${pad2(last)}` };
}

/** 'YYYY-MM-DD' → その月の1日〜末日。monthOffset で前後の月 */
export function monthRangeOf(dateKey: string, monthOffset = 0): { startDate: string; endDate: string } {
    const [y, m] = dateKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
    return monthRange(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/** 'YYYY-MM-DD' → 「10/3」 */
export function formatShortDate(dateKey: string): string {
    const [, m, d] = dateKey.split('-');
    return `${Number(m)}/${Number(d)}`;
}

/** ISO の日時 → 日本時間の「2026-10-03 12:34」 */
export function formatJstDateTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(d);
}

// ---------------------------------------------------------------- 通信

/** 失敗した応答から、画面に出す文言を取り出す（error。検証エラーのときは文字列の details） */
export async function errorMessageOf(res: Response, fallback: string): Promise<string> {
    try {
        const body = (await res.json()) as { error?: unknown; details?: unknown };
        if (typeof body.details === 'string' && body.details && body.error === 'Validation Error') return body.details;
        if (typeof body.error === 'string' && body.error) return body.error;
        if (typeof body.details === 'string' && body.details) return body.details;
    } catch {
        // 本文が JSON でない
    }
    return fallback;
}

/** Content-Disposition の filename を読む（無ければ fallback） */
export function filenameOf(res: Response, fallback: string): string {
    const header = res.headers.get('Content-Disposition') ?? '';
    const m = /filename="([^"]+)"/.exec(header);
    return m ? m[1] : fallback;
}
