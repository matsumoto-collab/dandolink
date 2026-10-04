/**
 * 「手当」の画面で使う、API の形と小さな関数（画面の部品どうしで共有する）。
 * API は app/api/allowances/ 以下（docs/指示書_大規模手当.md の 6-3〜6-6）。
 *
 * 画面が lib/allowances.ts から使うのは、型・定数・日付と月の関数・ロールの判定だけ（5章）。
 * 決まりごと（だれが取り消せる・認められる・締められるか、区分、金額）は、サーバーが返す値で出し分ける。
 * 評価ポイントの部品（components/EvaluationPoints/*）は使わない（片方を直しても、もう片方が変わらないように）。
 */
import { ALLOWANCES_UPDATED_EVENT as EVENT_NAME, monthKeyOf, type AllowancePayRole, type AllowanceStatus } from '@/lib/allowances';

export const ALLOWANCES_API = '/api/allowances';

/** 知らせの名前（「出勤簿入力」・設定の「手当」タブと同じ） */
export const ALLOWANCES_UPDATED_EVENT = EVENT_NAME;

// ---------------------------------------------------------------- API の形

/** 職長・職長以外ごとの日数と金額（確認待ちは入っていない） */
export interface RoleTotals {
    foremanDays: number;
    foremanAmount: number;
    memberDays: number;
    memberAmount: number;
}

export interface SummaryTotals extends RoleTotals {
    totalDays: number;
    totalAmount: number;
    pendingCount: number;
    pendingAmount: number;
}

export interface SummaryPerson extends SummaryTotals {
    userId: string;
    displayName: string;
    /** 小文字 */
    role: string;
    /** true = 常用の一人親方（支払明細書の対象者）。false = 社員 */
    isJoyo: boolean;
    byItem: Record<string, RoleTotals>;
}

export interface EligiblePerson {
    userId: string;
    displayName: string;
    role: string;
    isJoyo: boolean;
}

/** GET /summary?month= （6-4） */
export interface SummaryData {
    month: string;
    startDate: string;
    endDate: string;
    closed: { closedByName: string; closedAt: string } | null;
    items: { id: string; name: string; isActive: boolean }[];
    people: SummaryPerson[];
    totals: SummaryTotals;
    totalsByKind: { employee: SummaryTotals; joyo: SummaryTotals };
    eligiblePeople: EligiblePerson[];
    /** 終わったのに締めていない月（記録のある月だけ。古い順） */
    unclosedPastMonths: string[];
}

/** GET /records の1行（6-3） */
export interface AllowanceRecordRow {
    id: string;
    userId: string;
    userName: string;
    date: string;
    itemId: string;
    /** 記録に写してある名前 */
    itemName: string;
    payRole: AllowancePayRole;
    amount: number;
    status: AllowanceStatus;
    source: string;
    note: string | null;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    confirmedByName: string | null;
    confirmedAt: string | null;
    closed: boolean;
    canRemove: boolean;
    canConfirm: boolean;
}

export type CrosscheckExtraReason = 'no_assignment' | 'not_worked' | 'not_eligible';

export interface CrosscheckMissingRow {
    key: string;
    userId: string;
    userName: string;
    date: string;
    payRole: AllowancePayRole;
    amount: number;
    isSelf: boolean;
}

export interface CrosscheckRecordRow {
    recordId: string;
    userId: string;
    userName: string;
    date: string;
    payRole: AllowancePayRole;
    amount: number;
    status: AllowanceStatus;
    createdByName: string;
}

export interface CrosscheckItem {
    itemId: string;
    itemName: string;
    isActive: boolean;
    constructionContent: string;
    expectedCount: number;
    recordCount: number;
    sites: { projectMasterId: string; title: string; days: number }[];
    missing: CrosscheckMissingRow[];
    extra: (CrosscheckRecordRow & { reason: CrosscheckExtraReason })[];
    mismatch: (CrosscheckRecordRow & { expectedPayRole: AllowancePayRole })[];
    unworked: { userId: string; userName: string; date: string; payRole: AllowancePayRole; attendanceStatus: string | null }[];
    people: {
        userId: string;
        userName: string;
        expectedForemanDays: number;
        expectedMemberDays: number;
        recordedForemanDays: number;
        recordedMemberDays: number;
    }[];
}

/** GET /crosscheck?month= （6-5） */
export interface CrosscheckData {
    month: string;
    closed: boolean;
    items: CrosscheckItem[];
}

/** 「◯日 × 単価 ＝ ◯円」の1行（GET /me の lines。確定の記録だけ） */
export interface MyAllowanceLine {
    itemId: string;
    itemName: string;
    payRole: AllowancePayRole;
    /** 1日の金額 */
    amount: number;
    days: number;
    total: number;
}

/** GET /me?month= （6-7。本人の記録だけ） */
export interface MyAllowanceData {
    month: string;
    startDate: string;
    endDate: string;
    /** 公開の設定の注意書き */
    notice: string | null;
    /** その月が締めてあるか（true = 金額が決まった月。false = まだ変わることがある） */
    closed: boolean;
    lines: MyAllowanceLine[];
    totalDays: number;
    totalAmount: number;
    pendingCount: number;
    pendingAmount: number;
    /** 日付の新しい順 */
    records: { id: string; date: string; itemName: string; payRole: AllowancePayRole; amount: number; status: AllowanceStatus }[];
}

