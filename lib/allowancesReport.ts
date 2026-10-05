/**
 * 手当: 一覧・集計・本人の表示の API の共通部品（読むだけ）。
 *
 *  - 記録の一覧の1行の形（GET /records・POST /records・PATCH /records/[id] が同じ形で返す）
 *  - 月の集計（GET /summary と GET /export?type=summary は、必ず loadAllowanceSummary() の答えを使う
 *    ＝同じ人・同じ並び・同じ数字になる）
 *  - 本人の手当（GET /me は loadMyAllowance() の答えを使う）
 *
 * 決まりごと（だれが何をできるか・合計の出し方・締め）は lib/allowances.ts に書いてある。ここで書き直さない。
 * 人の並び・名前の引き方は、評価ポイントの一覧と同じ部品（lib/evaluationPointsReport.ts）を使う。
 * DB から読んだ User.role は大文字が混ざるので、人を絞るときは where にロールを書かず、読んだあとで判定関数で絞る。
 */
import { prisma } from '@/lib/prisma';
import { UNKNOWN_USER_NAME, compareUsers } from '@/lib/evaluationPointsReport';
import {
    buildAllowanceLines,
    canConfirmRecord,
    canEditRecordAmount,
    canRemoveRecord,
    dateToDateKey,
    isAllowanceEligibleRole,
    monthKeyOf,
    monthRangeOf,
    summarizeAllowanceRecords,
    toAllowancePayRole,
    toAllowanceStatus,
    type AllowanceLine,
    type AllowanceOperator,
    type AllowancePayRole,
    type AllowanceRoleTotals,
    type AllowanceStatus,
} from '@/lib/allowances';
import { getAllowanceSetting } from '@/lib/allowancesServer';

export { NO_STORE, UNKNOWN_USER_NAME, loadUserNames } from '@/lib/evaluationPointsReport';

/**
 * 人の並び: dispatchSortOrder の小さい順（null は最後）→ displayName の日本語順 → 人の ID 順。
 * 評価ポイントの compareUsers() に、最後の決め手（ID）を足したもの
 * （同じ並び順・同じ名前の人がいても、画面と CSV で毎回同じ並びになるようにする）。
 */
export function compareUsersStable(
    a: { userId: string; displayName: string; dispatchSortOrder: number | null },
    b: { userId: string; displayName: string; dispatchSortOrder: number | null },
): number {
    return compareUsers(a, b) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
}

// ---------------------------------------------------------------- 記録の一覧の1行

/** 記録の一覧で読む列（GET /records・POST /records・CSV の明細） */
export const ALLOWANCE_RECORD_SELECT = {
    id: true,
    userId: true,
    date: true,
    itemId: true,
    itemName: true,
    payRole: true,
    amount: true,
    status: true,
    source: true,
    note: true,
    createdBy: true,
    createdByName: true,
    createdAt: true,
    confirmedByName: true,
    confirmedAt: true,
    amountEditedAt: true,
    amountEditedBy: true,
    amountEditedByName: true,
} as const;

export interface AllowanceRecordRowLike {
    id: string;
    userId: string;
    date: Date;
    itemId: string;
    itemName: string;
    payRole: string;
    amount: number;
    status: string;
    source: string;
    note: string | null;
    createdBy: string;
    createdByName: string;
    createdAt: Date;
    confirmedByName: string | null;
    confirmedAt: Date | null;
    /** 管理者が金額を手で直した日時（null = 手で直していない） */
    amountEditedAt: Date | null;
    amountEditedBy: string | null;
    amountEditedByName: string | null;
}

