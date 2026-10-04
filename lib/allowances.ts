/**
 * 手当（現場の手当。最初は「大規模手当」）の決まりごと（純粋関数だけ）。
 *
 * Prisma にも React にも依存しない。API・画面・テストの全部がここを使うので、
 * 「だれが何をできるか」「どの金額を使うか」「締めた月に何ができるか」の決まりは、このファイルにだけ書く。
 *
 * 評価ポイント（lib/evaluationPoints.ts）とは別の決まりとして持つ
 * （評価ポイントは試行の点数、手当は給与に付けるお金。片方を直しても、もう片方が変わらないようにする）。
 *
 * 用語:
 *  - 手当     … 手当の種類（大規模手当 など）。AllowanceItem
 *  - 金額     … 手当ごとに「適用開始日つき」で持つ。職長の金額と、職長以外の金額の2つ。AllowanceRate（追記のみ）。
 *                いちばん古い適用開始日が、その手当の「始まりの日」（それより前の日付には付けられない）
 *  - 記録     … 1人・1日・1つの手当で1行。金額と「職長／職長以外」は、付けた時点の写し。AllowanceRecord
 *                （金額は、さかのぼって金額を変えたときだけ、締めていない月の記録が新しい金額になる）
 *  - 職長     … その日、対象の現場の手配で職長になっている人。役職が職長でも、ほかの人の班に入っただけの日は「職長以外」。
 *                「出勤簿入力」と「手配と見比べる」では、どの画面で付けても同じ（手配で決まる。buildTargetRoles）。
 *                「手当」の画面の「記録を足す」（管理者・マネージャーが手で足す）だけは、選んだ区分で付く
 *  - 確認待ち … 自分で自分に付けた記録。管理者・マネージャーが認めるまで合計に入れない
 *  - 締め     … 月ごと。締めた月の日付の記録は、足す・取り消す・認めるができない
 */

/** 手当をもらえる人（社員と、常用の一人親方）のロール。協力会社・協力会社のメンバー・応援・税理士は対象外 */
export const ALLOWANCE_ELIGIBLE_ROLES: readonly string[] = ['worker', 'foreman1', 'foreman2', 'manager', 'admin'];
/** 「出勤簿入力」で手当を付けられるロール（出勤簿を入力できるロールと同じ） */
export const ALLOWANCE_INPUT_ROLES: readonly string[] = ['admin', 'manager', 'foreman1', 'foreman2'];
/** 全員の一覧を見られる・記録の追加／取り消し／確認ができるロール */
export const ALLOWANCE_MANAGER_ROLES: readonly string[] = ['admin', 'manager'];
/** 自分の手当だけを見るロール（公開の設定がオンのときだけ見える） */
export const ALLOWANCE_MEMBER_ROLES: readonly string[] = ['worker', 'foreman1', 'foreman2'];

/** 1日の金額（円）の範囲。上限は、桁の打ちまちがいを止めるためのもの */
export const ALLOWANCE_AMOUNT_MIN = 0;
export const ALLOWANCE_AMOUNT_MAX = 100000;
export const ALLOWANCE_NAME_MAX = 30;
export const ALLOWANCE_DESCRIPTION_MAX = 200;
export const ALLOWANCE_NOTE_MAX = 200;
/** 「手配と見比べる」から、1回でまとめて付けられる件数の上限（1か月ぶん＝人数×日数 を、1回で送れる大きさ） */
export const ALLOWANCE_BULK_MAX = 2000;

/** 知らせ（broadcast）の名前。「出勤簿入力」・「手当」の画面・設定のタブで同じものを使う */
export const ALLOWANCES_UPDATED_EVENT = 'allowances_updated';

/** その日付に有効な金額が無い（手当が始まる前の日付・金額の行が1つも無い）ときに、API が返す文言 */
export const ALLOWANCE_NO_RATE_MESSAGE = 'この日付には、この手当の金額が設定されていません（手当が始まる前の日付には付けられません）';
/** 締めた月の記録を変えようとしたときに、API が返す文言（締めを外せるのは管理者だけ） */
export const ALLOWANCE_CLOSED_MESSAGE = 'この月は締めてあります（管理者が締めを外すと、変えられます）';
/** 「使わない」になっている手当を付けようとしたときに、API が返す文言 */
export const ALLOWANCE_INACTIVE_MESSAGE = 'この手当は「使わない」になっています（管理者が、設定の「手当」で「使う」にすると、付けられます）';

