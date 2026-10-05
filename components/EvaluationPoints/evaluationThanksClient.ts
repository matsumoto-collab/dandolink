/**
 * 評価ポイント「ありがとう」の画面で使う、API の形と小さな純粋関数（画面の部品どうしで共有する）。
 * API は app/api/evaluation-points/thanks/ 以下。応答の形は、そちらのコードが正。
 * 決まりごと（送れるか・取り消せるか・点数を見せるか）は API が返す値で出し分ける。ここで決め直さない。
 */
import { THANKS_MESSAGE_MAX, THANKS_POINTS_MAX, THANKS_POINTS_MIN, THANKS_VIRTUAL_ITEM_ID } from '@/lib/evaluationThanks';
import { monthRange } from './evaluationPointsClient';

export const THANKS_API = '/api/evaluation-points/thanks';

export { THANKS_MESSAGE_MAX, THANKS_VIRTUAL_ITEM_ID };

// ---------------------------------------------------------------- API の形

/** GET /thanks/me のもらった1件（points は showPoints が false なら null） */
export interface MyThanksReceivedRow {
    id: string;
    date: string;
    fromUserName: string;
    message: string | null;
    points: number | null;
}

/** GET /thanks/me の送った1件 */
export interface MyThanksSentRow {
    id: string;
    date: string;
    toUserId: string;
    toUserName: string;
    message: string | null;
    canRemove: boolean;
}

/** GET /thanks/me */
export interface MyThanksData {
    startDate: string;
    endDate: string;
    active: boolean;
    showPoints: boolean;
    pointsPerThanks: number | null;
    dailyLimit: number;
    remainingToday: number;
    sentTodayToIds: string[];
    recipients: { userId: string; displayName: string }[];
    receivedCount: number;
    receivedPoints: number | null;
    received: MyThanksReceivedRow[];
    sent: MyThanksSentRow[];
}

/** GET /thanks（管理者・マネージャー）の1件 */
export interface ThanksListRow {
    id: string;
    date: string;
    fromUserId: string;
    fromUserName: string;
    toUserId: string;
    toUserName: string;
    message: string | null;
    points: number;
    createdAt: string;
}

/** GET・PUT /thanks/settings */
export interface ThanksSettingData {
    isActive: boolean;
    pointsPerThanks: number;
}

// ---------------------------------------------------------------- 月（'YYYY-MM'）

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

/** 'YYYY-MM' として正しいか（月は 01〜12） */
export function isValidThanksMonthKey(value: string): boolean {
    const m = MONTH_KEY_RE.exec(value);
    if (!m) return false;
    const month = Number(m[2]);
    return month >= 1 && month <= 12;
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function thanksMonthKeyOf(dateKey: string): string {
    return dateKey.slice(0, 7);
}

/** 'YYYY-MM' → その月の初日と末日（'YYYY-MM-DD'） */
export function thanksMonthRange(monthKey: string): { startDate: string; endDate: string } {
    const [y, m] = monthKey.split('-').map(Number);
    return monthRange(y, m);
}

/** 'YYYY-MM' の前後の月（offset は月の数。年をまたぐ） */
export function shiftThanksMonth(monthKey: string, offset: number): string {
    const [y, m] = monthKey.split('-').map(Number);
    const total = y * 12 + (m - 1) + offset;
    const year = Math.floor(total / 12);
    const month = total - year * 12 + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** 'YYYY-MM' → 「2026年10月」 */
export function formatThanksMonthLabel(monthKey: string): string {
    const [y, m] = monthKey.split('-').map(Number);
    return `${y}年${m}月`;
}

// ---------------------------------------------------------------- 表示の言葉

/** 送るボタンの横の言葉（残りの回数は API の remainingToday・上限は dailyLimit をそのまま使う） */
export function remainingTodayLabel(remainingToday: number, dailyLimit: number): string {
    if (remainingToday <= 0) return `今日は、もう${dailyLimit}回送りました`;
    return `今日は、あと${remainingToday}回送れます`;
}

/** 「もらった ◯回」（点数は showPoints のときだけ渡す。null なら付けない） */
export function receivedHeadingLabel(count: number, points: number | null): string {
    return points === null ? `もらった ${count}回` : `もらった ${count}回・${points}点`;
}

/** 「送った ◯回」 */
export function sentHeadingLabel(count: number): string {
    return `送った ${count}回`;
}

/** ひとことの字数の表示「◯ / 100」 */
export function messageCountLabel(message: string): string {
    return `${message.length} / ${THANKS_MESSAGE_MAX}`;
}

/**
 * 設定の「1回あたりの点数」の入力欄の文字 → 数（0〜9999 の整数でなければ null）。
 * 前後の空白は取る。数字以外（小数点・マイナス・全角の数字など）が混ざれば null。
 */
export function parseThanksPointsInput(text: string): number | null {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < THANKS_POINTS_MIN || value > THANKS_POINTS_MAX) return null;
    return value;
}

// ---------------------------------------------------------------- 一覧

/** 全員分の一覧から、その人がもらった分だけ（人の明細で使う） */
export function thanksReceivedBy(rows: readonly ThanksListRow[], userId: string): ThanksListRow[] {
    return rows.filter((r) => r.toUserId === userId);
}

/** 集計に「ありがとう」の仮の項目があるか（Phase 2 の集計の items） */
export function hasThanksItem(items: readonly { id: string }[] | null | undefined): boolean {
    return !!items && items.some((i) => i.id === THANKS_VIRTUAL_ITEM_ID);
}
