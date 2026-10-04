/**
 * 手当: DB を読む・書く側の共通部品（API の route から呼ぶ）。
 *
 * 決まりごと（だれが何をできるか・どの金額を使うか・締めた月に何ができるか）は lib/allowances.ts に書いてある。
 * ここには、Prisma で「決まりごとの関数に渡す材料」を読む関数と、記録を書く関数を置く。
 *
 * 書く関数（足す・取り消す・認める・締める・締めを外す・金額を変える・予約を取り消す）は、どれも同じ形にしてある:
 *   トランザクションを開く → 手当の書き込みの鍵を取る（lockAllowanceWrites）→ 締めてあるかを読む → 書く → 同じトランザクションで履歴を書く
 * 鍵を取ってから締めを読むので、「締めるのと同時に記録が入る」ことが無い（1つずつ順番に行われる）。
 * route からは、記録・締め・金額の表（allowanceRecord・allowanceMonthClose・allowanceRate）を直接書かず、必ずここの関数を通すこと。
 *
 * 「班のメンバー」（getAttendanceMembers）と「操作している人」（actorOf）は、評価ポイントと同じ部品を使う
 * （出勤簿入力に並ぶ人の決まりを、2か所に書かないため）。
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeConstructionContent } from '@/lib/constructionContent';
import { parseJsonField } from '@/lib/api/utils';
import type { PointActor } from '@/lib/evaluationPointsServer';
import {
    amountOf,
    buildExpectedEntries,
    canConfirmRecord,
    canRemoveRecord,
    checkCanAddRate,
    checkCanCloseMonth,
    dateKeyToDate,
    dateToDateKey,
    decideAllowanceToggle,
    diffExpectedAndRecords,
    entryKey,
    findRecordsToReprice,
    isAllowanceEligibleRole,
    isAllowanceManager,
    isAllowanceMemberRole,
    isFutureDateKey,
    jstDateKeyOfInstant,
    monthKeyOf,
    monthRangeOf,
    resolveAllowanceRateAt,
    statusForNewRecord,
    toAllowancePayRole,
    toAllowanceStatus,
    todayJstDateKey,
    type AllowancePayRole,
    type AllowanceRateLike,
    type AllowanceRecordLike,
    type AllowanceSource,
    type AllowanceStatus,
    type CrosscheckAssignment,
    type CrosscheckDiff,
    type ExpectedEntry,
    type UnworkedEntry,
} from '@/lib/allowances';

export { actorOf, getAttendanceMembers, type AttendanceMember } from '@/lib/evaluationPointsServer';

/** 操作している人（id・role・名前の写し）。actorOf(session) が返す形 */
export type AllowanceActor = PointActor;

/** 読むだけの関数は、トランザクションの中（tx）からも外（prisma）からも呼べるようにする */
type Db = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- 書き込みの鍵・締め

/**
 * 手当の書き込みを、1つずつ順番に行わせる鍵（トランザクションが終わると自動で外れる）。
 * 請求書の採番（lib/billing/createInvoiceWithRetry.ts）・過去データ取込（lib/backfill/engine.ts）と同じやり方。
 * 手当の表に書くトランザクションは、どれも、最初にこれを呼ぶ
 * （記録を足す・取り消す・認める・月を締める・締めを外す・金額を変える・予約を取り消す・手当や公開の設定を直す）。
 */
export async function lockAllowanceWrites(tx: Db): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dandolink-allowance'))`;
}

/**
 * 手当の書き込みのトランザクションの設定（prisma.$transaction の2つめの引数）。
 * 鍵が空くのを待つ時間もトランザクションの時間に入るので、Prisma の既定（5秒）より長くする。
 */
export const ALLOWANCE_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** 渡した月（'YYYY-MM'）のうち、締めてある月を返す */
export async function loadClosedMonths(db: Db, months: readonly string[]): Promise<Set<string>> {
    const unique = Array.from(new Set(months));
    if (unique.length === 0) return new Set();
    const rows = await db.allowanceMonthClose.findMany({ where: { month: { in: unique } }, select: { month: true } });
    return new Set(rows.map((r) => r.month));
}

/** その月が締めてあるか（画面に出すために読むとき用。書く前の確かめは、鍵を取ったあとで loadClosedMonths を使う） */
export async function isAllowanceMonthClosed(month: string): Promise<boolean> {
    return (await loadClosedMonths(prisma, [month])).has(month);
}

// ---------------------------------------------------------------- 金額の履歴

/**
 * 手当ごとの金額の履歴を返す。
 * effectiveFrom は 'YYYY-MM-DD'、createdAt は ISO 文字列にしてあるので、resolveAllowanceRateAt() にそのまま渡せる。
 * 金額の行が無い手当は、空の配列で入れる。
 */
export async function loadAllowanceRatesByItemId(itemIds: readonly string[], db: Db = prisma): Promise<Map<string, AllowanceRateLike[]>> {
    const result = new Map<string, AllowanceRateLike[]>();
    for (const itemId of itemIds) result.set(itemId, []);
    if (result.size === 0) return result;

    const rows = await db.allowanceRate.findMany({
        where: { itemId: { in: Array.from(result.keys()) } },
        select: { id: true, itemId: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdAt: true },
    });
    for (const row of rows) {
        result.get(row.itemId)?.push({
            id: row.id,
            foremanAmount: row.foremanAmount,
            memberAmount: row.memberAmount,
            effectiveFrom: dateToDateKey(row.effectiveFrom),
            createdAt: row.createdAt.toISOString(),
        });
    }
    return result;
}

// ---------------------------------------------------------------- 手配を読む

