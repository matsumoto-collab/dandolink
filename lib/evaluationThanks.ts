/**
 * 評価ポイント「ありがとう」の決まりごと（純粋関数だけ）。
 *
 * 社員どうしが「相手を選んで」送る「ありがとう」（kei 決定 2026-10-05）。もらった数に応じて、評価ポイントに点が入る。
 * Prisma にも React にも依存しない。API・テストは、ここの関数で「だれが何をできるか」を決める。
 * ロールの判定は lib/evaluationPoints.ts の関数を呼ぶ（ロールの文字列を、ここで書き直さない）。
 *
 * 決まり:
 *  - 送れる人・もらえる人 … 評価ポイントの対象のロール（worker・foreman1・foreman2・manager・admin）。もらう相手は在籍している人だけ
 *  - 歯止め … 自分には送れない／同じ相手には1日1回まで／1人が1日に送れるのは3回まで
 *  - 送れるのは今日（日本時間）の分だけ（日付はサーバーが決める）
 *  - 点数 … 送った時点の「1回あたりの点数」を、その行に写す（あとから設定を変えても、送ってある行は変えない）
 *  - 取り消し … 送った本人は送った日（日本時間）のうちだけ。管理者・マネージャーは、いつでも・だれの分でも
 *  - 確認待ちは無い（送ったら、そのまま数える）
 */
import { isEvaluationPointAdmin, isEvaluationPointEligibleRole, isEvaluationPointManager } from '@/lib/evaluationPoints';

/** 1人が1日に送れる回数 */
export const THANKS_DAILY_LIMIT = 3;
/** ひとことの字数の上限（前後の空白を取ったあと） */
export const THANKS_MESSAGE_MAX = 100;
/** 1回あたりの点数の下限・上限 */
export const THANKS_POINTS_MIN = 0;
export const THANKS_POINTS_MAX = 9999;
/** 評価ポイントの集計に足すときの、仮の項目の id と名前（あとの Phase で使う） */
export const THANKS_VIRTUAL_ITEM_ID = '__thanks__';
export const THANKS_ITEM_NAME = 'ありがとう';

// ---------------------------------------------------------------- だれが

/** 「ありがとう」を送れる・もらえるロールか（評価ポイントの対象のロールと同じ） */
export function canUseThanks(role: string | null | undefined): boolean {
    return isEvaluationPointEligibleRole(role);
}

/** 全員の分の一覧を見る・だれの分でも取り消せるロールか（admin・manager） */
export function isThanksManager(role: string | null | undefined): boolean {
    return isEvaluationPointManager(role);
}

/** 設定（使う／使わない・1回あたりの点数）を直せるロールか（admin だけ） */
export function isThanksAdmin(role: string | null | undefined): boolean {
    return isEvaluationPointAdmin(role);
}

// ---------------------------------------------------------------- 入力

/** 1回あたりの点数として受け付ける値か（0〜9999 の整数） */
export function isValidThanksPoints(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= THANKS_POINTS_MIN
        && value <= THANKS_POINTS_MAX;
}

/**
 * ひとこと: undefined・null・空（空白だけ）は null。文字列は前後の空白を取って 100字まで。
 * 文字列でも null でもない・100字を超える は { ok: false }
 */
export function normalizeThanksMessage(value: unknown): { ok: true; value: string | null } | { ok: false } {
    if (value === undefined || value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return { ok: false };
    const trimmed = value.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    if (trimmed.length > THANKS_MESSAGE_MAX) return { ok: false };
    return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------- 送る

export const THANKS_MESSAGES = {
    forbidden: '権限がありません',
    inactive: '「ありがとう」は、今は使えません（管理者が、設定の「評価ポイント」で「使う」にすると、送れます）',
    recipientNotFound: '相手が見つかりません',
    self: '自分には送れません',
    recipientNotEligible: '「ありがとう」を送れない相手です',
    alreadySentToday: '今日は、もうこの人に送っています（同じ人には1日1回までです）',
    dailyLimit: '1日に送れるのは3回までです',
} as const;

export interface SendThanksDecisionInput {
    /** 設定が「使う」か */
    active: boolean;
    /** 送る人（セッションの id） */
    fromId: string;
    fromRole: string | null | undefined;
    /** 相手。見つからなければ null */
    to: { id: string; role: string | null; isActive: boolean } | null;
    /** 送る人が、今日（日本時間）もう送った相手の id */
    sentTodayToIds: readonly string[];
}

export type SendThanksDecision =
    | { ok: true }
    | { ok: false; status: 400 | 403; message: string };

/**
 * 送ってよいかを決める。2つ以上に当たるときは、上に書いたほうの文言を返す。
 *  1. 送る人のロールが対象外 → 403
 *  2. 「使わない」のあいだ
 *  3. 相手が無い・在籍していない
 *  4. 相手が自分
 *  5. 相手のロールが対象外
 *  6. 今日もうその相手に送っている
 *  7. 今日もう3回送っている
 */
export function decideSendThanks(input: SendThanksDecisionInput): SendThanksDecision {
    const { active, fromId, fromRole, to, sentTodayToIds } = input;
    if (!canUseThanks(fromRole)) return { ok: false, status: 403, message: THANKS_MESSAGES.forbidden };
    if (!active) return { ok: false, status: 400, message: THANKS_MESSAGES.inactive };
    if (!to || !to.isActive) return { ok: false, status: 400, message: THANKS_MESSAGES.recipientNotFound };
    if (to.id === fromId) return { ok: false, status: 400, message: THANKS_MESSAGES.self };
    if (!canUseThanks(to.role)) return { ok: false, status: 400, message: THANKS_MESSAGES.recipientNotEligible };
    if (sentTodayToIds.includes(to.id)) return { ok: false, status: 400, message: THANKS_MESSAGES.alreadySentToday };
    if (sentTodayToIds.length >= THANKS_DAILY_LIMIT) return { ok: false, status: 400, message: THANKS_MESSAGES.dailyLimit };
    return { ok: true };
}

/** 今日あと何回送れるか（0 より小さくはしない） */
export function remainingThanksToday(sentCount: number): number {
    return Math.max(0, THANKS_DAILY_LIMIT - sentCount);
}

// ---------------------------------------------------------------- 取り消す

/**
 * その「ありがとう」を取り消してよいか。
 *  - 管理者・マネージャー … いつでも・だれの分でも
 *  - 送った本人 … 送った日（日本時間）のうちだけ（todayKey は todayJstDateKey() の値を渡す）
 */
export function canRemoveThanks(
    operator: { id: string; role: string | null | undefined },
    thanks: { fromUserId: string; dateKey: string },
    todayKey: string,
): boolean {
    if (isThanksManager(operator.role)) return true;
    if (!canUseThanks(operator.role)) return false;
    return operator.id !== '' && thanks.fromUserId === operator.id && thanks.dateKey === todayKey;
}

// ---------------------------------------------------------------- 集計

/**
 * もらった人ごとに、回数と点数（行に写してある点数の足し算）をまとめる。
 * 設定の今の点数は見ない（あとから設定を変えても、過去の合計が変わらないようにするため）。
 */
export function summarizeThanks(rows: readonly { toUserId: string; points: number }[]): Map<string, { count: number; points: number }> {
    const result = new Map<string, { count: number; points: number }>();
    for (const r of rows) {
        const cell = result.get(r.toUserId) ?? { count: 0, points: 0 };
        cell.count += 1;
        cell.points += r.points;
        result.set(r.toUserId, cell);
    }
    return result;
}