// ---------------------------------------------------------------- 言葉

export const STATUS_LABEL: Record<AllowanceStatus, string> = {
    confirmed: '確定',
    pending: '確認待ち',
};

export const PAY_ROLE_LABEL: Record<AllowancePayRole, string> = {
    foreman: '職長',
    member: '職長以外',
};

/** 入力元（CSV と同じ言葉） */
const SOURCE_LABEL: Record<string, string> = {
    attendance: '出勤簿入力',
    manual: '手当の画面',
    bulk: '手配と見比べる',
};

/** 入力元のコード → 言葉（知らないコードはそのまま） */
export function sourceLabelOf(source: string): string {
    return SOURCE_LABEL[source] ?? source;
}

export const EXTRA_REASON_LABEL: Record<CrosscheckExtraReason, string> = {
    no_assignment: '対象の現場の手配に入っていません',
    not_worked: '出勤簿が出勤になっていません',
    not_eligible: '今は手当の対象外の人です',
};

/** 出勤簿の区分（「月次（個人別）」の区分の言葉と同じ） */
const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
    present: '出勤',
    absent: '欠勤',
    paid_leave: '有給',
    holiday: '休日',
    night_shift: '夜勤',
    compensatory_holiday: '代休',
    holiday_work: '休日出勤',
};

/** 出勤簿の区分のコード → 言葉。知らないコードはそのまま、null は「出勤簿なし」 */
export function attendanceStatusLabelOf(code: string | null): string {
    if (code === null) return '出勤簿なし';
    return ATTENDANCE_STATUS_LABEL[code] ?? code;
}

/** 社員か一人親方か */
export function kindLabelOf(isJoyo: boolean): string {
    return isJoyo ? '一人親方' : '社員';
}

// ---------------------------------------------------------------- 金額・日付

/** 金額 → 「1,500円」 */
export function yen(amount: number): string {
    return `${amount.toLocaleString('ja-JP')}円`;
}

/** 本人の画面の行の名前 → 「大規模手当（職長）」 */
export function myLineLabel(line: Pick<MyAllowanceLine, 'itemName' | 'payRole'>): string {
    return `${line.itemName}（${PAY_ROLE_LABEL[line.payRole]}）`;
}

/** 本人の画面の行の式 → 「3日 × 1,500円 ＝ 4,500円」 */
export function myLineFormula(line: Pick<MyAllowanceLine, 'days' | 'amount' | 'total'>): string {
    return `${line.days}日 × ${yen(line.amount)} ＝ ${yen(line.total)}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM' → monthOffset か月ずらした 'YYYY-MM' */
export function shiftMonth(month: string, monthOffset: number): string {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const d = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** 'YYYY-MM' → 「2026年9月」 */
export function formatMonthLabel(month: string): string {
    return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
}

/** 'YYYY-MM' → 「9月」 */
export function formatMonthShort(month: string): string {
    return `${Number(month.slice(5, 7))}月`;
}

/** 'YYYY-MM' → その月の末日 'YYYY-MM-DD' */
export function monthEndDateKey(month: string): string {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${month}-${pad2(last)}`;
}

/**
 * 「記録を足す」の日付の初期値。見ている月が今月なら今日、そうでなければその月の末日。
 * 先の月を見ているときは、末日が今日より後になるので、今日にする（max は今日）。
 */
export function defaultAddDate(month: string, todayKey: string): string {
    if (month === monthKeyOf(todayKey)) return todayKey;
    const end = monthEndDateKey(month);
    return end > todayKey ? todayKey : end;
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

/** ISO の日時 → 日本時間の「10月3日」 */
export function formatJstMonthDay(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);
    const [, m, day] = key.split('-');
    return `${Number(m)}月${Number(day)}日`;
}

// ---------------------------------------------------------------- CSV

/**
 * CSV のファイル名に、締めの状態を足す（締める前に出した CSV と、締めたあとの CSV を見分けるため）。
 * 「allowances_summary_2026-09.csv」→「allowances_summary_2026-09_締め済み.csv」。.csv で終わらなければ末尾に足す。
 */
export function csvFilenameWithCloseState(filename: string, closed: boolean): string {
    const suffix = closed ? '_締め済み' : '_未締め';
    return /\.csv$/i.test(filename) ? filename.replace(/\.csv$/i, `${suffix}.csv`) : `${filename}${suffix}`;
}

/** 配列を size 件ずつに分ける（まとめて付ける API は 1回に ALLOWANCE_BULK_MAX 件まで） */
export function chunkArray<T>(values: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
    return out;
}

// ---------------------------------------------------------------- 通信

/**
 * 失敗した応答から、画面に出す文言を取り出す。
 * 400・403・404 はサーバーの文言（error。無ければ文字列の details）をそのまま出す。それ以外は fallback。
 */
export async function errorMessageOf(res: Response, fallback: string): Promise<string> {
    if (res.status !== 400 && res.status !== 403 && res.status !== 404) return fallback;
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

/** GET /records のクエリ（userId・status は、使うときだけ付ける。空で送ると 400） */
export function recordsQuery(params: { month?: string; userId?: string; status?: AllowanceStatus }): string {
    const q = new URLSearchParams();
    if (params.month) q.set('month', params.month);
    if (params.userId) q.set('userId', params.userId);
    if (params.status) q.set('status', params.status);
    return q.toString();
}