/** 手配の行のうち、手当の判定に使う列 */
const ASSIGNMENT_SELECT = {
    assignedEmployeeId: true,
    date: true,
    confirmedWorkerIds: true,
    projectMasterId: true,
    projectMaster: { select: { title: true, constructionContent: true } },
} as const;

type AssignmentRow = Prisma.ProjectAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;

/**
 * 手配の行 → 判定に使う形（lib/allowances.ts の CrosscheckAssignment）。
 *  - 日付: ProjectAssignment.date は「JST 0時 = UTC 前日15時」で入っている（時刻つき）。日本時間の日付にする
 *  - 手配確定のメンバー: confirmedWorkerIds は JSON の文字列。配列でない値・文字列でない中身・空の ID は捨てる
 *  - 工事内容: normalizeConstructionContent() にかけた名前（未設定は null）
 */
function toCrosscheckAssignment(row: AssignmentRow): CrosscheckAssignment {
    const parsed: unknown = parseJsonField<unknown>(row.confirmedWorkerIds, []);
    return {
        foremanId: row.assignedEmployeeId,
        dateKey: jstDateKeyOfInstant(row.date),
        workerIds: Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id !== '') : [],
        content: normalizeConstructionContent(row.projectMaster?.constructionContent),
    };
}

/**
 * その日（日本時間）の手配を、全部の職長ぶん返す（「出勤簿入力」のボタンを、だれに・どの区分で出すかを決めるのに使う）。
 * 手配の取り方は getAttendanceMembers()（＝「出勤簿入力」に並ぶ人の決まり）と同じ: 日本時間のその日にある、isBackfilled: false の配置。
 * ほかの職長の手配も読むのは、「自分の班（対象の現場）の職長でもある人」を、どの画面でも職長の金額にするため。
 */
export async function loadDayAssignments(dateKey: string): Promise<CrosscheckAssignment[]> {
    if (!dateKeyToDate(dateKey)) throw new Error(`loadDayAssignments: 日付の形が違います: ${String(dateKey)}`);
    // JST 0時（時を -9 にして Date.UTC に渡す）から24時間で取る
    const [y, m, d] = dateKey.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, -9, 0, 0, 0));
    const end = new Date(start.getTime() + DAY_MS);

    const rows = await prisma.projectAssignment.findMany({
        where: { date: { gte: start, lt: end }, isBackfilled: false },
        select: ASSIGNMENT_SELECT,
    });
    return rows.map(toCrosscheckAssignment);
}

// ---------------------------------------------------------------- 公開の設定

/** 公開の設定の行の id（1行だけ。マイグレーションで初期行を入れてある） */
export const ALLOWANCE_SETTING_ID = 'default';

export interface AllowanceSettingValue {
    /** true = 本人（職長・作業員）に、自分の手当の日数と金額を見せる */
    showToMembers: boolean;
    /** 本人の画面の上に出す注意書き */
    memberNotice: string | null;
}

/** 公開の設定を返す。行が無ければ「見せない・注意書きなし」（無くても本人に見えてしまう側には倒さない） */
export async function getAllowanceSetting(): Promise<AllowanceSettingValue> {
    const row = await prisma.allowanceSetting.findUnique({
        where: { id: ALLOWANCE_SETTING_ID },
        select: { showToMembers: true, memberNotice: true },
    });
    if (!row) return { showToMembers: false, memberNotice: null };
    return { showToMembers: row.showToMembers === true, memberNotice: row.memberNotice ?? null };
}

/**
 * 「手当」の画面をどう見せるか。
 *   'manager' = 全員の一覧（admin・manager）
 *   'member'  = 自分の手当だけ（worker・foreman1・foreman2 で、公開の設定がオンのとき）
 *   'none'    = 見せない（それ以外）
 */
export type AllowanceAccessMode = 'manager' | 'member' | 'none';

/** ロールから見せ方を決める。公開の設定を読むのは、職長・作業員のときだけ */
export async function resolveAllowanceAccessMode(role: string | null | undefined): Promise<AllowanceAccessMode> {
    if (isAllowanceManager(role)) return 'manager';
    if (!isAllowanceMemberRole(role)) return 'none';
    const setting = await getAllowanceSetting();
    return setting.showToMembers ? 'member' : 'none';
}

// ---------------------------------------------------------------- 記録を足す

/** DB の行 → lib/allowances.ts の AllowanceRecordLike。status は必ず toAllowanceStatus() を通す */
function toRecordLike(row: { id: string; userId: string; itemId: string; status: string; createdBy: string }): AllowanceRecordLike {
    return { id: row.id, userId: row.userId, itemId: row.itemId, status: toAllowanceStatus(row.status), createdBy: row.createdBy };
}

export interface AllowanceItemRef {
    id: string;
    /** 記録に写す名前（今の手当の名前） */
    name: string;
}

export interface NewAllowanceEntry {
    userId: string;
    /** 'YYYY-MM-DD' */
    dateKey: string;
    payRole: AllowancePayRole;
}

/** 入った記録の1行（createManyAndReturn が返す、全部の列） */
export type AllowanceRecordRow = Prisma.AllowanceRecordGetPayload<Record<string, never>>;

export interface AddAllowanceResult {
    /** 実際に入った行 */
    added: AllowanceRecordRow[];
    /** 締めた月の日付だったので、入れなかった件数 */
    closedCount: number;
    /** その日付に有効な金額が無くて（手当が始まる前の日付・金額の行が1つも無い）、入れなかった件数 */
    noRateCount: number;
    /** すでに記録があって、入らなかった件数 */
    duplicateCount: number;
}

export interface AddAllowanceParams {
    actor: AllowanceActor;
    item: AllowanceItemRef;
    entries: readonly NewAllowanceEntry[];
    source: AllowanceSource;
    /** 出勤簿入力から付けたときの、その班の職長 */
    foremanId?: string | null;
    note?: string | null;
}

