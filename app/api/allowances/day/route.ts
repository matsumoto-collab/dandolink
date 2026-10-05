/**
 * 手当: 「出勤簿入力」用の API（docs/指示書_大規模手当.md の 6-2。共通の決まりは 6-0）。
 *
 *   GET /api/allowances/day?foremanId=<userId>&date=YYYY-MM-DD
 *       その職長・その日の班の人と、その日に出すボタン（手当）と、その日に付いている記録を返す。
 *       ボタンを出すのは、使用中の手当で、その人が「その職長の、対象の工事内容の現場の手配」に入っているときだけ。
 *   PUT /api/allowances/day   body: { foremanId, date, userId, itemId, on }
 *       ボタンを1つ押すたびに1回呼ぶ。押した1つだけを扱う（画面が古くても、ほかの記録を巻き込まない）。
 *
 * だれに・どの区分（職長／職長以外）で付けられるかは、lib/allowances.ts の dayOffersForCrew() が、その日の手配から決める
 * （「手配と見比べる」と同じ決まり。どの画面で押しても、区分は同じになる）。
 * 記録を書くのは lib/allowancesServer.ts の toggleAllowanceForDay() だけ（鍵 → 締めの確かめ → 書く → 履歴）。
 * 出勤簿のデータ（AttendanceRecord）は、読みも書きもしない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeConstructionContent } from '@/lib/constructionContent';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    ALLOWANCE_NO_RATE_MESSAGE,
    amountOf,
    canInputAllowances,
    canInputForForeman,
    canRemoveRecord,
    dateKeyToDate,
    dayOffersForCrew,
    isAllowanceEligibleRole,
    isFutureDateKey,
    monthKeyOf,
    resolveAllowanceRateAt,
    toAllowancePayRole,
    toAllowanceStatus,
    type AllowancePayRole,
    type AllowanceStatus,
    type CrosscheckAssignment,
} from '@/lib/allowances';
import {
    actorOf,
    getAttendanceMembers,
    isAllowanceMonthClosed,
    loadAllowanceRatesByItemId,
    loadDayAssignments,
    toggleAllowanceForDay,
    type AllowanceActor,
} from '@/lib/allowancesServer';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// ---------------------------------------------------------------- 応答の形

interface DayItem {
    id: string;
    name: string;
    description: string | null;
    /** その日に付けたときの金額（円）。職長と、職長以外 */
    foremanAmount: number;
    memberAmount: number;
}

interface DayRecord {
    id: string;
    itemId: string;
    /** 記録に写してある名前（今の手当の名前ではない） */
    itemName: string;
    payRole: AllowancePayRole;
    /** 記録に入っている金額（円） */
    amount: number;
    status: AllowanceStatus;
    createdBy: string;
    createdByName: string;
    /** 操作している人が、この記録を取り消せるか（締めた月の記録は false。金額を手で直した記録は、管理者・マネージャーだけ） */
    canRemove: boolean;
    /** 管理者が金額を手で直した記録か */
    amountEdited: boolean;
}

/** その人に、この画面で付けられる手当（ボタン）の1つ */
interface DayOffer {
    itemId: string;
    /** 付けたときの区分（その日の手配で決まる。どの画面で押しても同じ） */
    payRole: AllowancePayRole;
    /** 付けたときの金額（円） */
    amount: number;
}

interface DayMember {
    userId: string;
    /** 手当をもらえるロールか（協力会社のメンバーなどは false。画面はボタンを出さない） */
    eligible: boolean;
    /** この画面で、この人に付けられる手当（items と同じ順）。締めた月・対象の現場の手配に入っていない人は空 */
    offers: DayOffer[];
    records: DayRecord[];
}

/**
 * その人たちの、その日の記録を返す（userId → 記録。手当の種類は問わない＝使っていない手当の記録も返す）。
 * 1人の中の records の順番は決めていない（画面は itemId で突き合わせる）。
 */
