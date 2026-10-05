/**
 * 評価ポイント: 一覧・確認・CSV の API（docs/指示書_評価ポイント.md の 6-3）の共通部品。
 *
 *  - 期間（startDate・endDate）の読み方
 *  - 人の並び（dispatchSortOrder の小さい順 → null は最後 → displayName の日本語順）
 *  - 集計（GET /summary と GET /export?type=summary は、必ず loadEvaluationPointSummary() の答えを使う
 *    ＝同じ人・同じ並び・同じ数字になる）
 *  - 記録の一覧の1行の形（GET /records・POST /records が同じ形で返す）
 *
 * 決まりごと（だれが何をできるか・合計の出し方）は lib/evaluationPoints.ts に書いてある。ここで書き直さない。
 * DB から読んだ User.role は大文字が混ざるので、人を絞るときは where にロールを書かず、読んだあとで判定関数で絞る。
 */
import { prisma } from '@/lib/prisma';
import {
    canConfirmRecord,
    canRemoveRecord,
    dateKeyToDate,
    dateToDateKey,
    isEvaluationPointEligibleRole,
    isEvaluationPointMemberRole,
    summarizeRecords,
    toEvaluationPointStatus,
    type EvaluationPointStatus,
    type PointOperator,
} from '@/lib/evaluationPoints';
// 純粋な決まりのほうだけを読む（lib/evaluationThanksServer.ts はこのファイルを読み込んでいるので、ここからは読まない）
import {
    THANKS_INPUT_BY,
    THANKS_ITEM_NAME,
    THANKS_SETTING_ID,
    THANKS_VIRTUAL_ITEM_ID,
    summarizeThanks,
} from '@/lib/evaluationThanks';

export const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- 期間

export interface Period {
    startDate: string;
    endDate: string;
    /** where の date に、そのまま渡す形（@db.Date なので「終了日の翌日より前」） */
    range: { gte: Date; lt: Date };
}

export type PeriodParseResult =
    | { ok: true; period: Period | null }
    | { ok: false; message: '入力が不正です' | '日付が不正です' };

/**
 * クエリの startDate・endDate を読む。
 *  - 2つとも無い: allowMissing なら period: null（全期間）。そうでなければ「入力が不正です」
 *  - 片方だけ: 「入力が不正です」
 *  - 形が違う・実在しない日付・開始 > 終了: 「日付が不正です」
 * 返す文言は、route が validationErrorResponse() に渡す。
 */
export function parsePeriodParams(params: URLSearchParams, allowMissing = false): PeriodParseResult {
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    if (!startDate && !endDate) {
        return allowMissing ? { ok: true, period: null } : { ok: false, message: '入力が不正です' };
    }
    if (!startDate || !endDate) return { ok: false, message: '入力が不正です' };
    const start = dateKeyToDate(startDate);
    const end = dateKeyToDate(endDate);
    if (!start || !end || startDate > endDate) return { ok: false, message: '日付が不正です' };
    return { ok: true, period: { startDate, endDate, range: { gte: start, lt: new Date(end.getTime() + DAY_MS) } } };
}

// ---------------------------------------------------------------- 人の並び

interface SortableUser {
    displayName: string;
    dispatchSortOrder: number | null;
}

/** dispatchSortOrder の小さい順（null は最後）→ displayName の日本語順 */
export function compareUsers(a: SortableUser, b: SortableUser): number {
    const ao = a.dispatchSortOrder;
    const bo = b.dispatchSortOrder;
    if (ao !== bo) {
        if (ao === null) return 1;
        if (bo === null) return -1;
        return ao - bo;
    }
    return a.displayName.localeCompare(b.displayName, 'ja');
}

/** User の行が見つからない（消された）人の記録に出す名前 */
export const UNKNOWN_USER_NAME = '（不明）';

/** 人の ID → 表示名。isActive で絞らずに引く（退職した人の記録にも名前を出すため） */
export async function loadUserNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = Array.from(new Set(userIds));
    if (ids.length === 0) return new Map();
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    return new Map(users.map((u) => [u.id, u.displayName]));
}

// ---------------------------------------------------------------- 集計

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
    /** 小文字 */
    role: string;
    byItem: Record<string, SummaryCell>;
    totalCount: number;
    totalPoints: number;
    pendingCount: number;
    pendingPoints: number;
}