/** 'foreman' = その日の班の職長として / 'member' = 職長以外として */
export type AllowancePayRole = 'foreman' | 'member';
export type AllowanceStatus = 'confirmed' | 'pending';
/** 'attendance' = 出勤簿入力から / 'manual' = 「記録を足す」から / 'bulk' = 「手配と見比べる」からまとめて */
export type AllowanceSource = 'attendance' | 'manual' | 'bulk';

/**
 * DB から読んだ status（ただの文字列）を、決まった2つの値にそろえる。
 * 'pending' 以外は 'confirmed' として扱う（知らない値を「確認待ち」にして合計から落とさないため）。
 */
export function toAllowanceStatus(value: string | null | undefined): AllowanceStatus {
    return value === 'pending' ? 'pending' : 'confirmed';
}

/**
 * DB から読んだ payRole（ただの文字列）を、決まった2つの値にそろえる。
 * 'foreman' 以外は 'member' として扱う（知らない値を、金額の大きいほうに数えないため）。
 */
export function toAllowancePayRole(value: string | null | undefined): AllowancePayRole {
    return value === 'foreman' ? 'foreman' : 'member';
}

/** 入力として受け付ける payRole か（'foreman' か 'member' だけ） */
export function isAllowancePayRole(value: unknown): value is AllowancePayRole {
    return value === 'foreman' || value === 'member';
}

/** DB に入っているロールは大文字が混ざるので、必ず小文字にそろえてから比べる */
const normalizeRole = (role: string | null | undefined): string => (role ?? '').toLowerCase();

export function isAllowanceEligibleRole(role: string | null | undefined): boolean {
    return ALLOWANCE_ELIGIBLE_ROLES.includes(normalizeRole(role));
}

export function canInputAllowances(role: string | null | undefined): boolean {
    return ALLOWANCE_INPUT_ROLES.includes(normalizeRole(role));
}

export function isAllowanceManager(role: string | null | undefined): boolean {
    return ALLOWANCE_MANAGER_ROLES.includes(normalizeRole(role));
}

export function isAllowanceMemberRole(role: string | null | undefined): boolean {
    return ALLOWANCE_MEMBER_ROLES.includes(normalizeRole(role));
}

/** 金額・公開の設定を直せる／月を締められる・締めを外せるか（管理者だけ。マネージャーは見るだけ） */
export function isAllowanceAdmin(role: string | null | undefined): boolean {
    return normalizeRole(role) === 'admin';
}

// ---------------------------------------------------------------- 日付

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

/**
 * 時刻つきの日時（ProjectAssignment.date ＝「JST 0時 = UTC 前日15時」で入っている）→ 日本時間の日付 'YYYY-MM-DD'。
 * そのまま toISOString() の日付を取ると、1日前になる。
 */
export function jstDateKeyOfInstant(instant: Date): string {
    return new Date(instant.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- 月

/** 'YYYY-MM' の形か（年は 2000〜2999、月は 01〜12。'0026-09' のような年は、Date が 1926年と読むので受け付けない） */
export function isValidMonthKey(value: unknown): value is string {
    return typeof value === 'string' && /^2\d{3}-(0[1-9]|1[0-2])$/.test(value);
}

/** 'YYYY-MM-DD' → その日の月 'YYYY-MM' */
export function monthKeyOf(dateKey: string): string {
    return dateKey.slice(0, 7);
}

export interface AllowanceMonthRange {
    /** 月の1日 'YYYY-MM-DD' */
    startKey: string;
    /** 月の末日 'YYYY-MM-DD' */
    endKey: string;
    /** @db.Date の列（AllowanceRecord.date・AttendanceRecord.date）を月で絞る範囲（UTC 0時の印。「翌月1日より前」） */
    dateRange: { gte: Date; lt: Date };
    /** 時刻つきの列（ProjectAssignment.date）を、日本時間の月で絞る範囲（JST 0時 = UTC 前日15時 から） */
    instantRange: { gte: Date; lt: Date };
}

/** 'YYYY-MM' → その月の範囲。形が違えば null */
export function monthRangeOf(month: unknown): AllowanceMonthRange | null {
    if (!isValidMonthKey(month)) return null;
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const next = new Date(Date.UTC(y, m, 1));
    return {
        startKey: dateToDateKey(start),
        endKey: dateToDateKey(new Date(next.getTime() - DAY_MS)),
        dateRange: { gte: start, lt: next },
        instantRange: { gte: new Date(start.getTime() - JST_OFFSET_MS), lt: new Date(next.getTime() - JST_OFFSET_MS) },
    };
}

/** その月が、もう終わっているか（日本時間の今日の月より前の月か）。締められるのは、終わった月だけ */
export function isMonthEnded(month: string, todayKey: string = todayJstDateKey()): boolean {
    return month < monthKeyOf(todayKey);
}

// ---------------------------------------------------------------- 金額

/** 金額として受け付ける値か（0〜100000 の整数） */
export function isValidAmount(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= ALLOWANCE_AMOUNT_MIN
        && value <= ALLOWANCE_AMOUNT_MAX;
}

/** 金額の履歴の1行（AllowanceRate を文字列の日付にしたもの） */
export interface AllowanceRateLike {
    id: string;
    foremanAmount: number;
    memberAmount: number;
    /** 適用開始日 'YYYY-MM-DD' */
    effectiveFrom: string;
    /** 入れた日時（ISO 文字列）。同じ適用開始日が2行あるとき、新しいほうを使うために見る */
    createdAt: string;
}

/** a のほうが「後から入れた行」なら true（入れた日時が同じなら id の大きいほう＝結果を毎回同じにするため） */
function isLaterEntry(a: AllowanceRateLike, b: AllowanceRateLike): boolean {
    if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
    return a.id > b.id;
}

/**
 * その日付の記録に使う金額の行を返す。
 *
 *  1. 適用開始日がその日付以前の行のうち、適用開始日がいちばん新しい行（同じ日なら後から入れた行）
 *  2. 1 が無い（その日付は、どの適用開始日よりも前。または、行が1つも無い）ときは null
 *     ＝ **いちばん古い適用開始日が、その手当の始まりの日。それより前の日付には付けられない**
 *     （評価ポイントの点数は「最初の点数を前の日付にも使う」が、手当はお金なので、始まる前の月には付けさせない）
 */
export function resolveAllowanceRateAt(rates: readonly AllowanceRateLike[], dateKey: string): AllowanceRateLike | null {
    let best: AllowanceRateLike | null = null;
    for (const r of rates) {
        if (r.effectiveFrom > dateKey) continue;
        if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && isLaterEntry(r, best))) {
            best = r;
        }
    }
    return best;
}

