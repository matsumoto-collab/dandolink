/**
 * 評価ポイントの決まりごと（純粋関数だけ）。
 *
 * Prisma にも React にも依存しない。API・画面・テストの全部がここを使うので、
 * 「だれが何をできるか」「どの点数を使うか」の決まりはこのファイルにだけ書く。
 *
 * 用語:
 *  - 項目   … 点数表の1行（洗車・他の班のヘルプ など）。EvaluationPointItem
 *  - 点数   … 項目ごとに「適用開始日つき」で持つ。EvaluationPointRate（追記のみ）
 *  - 記録   … 1人・1日・1項目で1行。点数は付けた時点の写し。EvaluationPointRecord
 *  - 確認待ち … 自分で自分に付けた記録。管理者・マネージャーが認めるまで合計に入れない
 */

/** ポイントをもらえる人（社員）のロール。協力会社・協力会社のメンバー・応援・税理士は対象外 */
export const EVALUATION_POINT_ELIGIBLE_ROLES: readonly string[] = ['worker', 'foreman1', 'foreman2', 'manager', 'admin'];
/** 「出勤簿入力」でポイントを付けられるロール（出勤簿を入力できるロールと同じ） */
export const EVALUATION_POINT_INPUT_ROLES: readonly string[] = ['admin', 'manager', 'foreman1', 'foreman2'];
/** 全員の一覧を見られる・記録の追加／取り消し／確認ができるロール */
export const EVALUATION_POINT_MANAGER_ROLES: readonly string[] = ['admin', 'manager'];
/** 自分の点数だけを見るロール（公開の設定がオンのときだけ見える） */
export const EVALUATION_POINT_MEMBER_ROLES: readonly string[] = ['worker', 'foreman1', 'foreman2'];

export const EVALUATION_POINT_MIN = 0;
export const EVALUATION_POINT_MAX = 9999;
export const EVALUATION_POINT_NAME_MAX = 30;
export const EVALUATION_POINT_DESCRIPTION_MAX = 200;
export const EVALUATION_POINT_NOTE_MAX = 200;

export type EvaluationPointInputBy = 'foreman' | 'admin';
export type EvaluationPointStatus = 'confirmed' | 'pending';

/**
 * DB から読んだ status（ただの文字列）を、決まった2つの値にそろえる。
 * 'pending' 以外は 'confirmed' として扱う（知らない値を「確認待ち」にして合計から落とさないため）。
 * Prisma の行をこのファイルの関数へ渡す前に、必ずこれを通す。
 */
export function toEvaluationPointStatus(value: string | null | undefined): EvaluationPointStatus {
    return value === 'pending' ? 'pending' : 'confirmed';
}

/** DB に入っているロールは大文字が混ざるので、必ず小文字にそろえてから比べる */
const normalizeRole = (role: string | null | undefined): string => (role ?? '').toLowerCase();

export function isEvaluationPointEligibleRole(role: string | null | undefined): boolean {
    return EVALUATION_POINT_ELIGIBLE_ROLES.includes(normalizeRole(role));
}

export function canInputEvaluationPoints(role: string | null | undefined): boolean {
    return EVALUATION_POINT_INPUT_ROLES.includes(normalizeRole(role));
}

export function isEvaluationPointManager(role: string | null | undefined): boolean {
    return EVALUATION_POINT_MANAGER_ROLES.includes(normalizeRole(role));
}

export function isEvaluationPointMemberRole(role: string | null | undefined): boolean {
    return EVALUATION_POINT_MEMBER_ROLES.includes(normalizeRole(role));
}

/** 点数表（項目・点数）と公開の設定を直せるか（管理者だけ。マネージャーは見るだけ） */
export function isEvaluationPointAdmin(role: string | null | undefined): boolean {
    return normalizeRole(role) === 'admin';
}

// ---------------------------------------------------------------- 日付

/** 'YYYY-MM-DD' → UTC 0時の Date（@db.Date の列に入れる形）。形が違う・実在しない日付は null */
export function dateKeyToDate(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const date = new Date(Date.UTC(y, mo - 1, d));
    // 2026-02-30 のような実在しない日付は、Date が翌月へ繰り上げるのではじく
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    return date;
}