/** 記録を足した履歴の1行（入った行ごとに1行） */
function addedLog(actor: AllowanceActor, record: AllowanceRecordRow): Prisma.AllowanceLogCreateManyInput {
    return {
        action: 'record_added',
        actorId: actor.id,
        actorName: actor.name,
        targetUserId: record.userId,
        itemId: record.itemId,
        recordId: record.id,
        recordDate: record.date,
        detail: { itemName: record.itemName, payRole: record.payRole, amount: record.amount, status: record.status, source: record.source },
    };
}

/**
 * トランザクションの中で、記録を入れる（鍵は、呼ぶ側が先に取っておく）。
 *  - 締めた月の日付は入れない（closedCount に数える）
 *  - 金額は「記録の日付に有効な金額」（保存した日ではなく、現場に入った日で決める）の、職長／職長以外のほう。
 *    その日付に有効な金額が無い（手当が始まる前の日付・金額の行が1つも無い）分は入れない（noRateCount に数える）
 *  - 自分に付ける分は確認待ち
 *  - 同じ人・同じ日・同じ手当がすでにあれば入らない（skipDuplicates。duplicateCount に数える）
 *  - 履歴は、実際に入った行だけ
 */
async function insertAllowanceRecords(tx: Db, params: AddAllowanceParams): Promise<AddAllowanceResult> {
    const { actor, item, source } = params;

    // 同じ人・同じ日が2回入っていたら、最初の1つだけにする
    const unique = new Map<string, NewAllowanceEntry>();
    for (const e of params.entries) {
        const key = entryKey(e.userId, e.dateKey);
        if (!unique.has(key)) unique.set(key, e);
    }
    const entries = Array.from(unique.values());

    const closed = await loadClosedMonths(tx, entries.map((e) => monthKeyOf(e.dateKey)));
    const open = entries.filter((e) => !closed.has(monthKeyOf(e.dateKey)));
    const closedCount = entries.length - open.length;
    if (open.length === 0) return { added: [], closedCount, noRateCount: 0, duplicateCount: 0 };

    const rates = (await loadAllowanceRatesByItemId([item.id], tx)).get(item.id) ?? [];
    const data: Prisma.AllowanceRecordCreateManyInput[] = [];
    let noRateCount = 0;
    for (const e of open) {
        const day = dateKeyToDate(e.dateKey);
        if (!day) throw new Error(`insertAllowanceRecords: 日付の形が違います: ${String(e.dateKey)}`);
        const rate = resolveAllowanceRateAt(rates, e.dateKey);
        if (!rate) {
            noRateCount += 1;
            continue;
        }
        data.push({
            userId: e.userId,
            date: day,
            itemId: item.id,
            itemName: item.name,
            payRole: e.payRole,
            amount: amountOf(rate, e.payRole),
            rateId: rate.id,
            status: statusForNewRecord(actor.id, e.userId),
            source,
            foremanId: params.foremanId ?? null,
            note: params.note ?? null,
            createdBy: actor.id,
            createdByName: actor.name,
        });
    }

    if (data.length === 0) return { added: [], closedCount, noRateCount, duplicateCount: 0 };

    // createManyAndReturn が返すのは「実際に入った行」だけ
    const added = await tx.allowanceRecord.createManyAndReturn({ data, skipDuplicates: true });
    if (added.length > 0) {
        await tx.allowanceLog.createMany({ data: added.map((r) => addedLog(actor, r)) });
    }
    return { added, closedCount, noRateCount, duplicateCount: data.length - added.length };
}

/**
 * 記録を足す（「記録を足す」の1件・「手配と見比べる」からのまとめて、のどちらも）。
 * 対象の人・手当・日付が付けてよいものかは、呼ぶ側（route）が先に確かめる。ここでは、締めと重なりだけを見る。
 */
export async function addAllowanceRecords(params: AddAllowanceParams): Promise<AddAllowanceResult> {
    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        return insertAllowanceRecords(tx, params);
    }, ALLOWANCE_TX_OPTIONS);
}

// ---------------------------------------------------------------- 出勤簿入力のボタン

/**
 *  - added・removed … 付けた・取り消した
 *  - unchanged … もうその状態になっている
 *  - closed … その月は締めてある ／ blocked … 取り消す権限が無い
 *  - not_found … その手当が無い ／ inactive … 「使わない」になっている ／ not_target … 対象の現場の手配に入っていない
 *  - no_rate … その日付に有効な金額が無い（手当が始まる前の日付）
 */
export type AllowanceToggleResult = 'added' | 'removed' | 'unchanged' | 'closed' | 'blocked' | 'not_found' | 'inactive' | 'not_target' | 'no_rate';

export interface ToggleAllowanceParams {
    actor: AllowanceActor;
    /** 「出勤簿入力」で選んでいる職長 */
    foremanId: string;
    /** 'YYYY-MM-DD'（形は、呼ぶ側が先に確かめる） */
    dateKey: string;
    /** 手当をもらう人 */
    targetUserId: string;
    /** true = 付ける / false = 取り消す */
    on: boolean;
    /** 押された手当。見つからなければ null */
    item: (AllowanceItemRef & { isActive: boolean }) | null;
    /**
     * その人に、その画面（その職長の班）で付けるときの区分（lib/allowances.ts の dayOffersForCrew() の答え）。
     * その人が、その日、その班の対象の現場の手配に入っていなければ null（取り消すときは見ないので null でよい）
     */
    targetPayRole: AllowancePayRole | null;
}