/** その手当の始まりの日（いちばん古い適用開始日）'YYYY-MM-DD'。金額の行が1つも無ければ null */
export function allowanceStartDateKey(rates: readonly AllowanceRateLike[]): string | null {
    let start: string | null = null;
    for (const r of rates) {
        if (start === null || r.effectiveFrom < start) start = r.effectiveFrom;
    }
    return start;
}

/** その金額の行で、職長／職長以外がもらう1日の金額 */
export function amountOf(rate: Pick<AllowanceRateLike, 'foremanAmount' | 'memberAmount'>, payRole: AllowancePayRole): number {
    return payRole === 'foreman' ? rate.foremanAmount : rate.memberAmount;
}

/** upcoming = 予約（適用開始日が今日より後）／ current = 今日の記録に使う行 ／ past = それ以外（以前の金額・置きかえられた行） */
export type AllowanceRateState = 'upcoming' | 'current' | 'past';

/** 金額の履歴の中で、その行が今どの状態か */
export function allowanceRateStateOf(rate: AllowanceRateLike, rates: readonly AllowanceRateLike[], todayKey: string = todayJstDateKey()): AllowanceRateState {
    if (rate.effectiveFrom > todayKey) return 'upcoming';
    const current = resolveAllowanceRateAt(rates, todayKey);
    return current !== null && current.id === rate.id ? 'current' : 'past';
}

/**
 * その行が、置きかえられているか（同じ適用開始日で、あとから入れた行がある＝この行は、どの日付の記録にも使われない）。
 * 打ちまちがいを直すために、同じ適用開始日で入れ直したときの、古いほうの行がこれになる。
 */
export function isAllowanceRateReplaced(rate: AllowanceRateLike, rates: readonly AllowanceRateLike[]): boolean {
    return rates.some((other) => other.id !== rate.id && other.effectiveFrom === rate.effectiveFrom && isLaterEntry(other, rate));
}

export type AddRateCheck =
    | { ok: true }
    /** before_start … 過去の日付で、手当の始まりの日（startDate。金額の行が1つも無ければ null）より前 */
    | { ok: false; reason: 'before_start'; startDate: string | null }
    /** closed_month … その日からあとに、締めた月がある（month = その中でいちばん古い月） */
    | { ok: false; reason: 'closed_month'; month: string };

/**
 * その適用開始日で、金額の行を足してよいか。
 *
 *  - 今日（日本時間）以降の日付: 足せる（まだ始まっていない行は「予約」）
 *  - 過去の日付（さかのぼった変更・打ちまちがいの直し）: 手当の始まりの日以降のときだけ
 *    （始まりの日を前へ動かすと、手当が始まる前の月に付けられるようになってしまうので、動かさせない）
 *  - どちらも、その日の月からあとに、締めた月が1つでもあれば足せない
 *    （締めた月の記録の金額は変えない。変えるなら、先に締めを外す）
 *
 * closedMonths には、締めてある月（'YYYY-MM'）を渡す（その日の月より前の月が混ざっていてもよい）。
 */