async function loadDayRecords(
    actor: AllowanceActor,
    userIds: readonly string[],
    day: Date,
    monthClosed: boolean,
): Promise<Map<string, DayRecord[]>> {
    const rows = userIds.length === 0
        ? []
        : await prisma.allowanceRecord.findMany({
            where: { userId: { in: [...userIds] }, date: day },
            select: { id: true, userId: true, itemId: true, itemName: true, payRole: true, amount: true, status: true, createdBy: true, createdByName: true, amountEditedAt: true },
        });

    const recordsByUser = new Map<string, DayRecord[]>();
    for (const row of rows) {
        const status = toAllowanceStatus(row.status);
        const amountEdited = row.amountEditedAt != null;
        const list = recordsByUser.get(row.userId) ?? [];
        list.push({
            id: row.id,
            itemId: row.itemId,
            itemName: row.itemName,
            payRole: toAllowancePayRole(row.payRole),
            amount: row.amount,
            status,
            createdBy: row.createdBy,
            createdByName: row.createdByName,
            canRemove: !monthClosed && canRemoveRecord(actor, { id: row.id, userId: row.userId, itemId: row.itemId, status, createdBy: row.createdBy, amountEdited }),
            amountEdited,
        });
        recordsByUser.set(row.userId, list);
    }
    return recordsByUser;
}

/** その手当を、その職長の班の画面で付けられる人と区分（userId → 区分）。対象の工事内容が空の手当は、だれにも付けられない */
function offersOf(itemConstructionContent: string, dayAssignments: readonly CrosscheckAssignment[], foremanId: string): Map<string, AllowancePayRole> {
    const target = normalizeConstructionContent(itemConstructionContent);
    return target ? dayOffersForCrew(target, dayAssignments, foremanId) : new Map();
}

// ================================================================ GET

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);

        // 確かめる順番と文言は、PUT の 1〜4 と同じ
        // 1. 付けられるロールでない → 403（作業員が foremanId に自分の ID を指定しても、ここで断る）
        if (!canInputAllowances(actor.role)) return errorResponse('権限がありません', 403);

        // 2. 入力の形
        const url = new URL(req.url);
        const foremanId = url.searchParams.get('foremanId');
        const date = url.searchParams.get('date');
        if (!foremanId || !date) return validationErrorResponse('入力が不正です');

        // 3. 日付の形
        const day = dateKeyToDate(date);
        if (!day) return validationErrorResponse('日付が不正です');

        // 4. その職長の班を扱えない（職長は自分の班だけ）→ 403
        if (!canInputForForeman(actor, foremanId)) return errorResponse('他の職長の班の手当は扱えません', 403);

        // 先の日付には付けられないので、ボタンも人も空で返す（画面は何も出さない）。
        // 断るのではなく 200 で返すので、権限（4）を確かめたあとに見る
        if (isFutureDateKey(date)) {
            return NextResponse.json({ date, foremanId, monthClosed: false, items: [], members: [] }, NO_STORE);
        }

        const [members, itemRows, dayAssignments, monthClosed] = await Promise.all([
            getAttendanceMembers(foremanId, date),
            // sortOrder が同じ手当どうしは、作った順
            prisma.allowanceItem.findMany({
                where: { isActive: true },
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                select: { id: true, name: true, description: true, constructionContent: true },
            }),
            loadDayAssignments(date),
            isAllowanceMonthClosed(monthKeyOf(date)),
        ]);
        // m.role は DB の値（大文字が混ざる）。判定の関数が小文字にそろえて比べる
        const eligibleIds = new Set(members.filter((m) => isAllowanceEligibleRole(m.role)).map((m) => m.id));

        // ボタン（offers）を作る。締めた月は、新しく付けられないので出さない（付いている記録だけを返す）
        const items: DayItem[] = [];
        const offersByUser = new Map<string, DayOffer[]>();
        if (!monthClosed) {
            const ratesByItemId = await loadAllowanceRatesByItemId(itemRows.map((i) => i.id));
            for (const i of itemRows) {
                // 金額は「その日付に有効な金額」。その日付に有効な金額が無い手当（手当が始まる前の日付・金額の行が無い）は出さない
                const rate = resolveAllowanceRateAt(ratesByItemId.get(i.id) ?? [], date);
                if (!rate) continue;
                let offered = false;
                for (const [userId, payRole] of offersOf(i.constructionContent, dayAssignments, foremanId)) {
                    // 班のメンバーで、手当をもらえるロールの人だけ
                    if (!eligibleIds.has(userId)) continue;
                    const list = offersByUser.get(userId) ?? [];
                    list.push({ itemId: i.id, payRole, amount: amountOf(rate, payRole) });
                    offersByUser.set(userId, list);
                    offered = true;
                }
                // items には、この班のだれかに付けられる手当だけを入れる
                if (offered) items.push({ id: i.id, name: i.name, description: i.description, foremanAmount: amountOf(rate, 'foreman'), memberAmount: amountOf(rate, 'member') });
            }
        }

        const recordsByUser = await loadDayRecords(actor, members.map((m) => m.id), day, monthClosed);
        // members の順番は決めていない（画面は userId で突き合わせる）
        const dayMembers: DayMember[] = members.map((m) => ({
            userId: m.id,
            eligible: eligibleIds.has(m.id),
            offers: offersByUser.get(m.id) ?? [],
            records: recordsByUser.get(m.id) ?? [],
        }));

        return NextResponse.json({ date, foremanId, monthClosed, items, members: dayMembers }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の取得', err);
    }
}