/** 取り消した記録の写し（履歴に残す。日付・日時は文字にする） */
function removedDetail(record: AllowanceRecordRow): Prisma.InputJsonObject {
    return {
        ...record,
        date: dateToDateKey(record.date),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        confirmedAt: record.confirmedAt ? record.confirmedAt.toISOString() : null,
    };
}

/** トランザクションの中で、記録を1件消して履歴を書く。消えたら true（読んだあとで状態が変わっていたら消さない） */
async function deleteAllowanceRecord(tx: Db, actor: AllowanceActor, existing: AllowanceRecordRow): Promise<boolean> {
    // 条件に「読んだときの status」も入れる（鍵を取っているので起きないはずだが、評価ポイントと同じ守りを残す）
    const deleted = await tx.allowanceRecord.deleteMany({ where: { id: existing.id, status: existing.status } });
    if (deleted.count !== 1) return false;
    await tx.allowanceLog.create({
        data: {
            action: 'record_removed',
            actorId: actor.id,
            actorName: actor.name,
            targetUserId: existing.userId,
            itemId: existing.itemId,
            recordId: existing.id,
            recordDate: existing.date,
            detail: removedDetail(existing),
        },
    });
    return true;
}

/**
 * 「出勤簿入力」で手当のボタンを1つ押したときの保存。何をするかは decideAllowanceToggle() が決める。
 * 班のメンバーか・対象のロールか・その職長の班を扱えるかは、呼ぶ側（route）が先に確かめる。
 */
export async function toggleAllowanceForDay(params: ToggleAllowanceParams): Promise<AllowanceToggleResult> {
    const { actor, foremanId, dateKey, targetUserId, on, item, targetPayRole } = params;
    const day = dateKeyToDate(dateKey);
    if (!day) throw new Error(`toggleAllowanceForDay: 日付の形が違います: ${String(dateKey)}`);

    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        const monthClosed = (await loadClosedMonths(tx, [monthKeyOf(dateKey)])).size > 0;
        // 記録は、取り消したときに履歴へ全部の列を写すので、列を絞らずに読む
        const existing = item
            ? await tx.allowanceRecord.findFirst({ where: { userId: targetUserId, date: day, itemId: item.id } })
            : null;

        const decision = decideAllowanceToggle({
            operator: actor,
            on,
            item: item ? { id: item.id, isActive: item.isActive } : null,
            targetPayRole,
            monthClosed,
            existing: existing ? toRecordLike(existing) : null,
        });

        if (decision.action === 'add') {
            // 'add' のとき item は必ずある
            if (!item) throw new Error('付ける手当が読めていません');
            const result = await insertAllowanceRecords(tx, {
                actor,
                item,
                entries: [{ userId: targetUserId, dateKey, payRole: decision.payRole }],
                source: 'attendance',
                foremanId,
            });
            if (result.noRateCount > 0) return 'no_rate';
            return result.added.length === 1 ? 'added' : 'unchanged';
        }
        if (decision.action === 'remove') {
            // decideAllowanceToggle が 'remove' を返すのは、今の記録があるときだけ
            if (!existing) throw new Error('取り消す記録が読めていません');
            return (await deleteAllowanceRecord(tx, actor, existing)) ? 'removed' : 'unchanged';
        }
        return decision.reason;
    }, ALLOWANCE_TX_OPTIONS);
}

// ---------------------------------------------------------------- 記録を取り消す・認める（「手当」の画面）

/**
 *  - removed   … 取り消した
 *  - not_found … その記録は無い
 *  - closed    … その月は締めてある
 *  - forbidden … 取り消す権限が無い（確定した自分の分 など）
 *  - changed   … 読んだあとで状態が変わっていた
 */
export type RemoveAllowanceResult = 'removed' | 'not_found' | 'closed' | 'forbidden' | 'changed';

/** 記録を1件取り消す。取り消してよいかは canRemoveRecord() で決める */
export async function removeAllowanceRecord(actor: AllowanceActor, recordId: string): Promise<RemoveAllowanceResult> {
    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        const existing = await tx.allowanceRecord.findUnique({ where: { id: recordId } });
        if (!existing) return 'not_found';
        const closed = await loadClosedMonths(tx, [monthKeyOf(dateToDateKey(existing.date))]);
        if (closed.size > 0) return 'closed';
        if (!canRemoveRecord(actor, toRecordLike(existing))) return 'forbidden';
        return (await deleteAllowanceRecord(tx, actor, existing)) ? 'removed' : 'changed';
    }, ALLOWANCE_TX_OPTIONS);
}

/**
 * 確認待ちの記録を認める。認めてよいかは canConfirmRecord() で決める（自分の分・確定済みは除く）。
 * 締めた月の記録は認めない。返すのは、実際に認めた件数と、認めなかった件数（無い ID も含む）。
 */
export async function confirmAllowanceRecords(actor: AllowanceActor, ids: readonly string[]): Promise<{ confirmed: number; skipped: number }> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return { confirmed: 0, skipped: 0 };

    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        const rows = await tx.allowanceRecord.findMany({
            where: { id: { in: unique } },
            select: { id: true, userId: true, date: true, itemId: true, itemName: true, payRole: true, amount: true, status: true, createdBy: true },
        });
        const closed = await loadClosedMonths(tx, rows.map((r) => monthKeyOf(dateToDateKey(r.date))));
        const targets = rows.filter((r) => canConfirmRecord(actor, toRecordLike(r)) && !closed.has(monthKeyOf(dateToDateKey(r.date))));

        if (targets.length === 0) return { confirmed: 0, skipped: unique.length };

        // まとめて1回で認める（鍵を取っているので、読んだあとで状態が変わることは無い。件数が合わなければ、全部を取りやめる）
        const updated = await tx.allowanceRecord.updateMany({
            where: { id: { in: targets.map((r) => r.id) }, status: 'pending' },
            data: { status: 'confirmed', confirmedBy: actor.id, confirmedByName: actor.name, confirmedAt: new Date() },
        });
        if (updated.count !== targets.length) {
            throw new Error(`confirmAllowanceRecords: 認めた件数が合いません（${updated.count} / ${targets.length}）`);
        }
        // 履歴は、認めた記録1件につき1行
        await tx.allowanceLog.createMany({
            data: targets.map((r) => ({
                action: 'record_confirmed',
                actorId: actor.id,
                actorName: actor.name,
                targetUserId: r.userId,
                itemId: r.itemId,
                recordId: r.id,
                recordDate: r.date,
                detail: { itemName: r.itemName, payRole: r.payRole, amount: r.amount },
            })),
        });
        return { confirmed: targets.length, skipped: unique.length - targets.length };
    }, ALLOWANCE_TX_OPTIONS);
}