export interface SummaryResponse {
    startDate: string;
    endDate: string;
    items: SummaryItem[];
    people: SummaryPerson[];
    totals: { byItem: Record<string, SummaryCell>; totalCount: number; totalPoints: number; pendingCount: number };
    eligiblePeople: { userId: string; displayName: string; role: string }[];
}

/**
 * 期間の集計（GET /summary・GET /export?type=summary の両方がこれを使う）。
 *
 *  - items  = 使用中の項目 ＋ この期間に記録のある項目（sortOrder 順）
 *  - people = 「isActive: true で worker・foreman1・foreman2 の人」＋「この期間に記録のある人（ロール・在籍を問わない）」
 *  - eligiblePeople = isActive: true で、ポイントをもらえるロールの全員（「記録を足す」で選べる人）
 *  - 数字は summarizeRecords()（確認待ちは合計に入れない）
 *
 * 「ありがとう」（lib/evaluationThanks.ts）:
 *  - 設定が「使う」、または、この期間に1件以上あるときだけ、items のいちばん後ろに仮の項目
 *    （id '__thanks__'・名前「ありがとう」・inputBy 'thanks'・isActive＝設定の「使う」）を足す。どちらでもなければ、今までと同じ応答
 *  - もらった人の byItem['__thanks__'] に回数と点数（行に写してある points の足し算。今の設定の点数は見ない）を入れ、合計にも足す
 *    （確認待ちは無い＝pendingCount・pendingPoints は変えない）
 *  - people には、この期間に「ありがとう」をもらった人も入れる（記録のある人と同じ＝ロール・在籍を問わない）
 */