export interface AllowanceRecordResponse {
    id: string;
    userId: string;
    userName: string;
    date: string;
    itemId: string;
    /** 記録に写してある名前（今の手当の名前ではない） */
    itemName: string;
    payRole: AllowancePayRole;
    /** 記録に入っている金額（円） */
    amount: number;
    status: AllowanceStatus;
    source: string;
    note: string | null;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    confirmedByName: string | null;
    confirmedAt: string | null;
    /** その日の月が締めてあるか */
    closed: boolean;
    /** 操作している人が、この記録を取り消せるか（締めた月の記録は false） */
    canRemove: boolean;
    /** 操作している人が、この記録を認められるか（締めた月の記録は false） */
    canConfirm: boolean;
    /** 管理者が金額を手で直した記録か（あとで金額の表を変えても、この金額のまま） */
    amountEdited: boolean;
    /** 金額を手で直した人の名前（手で直していなければ null） */
    amountEditedByName: string | null;
    /** 金額を手で直した日時（ISO 文字列。手で直していなければ null） */
    amountEditedAt: string | null;
    /** 操作している人が、この記録の金額を直せるか・単価に戻せるか（管理者だけ・自分の分は false・締めた月の記録は false） */
    canEditAmount: boolean;
}

/** closedMonths は、締めてある月（'YYYY-MM'）の集まり。lib/allowancesServer.ts の loadClosedMonths() で読む */
export function toAllowanceRecordResponse(
    row: AllowanceRecordRowLike,
    userName: string,
    operator: AllowanceOperator,
    closedMonths: ReadonlySet<string>,
): AllowanceRecordResponse {
    const status = toAllowanceStatus(row.status);
    const date = dateToDateKey(row.date);
    const closed = closedMonths.has(monthKeyOf(date));
    const amountEdited = row.amountEditedAt != null;
    const like = { id: row.id, userId: row.userId, itemId: row.itemId, status, createdBy: row.createdBy, amountEdited };
    return {
        id: row.id,
        userId: row.userId,
        userName,
        date,
        itemId: row.itemId,
        itemName: row.itemName,
        payRole: toAllowancePayRole(row.payRole),
        amount: row.amount,
        status,
        source: row.source,
        note: row.note,
        createdBy: row.createdBy,
        createdByName: row.createdByName,
        createdAt: row.createdAt.toISOString(),
        confirmedByName: row.confirmedByName,
        confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
        closed,
        canRemove: !closed && canRemoveRecord(operator, like),
        canConfirm: !closed && canConfirmRecord(operator, like),
        amountEdited,
        amountEditedByName: amountEdited ? row.amountEditedByName ?? null : null,
        amountEditedAt: row.amountEditedAt ? row.amountEditedAt.toISOString() : null,
        canEditAmount: !closed && canEditRecordAmount(operator, like),
    };
}

// ---------------------------------------------------------------- 月の集計

export interface AllowanceTotals extends AllowanceRoleTotals {
    totalDays: number;
    totalAmount: number;
    pendingCount: number;
    pendingAmount: number;
}

export interface AllowanceSummaryPerson extends AllowanceTotals {
    userId: string;
    displayName: string;
    /** 小文字 */
    role: string;
    /** 常用の一人親方（支払明細書の対象者）か。false = 社員（給与に付ける分） */
    isJoyo: boolean;
    /** 手当ごとの内訳（確認待ちは含めない） */
    byItem: Record<string, AllowanceRoleTotals>;
}

export interface AllowanceSummaryResponse {
    /** 'YYYY-MM' */
    month: string;
    startDate: string;
    endDate: string;
    /** 締めてあれば、締めた人と日時。締めていなければ null */
    closed: { closedByName: string; closedAt: string } | null;
    /** 使用中の手当 ＋ この月に記録のある手当（sortOrder 順） */
    items: { id: string; name: string; isActive: boolean }[];
    /** この月に記録（確定・確認待ち）のある人 */
    people: AllowanceSummaryPerson[];
    totals: AllowanceTotals;
    /** 社員（給与に付ける分）と、常用の一人親方（支払明細書に載せる分）に分けた合計 */
    totalsByKind: { employee: AllowanceTotals; joyo: AllowanceTotals };
    /** 「記録を足す」で選べる人（在籍していて、手当をもらえるロールの全員） */
    eligiblePeople: { userId: string; displayName: string; role: string; isJoyo: boolean }[];
}

const emptyTotals = (): AllowanceTotals => ({
    foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0, totalDays: 0, totalAmount: 0, pendingCount: 0, pendingAmount: 0,
});