// ---------------------------------------------------------------- 月を締める・締めを外す

export type CloseAllowanceMonthResult =
    | { ok: true; closedAt: Date }
    /**
     *  - invalid_month  … 'YYYY-MM' の形でない
     *  - not_ended      … まだ終わっていない月
     *  - already_closed … すでに締めてある
     *  - has_pending    … その月に確認待ちが残っている（pendingCount 件）
     */
    | { ok: false; reason: 'invalid_month' | 'not_ended' | 'already_closed' }
    | { ok: false; reason: 'has_pending'; pendingCount: number };

/**
 * 月を締める（締めた月の日付の記録は、足す・取り消す・認めるができなくなる）。
 * 締めてよいかは checkCanCloseMonth() で決める。履歴には、締めた時点の件数と金額を残す。
 */
export async function closeAllowanceMonth(actor: AllowanceActor, month: unknown, todayKey: string = todayJstDateKey()): Promise<CloseAllowanceMonthResult> {
    // 形と「終わった月か」は、DB を読む前に確かめる（確認待ちの件数は、鍵を取ってから読む）
    const pre = checkCanCloseMonth(month, 0, todayKey);
    if (!pre.ok) return { ok: false, reason: pre.reason === 'not_ended' ? 'not_ended' : 'invalid_month' };
    const range = monthRangeOf(month);
    if (!range) return { ok: false, reason: 'invalid_month' };
    const monthKey = monthKeyOf(range.startKey);

    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        const existing = await tx.allowanceMonthClose.findUnique({ where: { month: monthKey }, select: { month: true } });
        if (existing) return { ok: false, reason: 'already_closed' } as const;

        const rows = await tx.allowanceRecord.findMany({
            where: { date: range.dateRange },
            select: { userId: true, payRole: true, amount: true, status: true },
        });
        const pendingCount = rows.filter((r) => toAllowanceStatus(r.status) === 'pending').length;
        // 形と「終わった月か」は上で確かめてあるので、ここで断るのは、確認待ちが残っているときだけ
        if (!checkCanCloseMonth(monthKey, pendingCount, todayKey).ok) {
            return { ok: false, reason: 'has_pending', pendingCount } as const;
        }

        const confirmed = rows.filter((r) => toAllowanceStatus(r.status) === 'confirmed');
        const foreman = confirmed.filter((r) => toAllowancePayRole(r.payRole) === 'foreman');
        const created = await tx.allowanceMonthClose.create({
            data: { month: monthKey, closedBy: actor.id, closedByName: actor.name },
            select: { closedAt: true },
        });
        await tx.allowanceLog.create({
            data: {
                action: 'month_closed',
                actorId: actor.id,
                actorName: actor.name,
                month: monthKey,
                // 締めた時点の数字（あとで「締めたときはいくらだったか」を確かめられるように）
                detail: {
                    records: confirmed.length,
                    people: new Set(confirmed.map((r) => r.userId)).size,
                    foremanDays: foreman.length,
                    memberDays: confirmed.length - foreman.length,
                    totalAmount: confirmed.reduce((sum, r) => sum + r.amount, 0),
                },
            },
        });
        return { ok: true, closedAt: created.closedAt } as const;
    }, ALLOWANCE_TX_OPTIONS);
}

export type ReopenAllowanceMonthResult =
    | { ok: true }
    /** invalid_month … 'YYYY-MM' の形でない ／ not_closed … その月は締めていない */
    | { ok: false; reason: 'invalid_month' | 'not_closed' };

/** 締めを外す（その月の記録を、また足す・取り消す・認めることができるようになる） */
export async function reopenAllowanceMonth(actor: AllowanceActor, month: unknown): Promise<ReopenAllowanceMonthResult> {
    const range = monthRangeOf(month);
    if (!range) return { ok: false, reason: 'invalid_month' };
    const monthKey = monthKeyOf(range.startKey);

    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        const deleted = await tx.allowanceMonthClose.deleteMany({ where: { month: monthKey } });
        if (deleted.count !== 1) return { ok: false, reason: 'not_closed' } as const;
        await tx.allowanceLog.create({
            data: { action: 'month_reopened', actorId: actor.id, actorName: actor.name, month: monthKey },
        });
        return { ok: true } as const;
    }, ALLOWANCE_TX_OPTIONS);
}

// ---------------------------------------------------------------- 終わったのに締めていない月

/**
 * 終わった月（日本時間の今月より前）のうち、記録があるのに締めていない月を、古い順に返す
 * （「手当」の画面で「◯月分がまだ締められていません」を出すのに使う）。
 */