export async function loadEvaluationPointSummary(period: Period): Promise<SummaryResponse> {
    const [records, itemRows, thanksRows, thanksSetting] = await Promise.all([
        prisma.evaluationPointRecord.findMany({
            where: { date: period.range },
            select: { userId: true, itemId: true, points: true, status: true },
        }),
        prisma.evaluationPointItem.findMany({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, name: true, inputBy: true, isActive: true },
        }),
        // 「ありがとう」（もらった人・行に写してある点数）。lib/evaluationThanksServer.ts は読み込まない（循環になるため）
        prisma.evaluationPointThanks.findMany({
            where: { date: period.range },
            select: { toUserId: true, points: true },
        }),
        prisma.evaluationPointThanksSetting.findUnique({
            where: { id: THANKS_SETTING_ID },
            select: { isActive: true },
        }),
    ]);

    // 「ありがとう」の設定の行が無ければ「使わない」
    const thanksActive = thanksSetting?.isActive === true;
    // 「使う」になっている、または、この期間に1件以上あるときだけ、仮の項目の列を足す
    const showThanks = thanksActive || thanksRows.length > 0;
    const thanksByUser = summarizeThanks(thanksRows);

    const recordUserIds = Array.from(new Set(records.map((r) => r.userId)));
    const recordItemIds = new Set(records.map((r) => r.itemId));
    // 記録のある人 ＋「ありがとう」をもらった人（どちらも在籍・ロールを問わない）
    const recordOrThanksUserIds = Array.from(new Set([...recordUserIds, ...thanksByUser.keys()]));

    // 在籍している人の全員（ロールは読んだあとで判定関数で絞る）＋ 記録のある人・「ありがとう」をもらった人（在籍を問わない）
    const users = await prisma.user.findMany({
        where: recordOrThanksUserIds.length > 0
            ? { OR: [{ isActive: true }, { id: { in: recordOrThanksUserIds } }] }
            : { isActive: true },
        select: { id: true, displayName: true, role: true, isActive: true, dispatchSortOrder: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const summaries = summarizeRecords(records.map((r) => ({
        userId: r.userId,
        itemId: r.itemId,
        points: r.points,
        status: toEvaluationPointStatus(r.status),
    })));

    // ---- 表の行
    const peopleIds = new Set<string>();
    for (const u of users) {
        if (u.isActive && isEvaluationPointMemberRole(u.role)) peopleIds.add(u.id);
    }
    for (const id of recordOrThanksUserIds) peopleIds.add(id);

    const peopleRows = Array.from(peopleIds).map((id) => {
        const u = userById.get(id);
        return {
            userId: id,
            displayName: u?.displayName ?? UNKNOWN_USER_NAME,
            dispatchSortOrder: u?.dispatchSortOrder ?? null,
            role: (u?.role ?? '').toLowerCase(),
        };
    }).sort(compareUsers);

    const people: SummaryPerson[] = peopleRows.map((p) => {
        const s = summaries.get(p.userId);
        // 「ありがとう」は確認待ちが無い＝全部が合計に入る（点数は行に写してある points の足し算）
        const t = thanksByUser.get(p.userId);
        return {
            userId: p.userId,
            displayName: p.displayName,
            role: p.role,
            byItem: t
                ? { ...(s ? s.byItem : {}), [THANKS_VIRTUAL_ITEM_ID]: { count: t.count, points: t.points } }
                : (s ? s.byItem : {}),
            totalCount: (s?.totalCount ?? 0) + (t?.count ?? 0),
            totalPoints: (s?.totalPoints ?? 0) + (t?.points ?? 0),
            pendingCount: s?.pendingCount ?? 0,
            pendingPoints: s?.pendingPoints ?? 0,
        };
    });

    // ---- 合計の行
    const totals: SummaryResponse['totals'] = { byItem: {}, totalCount: 0, totalPoints: 0, pendingCount: 0 };
    for (const p of people) {
        for (const [itemId, cell] of Object.entries(p.byItem)) {
            const t = totals.byItem[itemId] ?? { count: 0, points: 0 };
            t.count += cell.count;
            t.points += cell.points;
            totals.byItem[itemId] = t;
        }
        totals.totalCount += p.totalCount;
        totals.totalPoints += p.totalPoints;
        totals.pendingCount += p.pendingCount;
    }

    // ---- 「記録を足す」で選べる人
    const eligiblePeople = users
        .filter((u) => u.isActive && isEvaluationPointEligibleRole(u.role))
        .sort(compareUsers)
        .map((u) => ({ userId: u.id, displayName: u.displayName, role: u.role.toLowerCase() }));

    const items: SummaryItem[] = itemRows
        .filter((i) => i.isActive || recordItemIds.has(i.id))
        .map((i) => ({ id: i.id, name: i.name, inputBy: i.inputBy, isActive: i.isActive }));
    // 「ありがとう」は点数表の項目ではない。集計の列としてだけ、いちばん後ろに足す（付ける・直すの選択肢には出さない）
    if (showThanks) {
        items.push({ id: THANKS_VIRTUAL_ITEM_ID, name: THANKS_ITEM_NAME, inputBy: THANKS_INPUT_BY, isActive: thanksActive });
    }

    return {
        startDate: period.startDate,
        endDate: period.endDate,
        items,
        people,
        totals,
        eligiblePeople,
    };
}

// ---------------------------------------------------------------- 記録の一覧の1行

/** 記録の一覧で読む列（GET /records・POST /records・CSV の明細） */
export const RECORD_SELECT = {
    id: true,
    userId: true,
    date: true,
    itemId: true,
    itemName: true,
    points: true,
    status: true,
    source: true,
    note: true,
    createdBy: true,
    createdByName: true,
    createdAt: true,
    confirmedByName: true,
    confirmedAt: true,
} as const;

export interface RecordRowLike {
    id: string;
    userId: string;
    date: Date;
    itemId: string;
    itemName: string;
    points: number;
    status: string;
    source: string;
    note: string | null;
    createdBy: string;
    createdByName: string;
    createdAt: Date;
    confirmedByName: string | null;
    confirmedAt: Date | null;
}

export interface RecordResponse {
    id: string;
    userId: string;
    userName: string;
    date: string;
    itemId: string;
    /** 記録に写してある名前（今の項目名ではない） */
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
    /** 操作している人が、この記録を取り消せるか */
    canRemove: boolean;
    /** 操作している人が、この記録を認められるか */
    canConfirm: boolean;
}

export function toRecordResponse(row: RecordRowLike, userName: string, operator: PointOperator): RecordResponse {
    const status = toEvaluationPointStatus(row.status);
    const like = { id: row.id, userId: row.userId, itemId: row.itemId, status, createdBy: row.createdBy };
    return {
        id: row.id,
        userId: row.userId,
        userName,
        date: dateToDateKey(row.date),
        itemId: row.itemId,
        itemName: row.itemName,
        points: row.points,
        status,
        source: row.source,
        note: row.note,
        createdBy: row.createdBy,
        createdByName: row.createdByName,
        createdAt: row.createdAt.toISOString(),
        confirmedByName: row.confirmedByName,
        confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
        canRemove: canRemoveRecord(operator, like),
        canConfirm: canConfirmRecord(operator, like),
    };
}