export function checkCanAddRate(
    effectiveFromKey: string,
    rates: readonly AllowanceRateLike[],
    closedMonths: readonly string[],
    todayKey: string = todayJstDateKey(),
): AddRateCheck {
    if (effectiveFromKey < todayKey) {
        const startDate = allowanceStartDateKey(rates);
        if (startDate === null || effectiveFromKey < startDate) return { ok: false, reason: 'before_start', startDate };
    }
    const fromMonth = monthKeyOf(effectiveFromKey);
    let firstClosed: string | null = null;
    for (const month of closedMonths) {
        if (month >= fromMonth && (firstClosed === null || month < firstClosed)) firstClosed = month;
    }
    if (firstClosed !== null) return { ok: false, reason: 'closed_month', month: firstClosed };
    return { ok: true };
}

// ---------------------------------------------------------------- だれが何をできるか

export interface AllowanceOperator {
    id: string;
    role: string;
}

export interface AllowanceRecordLike {
    id: string;
    /** 手当をもらう人 */
    userId: string;
    itemId: string;
    status: AllowanceStatus;
    /** 付けた人 */
    createdBy: string;
}

/**
 * その職長の班の「出勤簿入力」で手当を扱ってよいか。
 * 管理者・マネージャーはどの班でも。職長は自分が職長の班だけ（出勤簿の保存と同じ決まり）。
 */
export function canInputForForeman(operator: AllowanceOperator, foremanId: string): boolean {
    if (isAllowanceManager(operator.role)) return true;
    return canInputAllowances(operator.role) && operator.id === foremanId;
}

/** 新しく付ける記録の状態。自分で自分に付けた分は「確認待ち」（だれも自分の手当を自分だけでは決められない） */
export function statusForNewRecord(operatorId: string, targetUserId: string): AllowanceStatus {
    return operatorId === targetUserId ? 'pending' : 'confirmed';
}

/**
 * その記録を取り消してよいか（月が締めてあるかどうかは、ここでは見ない。呼ぶ側が別に確かめる）。
 *  - 自分の分: 確認待ち（申請中）のあいだだけ、自分で取り下げられる。認められた後は自分では消せない
 *  - 他の人の分: 管理者・マネージャーはどれでも。職長は自分が付けた記録だけ
 */
export function canRemoveRecord(operator: AllowanceOperator, record: AllowanceRecordLike): boolean {
    if (record.userId === operator.id) {
        return record.status === 'pending' && record.createdBy === operator.id;
    }
    if (isAllowanceManager(operator.role)) return true;
    if (canInputAllowances(operator.role)) return record.createdBy === operator.id;
    return false;
}

/** 確認待ちの記録を認めてよいか（管理者・マネージャーだけ。自分の分は認められない）。締めは呼ぶ側が別に確かめる */
export function canConfirmRecord(operator: AllowanceOperator, record: AllowanceRecordLike): boolean {
    return isAllowanceManager(operator.role)
        && record.status === 'pending'
        && record.userId !== operator.id;
}

// ---------------------------------------------------------------- 出勤簿入力のボタン

/** 手当のうち、判定に使う部分（AllowanceItem の一部） */
export interface AllowanceItemLike {
    id: string;
    isActive: boolean;
}

export type AllowanceToggleDecision =
    /** 新しく付ける（確定か確認待ちかは、記録を入れるときに statusForNewRecord() で決める＝決める場所を1つにする） */
    | { action: 'add'; payRole: AllowancePayRole }
    /** 取り消す */
    | { action: 'remove'; record: AllowanceRecordLike }
    /**
     * 何もしない。
     *  - unchanged  … もうその状態になっている（すでに付いている／もう無い）
     *  - closed     … その月は締めてある
     *  - blocked    … 取り消す権限が無い
     *  - not_found  … その手当が無い
     *  - inactive   … その手当は「使わない」になっている
     *  - not_target … その人は、その日、その班の「対象の現場」の手配に入っていない
     */
    | { action: 'none'; reason: 'unchanged' | 'closed' | 'blocked' | 'not_found' | 'inactive' | 'not_target' };