export async function loadUnclosedPastMonths(todayKey: string = todayJstDateKey()): Promise<string[]> {
    const thisMonthStart = dateKeyToDate(`${monthKeyOf(todayKey)}-01`);
    if (!thisMonthStart) throw new Error(`loadUnclosedPastMonths: 日付の形が違います: ${String(todayKey)}`);
    const [days, closedRows] = await Promise.all([
        // 記録のある日付（今月より前）。日付ごとに1行にまとめて読む
        prisma.allowanceRecord.groupBy({ by: ['date'], where: { date: { lt: thisMonthStart } } }),
        prisma.allowanceMonthClose.findMany({ select: { month: true } }),
    ]);
    const closed = new Set(closedRows.map((r) => r.month));
    const months = new Set<string>();
    for (const row of days) {
        const month = monthKeyOf(dateToDateKey(row.date));
        if (!closed.has(month)) months.add(month);
    }
    return Array.from(months).sort();
}

// ---------------------------------------------------------------- 金額を変える・予約を取り消す

/** 金額の行のうち、応答と履歴に使う列 */
const RATE_SELECT = {
    id: true,
    itemId: true,
    foremanAmount: true,
    memberAmount: true,
    effectiveFrom: true,
    createdBy: true,
    createdByName: true,
    createdAt: true,
} as const;

export type AllowanceRateRow = Prisma.AllowanceRateGetPayload<{ select: typeof RATE_SELECT }>;

/** DB の金額の行 → lib/allowances.ts の AllowanceRateLike */
export function toAllowanceRateLike(row: Pick<AllowanceRateRow, 'id' | 'foremanAmount' | 'memberAmount' | 'effectiveFrom' | 'createdAt'>): AllowanceRateLike {
    return {
        id: row.id,
        foremanAmount: row.foremanAmount,
        memberAmount: row.memberAmount,
        effectiveFrom: dateToDateKey(row.effectiveFrom),
        createdAt: row.createdAt.toISOString(),
    };
}

export interface AddAllowanceRateInput {
    foremanAmount: number;
    memberAmount: number;
    /** 適用開始日 'YYYY-MM-DD'（形と金額の範囲は、呼ぶ側が先に確かめる） */
    effectiveFromKey: string;
}

export type AddAllowanceRateResult =
    | {
        ok: true;
        rate: AllowanceRateRow;
        /** 足したあとの、その手当の金額の履歴（足した行を含む） */
        rates: AllowanceRateLike[];
        /** すでに付いていた記録のうち、金額が変わった件数（適用開始日が今日以前のときだけ、0 より大きくなりうる） */
        repriced: number;
        /** 判定に使った「今日」（日本時間。鍵を取ったあとで決めたもの） */
        todayKey: string;
    }
    /** not_found … その手当が無い */
    | { ok: false; reason: 'not_found' }
    /** before_start … 過去の日付で、手当の始まりの日（startDate）より前 */
    | { ok: false; reason: 'before_start'; startDate: string | null }
    /** closed_month … その日の月からあとに、締めた月がある（month = いちばん古い月） */
    | { ok: false; reason: 'closed_month'; month: string };

/**
 * 金額の行を足す（金額を変える）。足してよいかは checkCanAddRate() で決める。
 *
 * **適用開始日が今日以前の行を足したとき（さかのぼった変更・打ちまちがいの直し）は、同じトランザクションの中で、
 * 適用開始日からあとの記録の金額を、新しい金額の表に合わせる**（1件ごとに履歴 record_repriced を残す）。
 * 適用開始日の月からあとに締めた月があれば足せないので、締めた月の記録の金額は変わらない。
 * 適用開始日が今日より後の行（予約）は、その日からあとの記録がまだ無いので、記録は変わらない。
 *
 * 同じ適用開始日の行がすでにあるときは、足した行が必ず「あとから入れた行」になるように、入れた日時を決める
 * （同じミリ秒に入った2行のどちらが使われるかを、ID まかせにしない）。
 */