// ================================================================ PUT

interface ToggleBody {
    foremanId: string;
    date: string;
    userId: string;
    itemId: string;
    on: boolean;
}

/** foremanId・date・userId・itemId が文字列で、on が boolean のときだけ、その中身を返す。違えば null */
function parseToggleBody(value: unknown): ToggleBody | null {
    if (typeof value !== 'object' || value === null) return null;
    const { foremanId, date, userId, itemId, on } = value as Record<string, unknown>;
    if (typeof foremanId !== 'string' || typeof date !== 'string' || typeof userId !== 'string' || typeof itemId !== 'string') return null;
    if (typeof on !== 'boolean') return null;
    return { foremanId, date, userId, itemId, on };
}

export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);

        // ---- 確かめる順番（合わなければ、その時点で断る。何も保存しない）
        // 形のまちがいは validationErrorResponse、決まりで断るものは errorResponse で返す

        // 1. 付けられるロールでない → 403
        //    （職長本人は必ず班に入るので、ここが抜けると、作業員が foremanId に自分を指定して自分に申請できてしまう）
        if (!canInputAllowances(actor.role)) return errorResponse('権限がありません', 403);

        // 2. 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const body = parseToggleBody(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        const { foremanId, date, userId, itemId, on } = body;

        // 3. 日付の形 → 先の日付（付けるのも取り消すのも断る）
        const day = dateKeyToDate(date);
        if (!day) return validationErrorResponse('日付が不正です');
        if (isFutureDateKey(date)) return errorResponse('先の日付には付けられません', 400);

        // 4. その職長の班を扱えない（職長は自分の班だけ）→ 403
        if (!canInputForForeman(actor, foremanId)) return errorResponse('他の職長の班の手当は扱えません', 403);

        // 5. その日の班のメンバーでない → 400 ／ 6. 手当をもらえるロールでない → 400
        const members = await getAttendanceMembers(foremanId, date);
        const member = members.find((m) => m.id === userId);
        if (!member) return errorResponse('この日の班のメンバーではありません', 400);
        if (!isAllowanceEligibleRole(member.role)) return errorResponse('手当の対象外の人です', 400);

        // ---- 手当（無ければ null）と、その人に付けるときの区分（付けるときだけ、その日の手配を読む）
        const item = await prisma.allowanceItem.findUnique({
            where: { id: itemId },
            select: { id: true, name: true, isActive: true, constructionContent: true },
        });
        const targetPayRole = on && item
            ? offersOf(item.constructionContent, await loadDayAssignments(date), foremanId).get(userId) ?? null
            : null;

        // ---- 保存（鍵 → 締めの確かめ → 今の記録を読む → 決める → 書く → 履歴）
        const result = await toggleAllowanceForDay({
            actor,
            foremanId,
            dateKey: date,
            targetUserId: userId,
            on,
            item: item ? { id: item.id, name: item.name, isActive: item.isActive } : null,
            targetPayRole,
        });
        // その日付に有効な金額が無い（手当が始まる前の日付・金額の行が1つも無い）。何も保存していない
        if (result === 'no_rate') return errorResponse(ALLOWANCE_NO_RATE_MESSAGE, 400);

        // 保存のあとに読み直した、その人の記録を返す（別の端末が先に付けた・消した場合も、画面が正しくなる）。
        // ボタン（offers）は返さない＝画面は、前に読んだボタンをそのまま使う（変わったときは、画面が GET で読み直す）
        const monthClosed = await isAllowanceMonthClosed(monthKeyOf(date));
        const recordsByUser = await loadDayRecords(actor, [userId], day, monthClosed);
        return NextResponse.json({ result, monthClosed, member: { userId, records: recordsByUser.get(userId) ?? [] } }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の保存', err);
    }
}