export interface AllowanceToggleInput {
    operator: AllowanceOperator;
    /** true = 付ける / false = 取り消す */
    on: boolean;
    /** 押された手当。見つからなければ null */
    item: AllowanceItemLike | null;
    /**
     * その人に、その画面（その職長の班）で付けるときの区分（dayOffersForCrew() の答え）。
     * その人が、その日、その班の対象の現場の手配に入っていなければ null
     */
    targetPayRole: AllowancePayRole | null;
    /** その日の月が締めてあるか */
    monthClosed: boolean;
    /** その人・その日・その手当の、今ある記録。無ければ null */
    existing: AllowanceRecordLike | null;
}

/**
 * 「出勤簿入力」で手当のボタンを1つ押したとき、何をするかを決める。
 * 押した1つだけを扱うので、画面が古くても、ほかの記録を巻き込んで消すことが無い。
 *
 * 見る順番:
 *   手当が無い → not_found
 *   付ける:     すでにある → unchanged ／ 締めてある → closed ／ 使っていない → inactive ／ 対象の現場の手配に入っていない → not_target ／ 付ける
 *   取り消す:   もう無い → unchanged ／ 締めてある → closed ／ 権限が無い → blocked ／ 取り消す
 */
export function decideAllowanceToggle(input: AllowanceToggleInput): AllowanceToggleDecision {
    const { operator, on, item, targetPayRole, monthClosed, existing } = input;
    if (!item) return { action: 'none', reason: 'not_found' };

    if (on) {
        if (existing) return { action: 'none', reason: 'unchanged' };
        if (monthClosed) return { action: 'none', reason: 'closed' };
        if (!item.isActive) return { action: 'none', reason: 'inactive' };
        if (!targetPayRole) return { action: 'none', reason: 'not_target' };
        return { action: 'add', payRole: targetPayRole };
    }

    if (!existing) return { action: 'none', reason: 'unchanged' };
    if (monthClosed) return { action: 'none', reason: 'closed' };
    if (!canRemoveRecord(operator, existing)) return { action: 'none', reason: 'blocked' };
    return { action: 'remove', record: existing };
}

// ---------------------------------------------------------------- 月の締め

export type CloseMonthCheck =
    | { ok: true }
    /**
     *  - invalid_month … 'YYYY-MM' の形でない
     *  - not_ended     … まだ終わっていない月（今月・先の月）
     *  - has_pending   … その月に確認待ちが残っている
     */
    | { ok: false; reason: 'invalid_month' | 'not_ended' | 'has_pending' };

/**
 * その月を締めてよいか。
 * 終わった月だけ・確認待ちが1件も無いときだけ（締めた月の数字が、あとから増えたり減ったりしないようにする）。
 */
export function checkCanCloseMonth(month: unknown, pendingCount: number, todayKey: string = todayJstDateKey()): CloseMonthCheck {
    if (!isValidMonthKey(month)) return { ok: false, reason: 'invalid_month' };
    if (!isMonthEnded(month, todayKey)) return { ok: false, reason: 'not_ended' };
    if (pendingCount > 0) return { ok: false, reason: 'has_pending' };
    return { ok: true };
}

// ---------------------------------------------------------------- 集計

export interface AllowanceSummaryRecordLike {
    userId: string;
    itemId: string;
    payRole: AllowancePayRole;
    /** 記録に入っている金額 */
    amount: number;
    status: AllowanceStatus;
}

export interface AllowanceRoleTotals {
    /** 職長として付いた記録の件数（1件 = 1人・1日・1つの手当）と金額 */
    foremanDays: number;
    foremanAmount: number;
    /** 職長以外として付いた記録の件数と金額 */
    memberDays: number;
    memberAmount: number;
}

export interface PersonAllowanceSummary extends AllowanceRoleTotals {
    userId: string;
    /** 手当ごとの内訳（確認待ちは含めない） */
    byItem: Record<string, AllowanceRoleTotals>;
    totalDays: number;
    totalAmount: number;
    /** 確認待ちの件数と金額（合計には入れない） */
    pendingCount: number;
    pendingAmount: number;
}

const emptyRoleTotals = (): AllowanceRoleTotals => ({ foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0 });

/**
 * 記録を人ごとにまとめる。合計は「記録に入っている金額」の足し算で、金額の表は見ない
 * （締めた月の合計が、あとから変わらないようにするため。さかのぼって金額を変えたときは、締めていない月の記録のほうを直す
 * ＝ lib/allowancesServer.ts の addAllowanceRate）。確認待ちは合計に入れない。
 */