export async function addAllowanceRate(actor: AllowanceActor, itemId: string, input: AddAllowanceRateInput): Promise<AddAllowanceRateResult> {
    const { foremanAmount, memberAmount, effectiveFromKey } = input;
    const effectiveFrom = dateKeyToDate(effectiveFromKey);
    if (!effectiveFrom) throw new Error(`addAllowanceRate: 日付の形が違います: ${String(effectiveFromKey)}`);

    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        const item = await tx.allowanceItem.findUnique({ where: { id: itemId }, select: { id: true } });
        if (!item) return { ok: false, reason: 'not_found' } as const;

        // 「今日」は、鍵を取ったあとで決める（待っているあいだに日付が変わっても、正しい日で判定する）
        const todayKey = todayJstDateKey();
        const rates = (await loadAllowanceRatesByItemId([item.id], tx)).get(item.id) ?? [];
        const closedRows = await tx.allowanceMonthClose.findMany({
            where: { month: { gte: monthKeyOf(effectiveFromKey) } },
            select: { month: true },
        });
        const check = checkCanAddRate(effectiveFromKey, rates, closedRows.map((r) => r.month), todayKey);
        if (!check.ok) return check;

        // 同じ適用開始日の行より、必ずあとの日時にする
        let createdAtMs = Date.now();
        for (const r of rates) {
            if (r.effectiveFrom === effectiveFromKey) createdAtMs = Math.max(createdAtMs, new Date(r.createdAt).getTime() + 1);
        }
        const rate = await tx.allowanceRate.create({
            data: {
                itemId: item.id,
                foremanAmount,
                memberAmount,
                effectiveFrom,
                createdBy: actor.id,
                createdByName: actor.name,
                createdAt: new Date(createdAtMs),
            },
            select: RATE_SELECT,
        });
        const nextRates = [...rates, toAllowanceRateLike(rate)];

        // すでに付いている記録（適用開始日からあと）を、新しい金額の表に合わせる
        const rows = await tx.allowanceRecord.findMany({
            where: { itemId: item.id, date: { gte: effectiveFrom } },
            select: { id: true, userId: true, date: true, itemName: true, payRole: true, amount: true, rateId: true },
        });
        const changes = findRecordsToReprice(
            rows.map((r) => ({ id: r.id, userId: r.userId, day: r.date, itemName: r.itemName, date: dateToDateKey(r.date), payRole: toAllowancePayRole(r.payRole), amount: r.amount, rateId: r.rateId })),
            nextRates,
        );
        // 「合わせたあとの金額・金額の行」が同じ記録を、まとめて1回で直す
        const groups = new Map<string, { amount: number; rateId: string; ids: string[] }>();
        for (const c of changes) {
            const key = `${c.amount}|${c.rateId}`;
            const group = groups.get(key) ?? { amount: c.amount, rateId: c.rateId, ids: [] };
            group.ids.push(c.record.id);
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            await tx.allowanceRecord.updateMany({ where: { id: { in: group.ids } }, data: { amount: group.amount, rateId: group.rateId } });
        }
        // 履歴は、金額が変わった記録だけ・1件につき1行（金額の行の付け替えだけの記録は数えない）
        const repricedChanges = changes.filter((c) => c.amount !== c.record.amount);

        await tx.allowanceLog.create({
            data: {
                action: 'rate_added',
                actorId: actor.id,
                actorName: actor.name,
                itemId: item.id,
                detail: { rateId: rate.id, foremanAmount: rate.foremanAmount, memberAmount: rate.memberAmount, effectiveFrom: effectiveFromKey, repriced: repricedChanges.length },
            },
        });
        if (repricedChanges.length > 0) {
            await tx.allowanceLog.createMany({
                data: repricedChanges.map((c) => ({
                    action: 'record_repriced',
                    actorId: actor.id,
                    actorName: actor.name,
                    targetUserId: c.record.userId,
                    itemId: item.id,
                    recordId: c.record.id,
                    recordDate: c.record.day,
                    detail: { itemName: c.record.itemName, payRole: c.record.payRole, before: c.record.amount, after: c.amount, rateId: c.rateId },
                })),
            });
        }
        return { ok: true, rate, rates: nextRates, repriced: repricedChanges.length, todayKey } as const;
    }, ALLOWANCE_TX_OPTIONS);
}

/**
 *  - cancelled … 取り消した
 *  - not_found … その金額の行は無い（もう取り消されている・ほかの手当の行）
 *  - started   … すでに始まっている（適用開始日が今日以前）
 */
export type CancelAllowanceRateResult = 'cancelled' | 'not_found' | 'started';

/**
 * 金額の予約（適用開始日が今日より後の行）を取り消す。始まった行は取り消せない
 * （始まった行の金額を直したいときは、同じ適用開始日で、正しい金額の行を足す＝ addAllowanceRate）。
 */
export async function cancelAllowanceRate(actor: AllowanceActor, itemId: string, rateId: string): Promise<CancelAllowanceRateResult> {
    return prisma.$transaction(async (tx) => {
        await lockAllowanceWrites(tx);
        const rate = await tx.allowanceRate.findUnique({ where: { id: rateId }, select: RATE_SELECT });
        // ほかの手当の行を、この手当の URL で消させない
        if (!rate || rate.itemId !== itemId) return 'not_found';

        // 「今日」は、鍵を取ったあとで決める（待っているあいだに日付が変わって始まった行は、消さない）
        const effectiveFromKey = dateToDateKey(rate.effectiveFrom);
        if (effectiveFromKey <= todayJstDateKey()) return 'started';

        await tx.allowanceRate.delete({ where: { id: rate.id } });
        // 取り消した行の全部の列を残す（日付は 'YYYY-MM-DD'）
        await tx.allowanceLog.create({
            data: {
                action: 'rate_cancelled',
                actorId: actor.id,
                actorName: actor.name,
                itemId: rate.itemId,
                detail: {
                    id: rate.id,
                    itemId: rate.itemId,
                    foremanAmount: rate.foremanAmount,
                    memberAmount: rate.memberAmount,
                    effectiveFrom: effectiveFromKey,
                    createdBy: rate.createdBy,
                    createdByName: rate.createdByName,
                    createdAt: rate.createdAt.toISOString(),
                },
            },
        });
        return 'cancelled';
    }, ALLOWANCE_TX_OPTIONS);
}

// ---------------------------------------------------------------- 手配と見比べる

/** 見比べるのに読む、手当の記録の列 */
const CROSSCHECK_RECORD_SELECT = {
    id: true,
    userId: true,
    date: true,
    payRole: true,
    amount: true,
    status: true,
    createdByName: true,
} as const;

export interface CrosscheckRecord {
    id: string;
    userId: string;
    /** 'YYYY-MM-DD' */
    date: string;
    payRole: AllowancePayRole;
    amount: number;
    status: AllowanceStatus;
    createdByName: string;
}

/** 対象として数えた現場（案件） */
export interface CrosscheckSite {
    projectMasterId: string;
    /** 案件の名前（ProjectMaster.title） */
    title: string;
    /** その月に、対象として数えた手配のある日数（同じ日に2つの班が入っていても1日） */
    days: number;
}