/** @db.Date の列から読んだ Date（UTC 0時の印）→ 'YYYY-MM-DD' */
export function dateToDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** JST の今日を 'YYYY-MM-DD' で返す（サーバーは UTC で動くので、new Date() の年月日をそのまま使わない） */
export function todayJstDateKey(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

/** その日付が、日本時間の今日より後か（先の日付には付けられない） */
export function isFutureDateKey(dateKey: string, todayKey: string = todayJstDateKey()): boolean {
    return dateKey > todayKey;
}

// ---------------------------------------------------------------- 点数

/** 点数として受け付ける値か（0〜9999 の整数。減点＝マイナスは受け付けない） */
export function isValidPoints(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= EVALUATION_POINT_MIN
        && value <= EVALUATION_POINT_MAX;
}

/** 点数の履歴の1行（EvaluationPointRate を文字列の日付にしたもの） */
export interface PointRateLike {
    id: string;
    points: number;
    /** 適用開始日 'YYYY-MM-DD' */
    effectiveFrom: string;
    /** 入れた日時（ISO 文字列）。同じ適用開始日が2行あるとき、新しいほうを使うために見る */
    createdAt: string;
}

/** a のほうが「後から入れた行」なら true（入れた日時が同じなら id の大きいほう＝結果を毎回同じにするため） */
function isLaterEntry(a: PointRateLike, b: PointRateLike): boolean {
    if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
    return a.id > b.id;
}

/**
 * その日付の記録に使う点数の行を返す。
 *
 *  1. 適用開始日がその日付以前の行のうち、適用開始日がいちばん新しい行（同じ日なら後から入れた行）
 *  2. 1 が無い（その日付は、どの適用開始日よりも前）ときは、適用開始日がいちばん古い行
 *     ＝ 項目を作る前の日付の記録にも、最初の点数を使う
 *  3. 行が1つも無ければ null
 */
export function resolveRateAt(rates: readonly PointRateLike[], dateKey: string): PointRateLike | null {
    let best: PointRateLike | null = null;
    for (const r of rates) {
        if (r.effectiveFrom > dateKey) continue;
        if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && isLaterEntry(r, best))) {
            best = r;
        }
    }
    if (best) return best;

    let earliest: PointRateLike | null = null;
    for (const r of rates) {
        if (!earliest || r.effectiveFrom < earliest.effectiveFrom || (r.effectiveFrom === earliest.effectiveFrom && isLaterEntry(r, earliest))) {
            earliest = r;
        }
    }
    return earliest;
}

// ---------------------------------------------------------------- だれが何をできるか

export interface PointOperator {
    id: string;
    role: string;
}

export interface PointRecordLike {
    id: string;
    /** ポイントをもらう人 */
    userId: string;
    itemId: string;
    status: EvaluationPointStatus;
    /** 付けた人 */
    createdBy: string;
}

/**
 * その職長の班の「出勤簿入力」でポイントを扱ってよいか。
 * 管理者・マネージャーはどの班でも。職長は自分が職長の班だけ（出勤簿の保存と同じ決まり）。
 */
export function canInputForForeman(operator: PointOperator, foremanId: string): boolean {
    if (isEvaluationPointManager(operator.role)) return true;
    return canInputEvaluationPoints(operator.role) && operator.id === foremanId;
}

/**
 * 新しく付ける記録の状態。自分で自分に付けた分は「確認待ち」（付けただけでは合計に入らない）。
 * 認めるのは管理者・マネージャー（canConfirmRecord。管理者・マネージャーは自分の分も認められる）。
 */
export function statusForNewRecord(operatorId: string, targetUserId: string): EvaluationPointStatus {
    return operatorId === targetUserId ? 'pending' : 'confirmed';
}

/**
 * その記録を取り消してよいか。
 *  - 自分の分: 確認待ち（申請中）のあいだだけ、自分で取り下げられる。認められた後は自分では消せない
 *  - 他の人の分: 管理者・マネージャーはどれでも。職長は自分が付けた記録だけ
 */
export function canRemoveRecord(operator: PointOperator, record: PointRecordLike): boolean {
    if (record.userId === operator.id) {
        return record.status === 'pending' && record.createdBy === operator.id;
    }
    if (isEvaluationPointManager(operator.role)) return true;
    if (canInputEvaluationPoints(operator.role)) return record.createdBy === operator.id;
    return false;
}