function addTotals(target: AllowanceTotals, p: AllowanceTotals): void {
    target.foremanDays += p.foremanDays;
    target.foremanAmount += p.foremanAmount;
    target.memberDays += p.memberDays;
    target.memberAmount += p.memberAmount;
    target.totalDays += p.totalDays;
    target.totalAmount += p.totalAmount;
    target.pendingCount += p.pendingCount;
    target.pendingAmount += p.pendingAmount;
}

/**
 * 月の集計（GET /summary・GET /export?type=summary の両方がこれを使う）。月の形が違えば null。
 *
 *  - people = この月に記録のある人（ロール・在籍を問わない。記録が1件も無い人は出さない）。人の並びは compareUsersStable()
 *  - 数字は summarizeAllowanceRecords()（記録に入っている金額の足し算。確認待ちは合計に入れない）
 *  - isJoyo = 支払明細書の対象者（JoyoContractor）に登録されている人（今「使わない」になっていても true）。
 *    **今の登録で決める**（その月の時点の登録ではない）ので、あとから登録・登録の取り消しをすると、
 *    締めた月でも、社員／一人親方の分け方（totalsByKind）は変わる。人ごとの日数と金額は変わらない
 */
export async function loadAllowanceSummary(month: unknown): Promise<AllowanceSummaryResponse | null> {
    const range = monthRangeOf(month);
    if (!range) return null;
    const monthKey = monthKeyOf(range.startKey);

    const [records, itemRows, closeRow] = await Promise.all([
        prisma.allowanceRecord.findMany({
            where: { date: range.dateRange },
            select: { userId: true, itemId: true, payRole: true, amount: true, status: true },
        }),
        prisma.allowanceItem.findMany({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, name: true, isActive: true },
        }),
        prisma.allowanceMonthClose.findUnique({ where: { month: monthKey }, select: { closedByName: true, closedAt: true } }),
    ]);

    const recordUserIds = Array.from(new Set(records.map((r) => r.userId)));
    const recordItemIds = new Set(records.map((r) => r.itemId));

    // 在籍している人の全員（ロールは読んだあとで判定関数で絞る）＋ 記録のある人（在籍を問わない）
    const users = await prisma.user.findMany({
        where: recordUserIds.length > 0 ? { OR: [{ isActive: true }, { id: { in: recordUserIds } }] } : { isActive: true },
        select: { id: true, displayName: true, role: true, isActive: true, dispatchSortOrder: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    // 支払明細書の対象者かどうかは、読めた人と、記録のある人（User の行が消えていても）の両方で引く
    const joyoLookupIds = Array.from(new Set([...users.map((u) => u.id), ...recordUserIds]));
    const joyoRows = joyoLookupIds.length === 0
        ? []
        : await prisma.joyoContractor.findMany({ where: { userId: { in: joyoLookupIds } }, select: { userId: true } });
    const joyoUserIds = new Set(joyoRows.map((j) => j.userId));

    const summaries = summarizeAllowanceRecords(records.map((r) => ({
        userId: r.userId,
        itemId: r.itemId,
        payRole: toAllowancePayRole(r.payRole),
        amount: r.amount,
        status: toAllowanceStatus(r.status),
    })));

    const people: AllowanceSummaryPerson[] = recordUserIds
        .map((id) => {
            const u = userById.get(id);
            return {
                userId: id,
                displayName: u?.displayName ?? UNKNOWN_USER_NAME,
                dispatchSortOrder: u?.dispatchSortOrder ?? null,
                role: (u?.role ?? '').toLowerCase(),
            };
        })
        .sort(compareUsersStable)
        .map((p) => {
            const s = summaries.get(p.userId);
            return {
                userId: p.userId,
                displayName: p.displayName,
                role: p.role,
                isJoyo: joyoUserIds.has(p.userId),
                byItem: s ? s.byItem : {},
                foremanDays: s?.foremanDays ?? 0,
                foremanAmount: s?.foremanAmount ?? 0,
                memberDays: s?.memberDays ?? 0,
                memberAmount: s?.memberAmount ?? 0,
                totalDays: s?.totalDays ?? 0,
                totalAmount: s?.totalAmount ?? 0,
                pendingCount: s?.pendingCount ?? 0,
                pendingAmount: s?.pendingAmount ?? 0,
            };
        });

    const totals = emptyTotals();
    const totalsByKind = { employee: emptyTotals(), joyo: emptyTotals() };
    for (const p of people) {
        addTotals(totals, p);
        addTotals(p.isJoyo ? totalsByKind.joyo : totalsByKind.employee, p);
    }

    const eligiblePeople = users
        .filter((u) => u.isActive && isAllowanceEligibleRole(u.role))
        .map((u) => ({ userId: u.id, displayName: u.displayName, dispatchSortOrder: u.dispatchSortOrder, role: u.role.toLowerCase(), isJoyo: joyoUserIds.has(u.id) }))
        .sort(compareUsersStable)
        .map(({ userId, displayName, role, isJoyo }) => ({ userId, displayName, role, isJoyo }));

    return {
        month: monthKey,
        startDate: range.startKey,
        endDate: range.endKey,
        closed: closeRow ? { closedByName: closeRow.closedByName, closedAt: closeRow.closedAt.toISOString() } : null,
        items: itemRows
            .filter((i) => i.isActive || recordItemIds.has(i.id))
            .map((i) => ({ id: i.id, name: i.name, isActive: i.isActive })),
        people,
        totals,
        totalsByKind,
        eligiblePeople,
    };
}

// ---------------------------------------------------------------- 本人の手当

export interface MyAllowanceResponse {
    /** 'YYYY-MM' */
    month: string;
    startDate: string;
    endDate: string;
    /** 公開の設定の注意書き */
    notice: string | null;
    /** その月が締めてあるか（true = 金額が決まった月。false = まだ変わることがある） */
    closed: boolean;
    /** 「◯日 × 単価 ＝ ◯円」の行（確定の記録だけ） */
    lines: AllowanceLine[];
    totalDays: number;
    totalAmount: number;
    pendingCount: number;
    pendingAmount: number;
    /** 日付の新しい順。付けた人の名前・メモは入れない */
    records: { id: string; date: string; itemName: string; payRole: AllowancePayRole; amount: number; status: AllowanceStatus }[];
}

/**
 * 本人の、その月の手当（GET /me）。月の形が違えば null。
 * userId は、呼ぶ側（route）が必ずセッションから取る（クエリやボディで受け取らない）。
 * userId が空・文字列でないときは例外にする（where の userId が外れて、全員の記録を読んでしまうのを防ぐ）。
 */
export async function loadMyAllowance(userId: string, month: unknown): Promise<MyAllowanceResponse | null> {
    if (typeof userId !== 'string' || userId === '') throw new Error('loadMyAllowance: userId が空です');
    const range = monthRangeOf(month);
    if (!range) return null;
    const monthKey = monthKeyOf(range.startKey);

    const [setting, rows, closeRow] = await Promise.all([
        getAllowanceSetting(),
        prisma.allowanceRecord.findMany({
            // 本人の分だけ
            where: { userId, date: range.dateRange },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, date: true, itemId: true, itemName: true, payRole: true, amount: true, status: true },
        }),
        prisma.allowanceMonthClose.findUnique({ where: { month: monthKey }, select: { month: true } }),
    ]);

    const records = rows.map((r) => ({
        id: r.id,
        date: dateToDateKey(r.date),
        itemId: r.itemId,
        itemName: r.itemName,
        payRole: toAllowancePayRole(r.payRole),
        amount: r.amount,
        status: toAllowanceStatus(r.status),
    }));
    const summary = summarizeAllowanceRecords(records.map((r) => ({ userId, itemId: r.itemId, payRole: r.payRole, amount: r.amount, status: r.status }))).get(userId);

    return {
        month: monthKey,
        startDate: range.startKey,
        endDate: range.endKey,
        notice: setting.memberNotice,
        closed: !!closeRow,
        lines: buildAllowanceLines(records),
        totalDays: summary?.totalDays ?? 0,
        totalAmount: summary?.totalAmount ?? 0,
        pendingCount: summary?.pendingCount ?? 0,
        pendingAmount: summary?.pendingAmount ?? 0,
        // 画面には日付の新しい順で出す
        records: records
            .map((r) => ({ id: r.id, date: r.date, itemName: r.itemName, payRole: r.payRole, amount: r.amount, status: r.status }))
            .reverse(),
    };
}