export function summarizeAllowanceRecords(records: readonly AllowanceSummaryRecordLike[]): Map<string, PersonAllowanceSummary> {
    const result = new Map<string, PersonAllowanceSummary>();
    for (const r of records) {
        let person = result.get(r.userId);
        if (!person) {
            person = { userId: r.userId, ...emptyRoleTotals(), byItem: {}, totalDays: 0, totalAmount: 0, pendingCount: 0, pendingAmount: 0 };
            result.set(r.userId, person);
        }
        if (r.status === 'pending') {
            person.pendingCount += 1;
            person.pendingAmount += r.amount;
            continue;
        }
        const cell = person.byItem[r.itemId] ?? emptyRoleTotals();
        if (r.payRole === 'foreman') {
            cell.foremanDays += 1;
            cell.foremanAmount += r.amount;
            person.foremanDays += 1;
            person.foremanAmount += r.amount;
        } else {
            cell.memberDays += 1;
            cell.memberAmount += r.amount;
            person.memberDays += 1;
            person.memberAmount += r.amount;
        }
        person.byItem[r.itemId] = cell;
        person.totalDays += 1;
        person.totalAmount += r.amount;
    }
    return result;
}

export interface AllowanceLineRecordLike {
    itemId: string;
    /** 記録に写してある手当の名前 */
    itemName: string;
    payRole: AllowancePayRole;
    amount: number;
    status: AllowanceStatus;
}

/** 「◯日 × 単価 ＝ ◯円」の1行 */
export interface AllowanceLine {
    itemId: string;
    itemName: string;
    payRole: AllowancePayRole;
    /** 1日の金額（記録に入っている金額） */
    amount: number;
    days: number;
    total: number;
}

/**
 * 記録を「手当・職長／職長以外・1日の金額」ごとにまとめて、「◯日 × 単価 ＝ ◯円」の行にする（確認待ちは入れない）。
 * 月の途中で金額が変わった月は、金額ごとに行が分かれる。
 * 並び: 記録に最初に出てきた手当の順 → 職長が先 → 1日の金額の大きい順。
 */
export function buildAllowanceLines(records: readonly AllowanceLineRecordLike[]): AllowanceLine[] {
    const lines = new Map<string, AllowanceLine>();
    const itemOrder = new Map<string, number>();
    for (const r of records) {
        if (r.status === 'pending') continue;
        if (!itemOrder.has(r.itemId)) itemOrder.set(r.itemId, itemOrder.size);
        const key = JSON.stringify([r.itemId, r.itemName, r.payRole, r.amount]);
        const line = lines.get(key) ?? { itemId: r.itemId, itemName: r.itemName, payRole: r.payRole, amount: r.amount, days: 0, total: 0 };
        line.days += 1;
        line.total += r.amount;
        lines.set(key, line);
    }
    return Array.from(lines.values()).sort((a, b) => {
        const ao = itemOrder.get(a.itemId) ?? 0;
        const bo = itemOrder.get(b.itemId) ?? 0;
        if (ao !== bo) return ao - bo;
        if (a.payRole !== b.payRole) return a.payRole === 'foreman' ? -1 : 1;
        if (a.amount !== b.amount) return b.amount - a.amount;
        return a.itemName < b.itemName ? -1 : a.itemName > b.itemName ? 1 : 0;
    });
}

// ---------------------------------------------------------------- 手配から「だれに・どの区分で付くか」を決める

/** 出勤簿の区分のうち、「その日に働いた」とみなすもの（出勤・夜勤・休日出勤） */
export const ALLOWANCE_WORKED_STATUSES: readonly string[] = ['present', 'night_shift', 'holiday_work'];

export function isWorkedAttendanceStatus(status: string | null | undefined): boolean {
    return typeof status === 'string' && ALLOWANCE_WORKED_STATUSES.includes(status);
}

/** 人と日付の組の鍵（「手配と見比べる」で、どの人のどの日かを指す） */
export function entryKey(userId: string, dateKey: string): string {
    return `${userId}|${dateKey}`;
}

/** 手配の1件（「出勤簿入力」のボタンと「手配と見比べる」で使う部分） */
export interface CrosscheckAssignment {
    /** その班の職長（ProjectAssignment.assignedEmployeeId） */
    foremanId: string;
    /** 日本時間の日付 'YYYY-MM-DD' */
    dateKey: string;
    /** 手配確定のメンバー（confirmedWorkerIds）。職長本人は入っていないことが多い */
    workerIds: readonly string[];
    /** その案件の工事内容（normalizeConstructionContent 済み。未設定は null） */
    content: string | null;
}

/** 手配から見た「この人は、この日、この区分で手当が付くはず」 */
export interface ExpectedEntry {
    userId: string;
    /** 'YYYY-MM-DD' */
    date: string;
    payRole: AllowancePayRole;
}