/**
 * 確認待ちの記録を認めてよいか（管理者・マネージャーだけ）。
 * 管理者・マネージャーは、自分の分の確認待ちも自分で認められる（kei 決定 2026-10-05。
 * それまでは「自分の分は、ほかの管理者・マネージャーが認める」だった）。職長・作業員は、だれの分も認められない。
 */
export function canConfirmRecord(operator: PointOperator, record: PointRecordLike): boolean {
    return isEvaluationPointManager(operator.role) && record.status === 'pending';
}

// ---------------------------------------------------------------- 出勤簿入力のボタン

/** 項目のうち、判定に使う部分（EvaluationPointItem の一部） */
export interface PointItemLike {
    id: string;
    isActive: boolean;
    /** 'foreman' = 職長が出勤簿入力で付けられる / 'admin' = 管理者・マネージャーだけ */
    inputBy: string;
}

export type DayToggleDecision =
    /** 新しく付ける */
    | { action: 'add'; status: EvaluationPointStatus }
    /** 取り消す */
    | { action: 'remove'; record: PointRecordLike }
    /**
     * 何もしない。
     *  - unchanged … もうその状態になっている（すでに付いている／もう無い）
     *  - blocked   … 取り消す権限が無い
     *  - rejected  … 出勤簿入力では扱えない項目（項目が無い・管理者だけの項目・使っていない項目を新しく付けようとした）
     */
    | { action: 'none'; reason: 'unchanged' | 'blocked' | 'rejected' };

export interface DayToggleInput {
    operator: PointOperator;
    /** ポイントをもらう人 */
    targetUserId: string;
    /** true = 付ける / false = 取り消す */
    on: boolean;
    /** 押された項目。見つからなければ null */
    item: PointItemLike | null;
    /** その人・その日・その項目の、今ある記録。無ければ null */
    existing: PointRecordLike | null;
}

/**
 * 「出勤簿入力」で項目のボタンを1つ押したとき、何をするかを決める。
 * 押した1つだけを扱うので、画面が古くても、ほかの記録を巻き込んで消すことが無い。
 */
export function decideDayToggle(input: DayToggleInput): DayToggleDecision {
    const { operator, targetUserId, on, item, existing } = input;
    // 出勤簿入力で扱うのは「職長が付けられる項目」だけ
    if (!item || item.inputBy !== 'foreman') return { action: 'none', reason: 'rejected' };

    if (on) {
        if (existing) return { action: 'none', reason: 'unchanged' };
        if (!item.isActive) return { action: 'none', reason: 'rejected' };
        return { action: 'add', status: statusForNewRecord(operator.id, targetUserId) };
    }

    if (!existing) return { action: 'none', reason: 'unchanged' };
    if (!canRemoveRecord(operator, existing)) return { action: 'none', reason: 'blocked' };
    return { action: 'remove', record: existing };
}

// ---------------------------------------------------------------- 集計

export interface SummaryRecordLike {
    userId: string;
    itemId: string;
    /** 付けた時点の点数の写し */
    points: number;
    status: EvaluationPointStatus;
}

export interface PersonPointSummary {
    userId: string;
    /** 項目ごとの回数と点数（確認待ちは含めない） */
    byItem: Record<string, { count: number; points: number }>;
    totalCount: number;
    totalPoints: number;
    /** 確認待ちの件数と点数（合計には入れない） */
    pendingCount: number;
    pendingPoints: number;
}

/**
 * 記録を人ごとにまとめる。合計は「記録に写してある点数」の足し算で、点数表は見ない
 * （点数表をあとから変えても、過去の合計が変わらないようにするため）。
 */
export function summarizeRecords(records: readonly SummaryRecordLike[]): Map<string, PersonPointSummary> {
    const result = new Map<string, PersonPointSummary>();
    for (const r of records) {
        let person = result.get(r.userId);
        if (!person) {
            person = { userId: r.userId, byItem: {}, totalCount: 0, totalPoints: 0, pendingCount: 0, pendingPoints: 0 };
            result.set(r.userId, person);
        }
        if (r.status === 'pending') {
            person.pendingCount += 1;
            person.pendingPoints += r.points;
            continue;
        }
        const cell = person.byItem[r.itemId] ?? { count: 0, points: 0 };
        cell.count += 1;
        cell.points += r.points;
        person.byItem[r.itemId] = cell;
        person.totalCount += 1;
        person.totalPoints += r.points;
    }
    return result;
}