export interface AllowanceCrosscheck {
    /** 手配と出勤簿から「付くはず」の人と日（出勤簿が働いた日） */
    expected: ExpectedEntry[];
    /** 手配には入っているが、出勤簿が「働いた」になっていない日 */
    unworked: UnworkedEntry[];
    /** 手配には入っているが、手当の対象外の人（今は対象外のロール・User の行が無い人） */
    ineligible: ExpectedEntry[];
    /** 対象として数えた現場（日数の多い順。「どの現場が対象になっているか」を確かめるのに使う） */
    sites: CrosscheckSite[];
    /** その手当・その月の記録（確認待ちも含む。日付の古い順） */
    records: CrosscheckRecord[];
    diff: CrosscheckDiff<CrosscheckRecord>;
    /** 出てくる人（名前と、人の並びに使う順番）。User の行が無い人は入らない */
    users: Map<string, { displayName: string; dispatchSortOrder: number | null }>;
    /** その手当の金額の履歴（付けたときの金額を出すのに使う） */
    rates: AllowanceRateLike[];
}

export interface CrosscheckItemRef {
    id: string;
    constructionContent: string;
}

/**
 * その手当・その月について、手配と出勤簿から「付くはずの人と日」を作り、実際の記録と見比べる。
 * 月の形が違えば null。読むだけ（出勤簿・手配・案件は SELECT のみ）。
 *
 *  - 手配: 日本時間のその月にある、isBackfilled: false の配置（職長・手配確定のメンバー・案件の工事内容）。
 *          先の日付（日本時間の今日より後）の手配は見ない（まだ出勤簿が無いので、毎日「出勤していない」に並んでしまう）。
 *          その日付に有効な金額が無い日（手当が始まる前の日・金額の行が1つも無い）の手配も見ない（付けられない日なので）
 *  - 出勤簿: その月の、手配に出てくる人の区分
 *  - 人: 手当をもらえるロールかどうか（在籍かどうかは問わない＝辞めた人の、在籍中の月も数える）
 *
 * だれが・どの区分（職長／職長以外）で付くはずかは、「出勤簿入力」のボタンと同じ buildTargetRoles() で決まる。
 */
export async function loadAllowanceCrosscheck(
    item: CrosscheckItemRef,
    month: unknown,
    todayKey: string = todayJstDateKey(),
): Promise<AllowanceCrosscheck | null> {
    const range = monthRangeOf(month);
    if (!range) return null;
    const targetContent = normalizeConstructionContent(item.constructionContent);

    const [assignmentRows, recordRows, ratesByItemId] = await Promise.all([
        prisma.projectAssignment.findMany({
            where: { date: range.instantRange, isBackfilled: false },
            select: ASSIGNMENT_SELECT,
        }),
        prisma.allowanceRecord.findMany({
            where: { itemId: item.id, date: range.dateRange },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            select: CROSSCHECK_RECORD_SELECT,
        }),
        loadAllowanceRatesByItemId([item.id]),
    ]);
    const rates = ratesByItemId.get(item.id) ?? [];

    // 対象の工事内容の手配だけを残す（ほかの現場の手配は、人も出勤簿も読まない）
    const assignments: CrosscheckAssignment[] = [];
    const siteById = new Map<string, { title: string; dates: Set<string> }>();
    for (const row of assignmentRows) {
        const a = toCrosscheckAssignment(row);
        if (!targetContent || a.content !== targetContent) continue;
        if (isFutureDateKey(a.dateKey, todayKey)) continue;
        if (!resolveAllowanceRateAt(rates, a.dateKey)) continue;
        assignments.push(a);
        const site = siteById.get(row.projectMasterId) ?? { title: row.projectMaster?.title ?? '', dates: new Set<string>() };
        site.dates.add(a.dateKey);
        siteById.set(row.projectMasterId, site);
    }
    // 日数の多い順 → 名前順 → ID 順
    const sites: CrosscheckSite[] = Array.from(siteById.entries())
        .map(([projectMasterId, site]) => ({ projectMasterId, title: site.title, days: site.dates.size }))
        .sort((a, b) => b.days - a.days || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.projectMasterId < b.projectMasterId ? -1 : a.projectMasterId > b.projectMasterId ? 1 : 0));

    const records: CrosscheckRecord[] = recordRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        date: dateToDateKey(r.date),
        payRole: toAllowancePayRole(r.payRole),
        amount: r.amount,
        status: toAllowanceStatus(r.status),
        createdByName: r.createdByName,
    }));

    const assignedUserIds = new Set<string>();
    for (const a of assignments) {
        if (a.foremanId) assignedUserIds.add(a.foremanId);
        for (const id of a.workerIds) assignedUserIds.add(id);
    }
    const allUserIds = new Set<string>(assignedUserIds);
    for (const r of records) allUserIds.add(r.userId);

    const [users, attendance] = await Promise.all([
        allUserIds.size === 0
            ? []
            : prisma.user.findMany({
                where: { id: { in: Array.from(allUserIds) } },
                select: { id: true, displayName: true, role: true, dispatchSortOrder: true },
            }),
        assignedUserIds.size === 0
            ? []
            : prisma.attendanceRecord.findMany({
                where: { userId: { in: Array.from(assignedUserIds) }, date: range.dateRange },
                select: { userId: true, date: true, status: true },
            }),
    ]);
    const roleByUserId = new Map(users.map((u) => [u.id, u.role]));

    const { expected, unworked, ineligible } = buildExpectedEntries({
        targetContent: targetContent ?? '',
        assignments,
        attendanceStatusByKey: new Map(attendance.map((a) => [entryKey(a.userId, dateToDateKey(a.date)), a.status])),
        // DB の role は大文字が混ざる。判定の関数が小文字にそろえて比べる。User の行が無い人は対象外
        isEligibleUser: (userId) => isAllowanceEligibleRole(roleByUserId.get(userId)),
    });

    return {
        expected,
        unworked,
        ineligible,
        sites,
        records,
        diff: diffExpectedAndRecords(expected, unworked, records, ineligible),
        users: new Map(users.map((u) => [u.id, { displayName: u.displayName, dispatchSortOrder: u.dispatchSortOrder }])),
        rates,
    };
}