/**
 * 手配から、「対象の現場の手配に入っている人と日」と、その区分（職長／職長以外）を決める。
 * **「出勤簿入力」のボタンも「手配と見比べる」も、区分は必ずここで決める**（2つの画面で決まりが食い違わないように）。
 *
 *  1. 工事内容が対象（targetContent）の手配だけを見る
 *  2. その手配の職長 → 'foreman'、手配確定のメンバー → 'member'（メンバーの中に職長本人がいても 'foreman'）
 *  3. 同じ人・同じ日に 'foreman' と 'member' の両方があれば 'foreman'（1人・1日で1件）
 *     ＝ 自分の班（対象の現場）の職長が、同じ日にほかの班にも入っていても 'foreman'
 *
 * 返すのは entryKey(userId, dateKey) → その人・その日・その区分。
 */
export function buildTargetRoles(targetContent: string, assignments: readonly CrosscheckAssignment[]): Map<string, ExpectedEntry> {
    const roleByKey = new Map<string, ExpectedEntry>();
    const put = (userId: string, date: string, payRole: AllowancePayRole) => {
        if (!userId) return;
        const key = entryKey(userId, date);
        const current = roleByKey.get(key);
        if (!current) roleByKey.set(key, { userId, date, payRole });
        else if (payRole === 'foreman') current.payRole = 'foreman';
    };
    for (const a of assignments) {
        if (a.content !== targetContent) continue;
        put(a.foremanId, a.dateKey, 'foreman');
        for (const workerId of a.workerIds) {
            put(workerId, a.dateKey, workerId === a.foremanId ? 'foreman' : 'member');
        }
    }
    return roleByKey;
}

/**
 * 「出勤簿入力」（職長 foremanId の班の画面）で、その日、この手当を付けられる人と、その区分を返す（userId → 区分）。
 *
 *  - 付けられる人: **その職長の、対象の現場の手配**に入っている人（職長本人と、手配確定のメンバー）。
 *                  同じ日に、その職長が対象でない現場も持っていて、そちらにだけ入っている人には付けられない
 *  - 区分: その日の手配の全部（dayAssignments）から buildTargetRoles() で決める。
 *          ほかの班の画面で押しても、自分の班（対象の現場）の職長なら 'foreman'
 *
 * dayAssignments には、その日の手配を全部（ほかの職長の分も）渡す。
 */
export function dayOffersForCrew(
    targetContent: string,
    dayAssignments: readonly CrosscheckAssignment[],
    foremanId: string,
): Map<string, AllowancePayRole> {
    const roles = buildTargetRoles(targetContent, dayAssignments);
    const offers = new Map<string, AllowancePayRole>();
    for (const a of dayAssignments) {
        if (a.foremanId !== foremanId || a.content !== targetContent) continue;
        for (const userId of [a.foremanId, ...a.workerIds]) {
            const role = roles.get(entryKey(userId, a.dateKey));
            if (role) offers.set(userId, role.payRole);
        }
    }
    return offers;
}

// ---------------------------------------------------------------- 手配と見比べる

/** 手配には入っているが、出勤簿が「働いた」になっていない日 */
export interface UnworkedEntry extends ExpectedEntry {
    /** 出勤簿の区分。出勤簿が無ければ null */
    attendanceStatus: string | null;
}

export interface BuildExpectedInput {
    /** 手当の対象の工事内容（AllowanceItem.constructionContent） */
    targetContent: string;
    assignments: readonly CrosscheckAssignment[];
    /** entryKey(userId, dateKey) → 出勤簿の区分 */
    attendanceStatusByKey: ReadonlyMap<string, string>;
    /** 手当をもらえるロールの人か */
    isEligibleUser: (userId: string) => boolean;
}

const compareEntries = (a: ExpectedEntry, b: ExpectedEntry): number =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;

/**
 * 手配と出勤簿から、「手当が付くはずの人と日」を作る。
 *
 *  1. 対象の現場の手配に入っている人と日・その区分は、buildTargetRoles() で決める
 *  2. 手当をもらえるロールでない人（今は対象外のロール・User の行が無い人）→ ineligible
 *  3. 出勤簿が「働いた」（出勤・夜勤・休日出勤）の日 → expected ／ そうでない日（出勤簿が無い日も）→ unworked
 *
 * どれも、日付の古い順 → 人の ID 順。
 */
export function buildExpectedEntries(input: BuildExpectedInput): { expected: ExpectedEntry[]; unworked: UnworkedEntry[]; ineligible: ExpectedEntry[] } {
    const { targetContent, assignments, attendanceStatusByKey, isEligibleUser } = input;

    const expected: ExpectedEntry[] = [];
    const unworked: UnworkedEntry[] = [];
    const ineligible: ExpectedEntry[] = [];
    for (const entry of buildTargetRoles(targetContent, assignments).values()) {
        if (!isEligibleUser(entry.userId)) {
            ineligible.push(entry);
            continue;
        }
        const status = attendanceStatusByKey.get(entryKey(entry.userId, entry.date));
        if (isWorkedAttendanceStatus(status)) expected.push(entry);
        else unworked.push({ ...entry, attendanceStatus: status ?? null });
    }
    expected.sort(compareEntries);
    unworked.sort(compareEntries);
    ineligible.sort(compareEntries);
    return { expected, unworked, ineligible };
}

/** 見比べるのに使う、手当の記録の1件 */
export interface CrosscheckRecordLike {
    id: string;
    userId: string;
    /** 'YYYY-MM-DD' */
    date: string;
    payRole: AllowancePayRole;
}

/**
 *  - no_assignment … その日に、対象の現場への手配に入っていない
 *  - not_worked    … 手配には入っているが、出勤簿が「働いた」になっていない
 *  - not_eligible  … 手配には入っているが、今は手当の対象外の人（ロールが変わった・User の行が無い）
 */
export type CrosscheckExtraReason = 'no_assignment' | 'not_worked' | 'not_eligible';

export interface CrosscheckDiff<R extends CrosscheckRecordLike> {
    /** 手当が付くはずなのに、記録が無い（押し忘れ） */
    missing: ExpectedEntry[];
    /** 記録はあるが、手配と出勤簿からは付くはずでない（付けすぎ） */
    extra: { record: R; reason: CrosscheckExtraReason }[];
    /** 記録はあるが、職長／職長以外が手配と違う */
    mismatch: { record: R; expectedPayRole: AllowancePayRole }[];
}

/**
 * 「付くはず」（expected・unworked・ineligible）と、実際の記録（その手当・その月。確認待ちも含む）を見比べる。
 * missing は expected の順、extra・mismatch は records の順。
 */
export function diffExpectedAndRecords<R extends CrosscheckRecordLike>(
    expected: readonly ExpectedEntry[],
    unworked: readonly UnworkedEntry[],
    records: readonly R[],
    ineligible: readonly ExpectedEntry[] = [],
): CrosscheckDiff<R> {
    const expectedByKey = new Map(expected.map((e) => [entryKey(e.userId, e.date), e]));
    const unworkedKeys = new Set(unworked.map((e) => entryKey(e.userId, e.date)));
    const ineligibleKeys = new Set(ineligible.map((e) => entryKey(e.userId, e.date)));
    const recordedKeys = new Set(records.map((r) => entryKey(r.userId, r.date)));

    const diff: CrosscheckDiff<R> = { missing: [], extra: [], mismatch: [] };
    for (const e of expected) {
        if (!recordedKeys.has(entryKey(e.userId, e.date))) diff.missing.push(e);
    }
    for (const r of records) {
        const key = entryKey(r.userId, r.date);
        const e = expectedByKey.get(key);
        if (!e) {
            const reason: CrosscheckExtraReason = unworkedKeys.has(key) ? 'not_worked' : ineligibleKeys.has(key) ? 'not_eligible' : 'no_assignment';
            diff.extra.push({ record: r, reason });
        } else if (e.payRole !== r.payRole) {
            diff.mismatch.push({ record: r, expectedPayRole: e.payRole });
        }
    }
    return diff;
}

// ---------------------------------------------------------------- 金額を変えたとき

/** 金額を付け直すかどうかを見るのに使う、記録の1件 */
export interface RepriceRecordLike {
    /** 'YYYY-MM-DD' */
    date: string;
    payRole: AllowancePayRole;
    amount: number;
    /** どの金額の行から写したか */
    rateId: string | null;
}

/**
 * 記録のうち、金額の表（その日付に有効な金額の行）と合っていないものと、合わせたあとの値を返す。
 * 「金額」か「どの行から写したか（rateId）」のどちらかが違う記録が対象。その日付に有効な金額が無い記録は、対象にしない。
 * 適用開始日が過去の金額の行を足したとき（さかのぼった変更・打ちまちがいの直し）に、すでに付いている記録を合わせるのに使う。
 */
export function findRecordsToReprice<R extends RepriceRecordLike>(
    records: readonly R[],
    rates: readonly AllowanceRateLike[],
): { record: R; amount: number; rateId: string }[] {
    const result: { record: R; amount: number; rateId: string }[] = [];
    for (const record of records) {
        const rate = resolveAllowanceRateAt(rates, record.date);
        if (!rate) continue;
        const amount = amountOf(rate, record.payRole);
        if (amount !== record.amount || rate.id !== record.rateId) result.push({ record, amount, rateId: rate.id });
    }
    return result;
}
