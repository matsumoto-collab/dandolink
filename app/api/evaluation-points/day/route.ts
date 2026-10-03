/**
 * 評価ポイント: 「出勤簿入力」用の API（docs/指示書_評価ポイント.md の 6-2。共通の決まりは 6-0）。
 *
 *   GET /api/evaluation-points/day?foremanId=<userId>&date=YYYY-MM-DD
 *       その職長・その日の班の人と、その日に付いている記録を返す。
 *   PUT /api/evaluation-points/day   body: { foremanId, date, userId, itemId, on }
 *       ボタンを1つ押すたびに1回呼ぶ。押した1つだけを扱う（画面が古くても、ほかの記録を巻き込まない）。
 *
 * だれが何をできるか・どの点数を使うか・ボタンを押したときに何をするかは、
 * lib/evaluationPoints.ts の関数で決める（ここに決まりを書き直さない）。
 * 出勤簿のデータ（AttendanceRecord）は、読みも書きもしない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    canInputEvaluationPoints,
    canInputForForeman,
    canRemoveRecord,
    dateKeyToDate,
    dateToDateKey,
    decideDayToggle,
    isEvaluationPointEligibleRole,
    isFutureDateKey,
    resolveRateAt,
    toEvaluationPointStatus,
    type EvaluationPointStatus,
    type PointRecordLike,
} from '@/lib/evaluationPoints';
import { actorOf, getAttendanceMembers, loadRatesByItemId, type AttendanceMember, type PointActor } from '@/lib/evaluationPointsServer';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// ---------------------------------------------------------------- 応答の形

interface DayRecord {
    id: string;
    itemId: string;
    /** 記録に写してある名前（今の項目名ではない） */
    itemName: string;
    status: EvaluationPointStatus;
    createdBy: string;
    createdByName: string;
    /** 操作している人が、この記録を取り消せるか */
    canRemove: boolean;
}

interface DayMember {
    userId: string;
    /** ポイントをもらえるロールか（協力会社のメンバーなどは false。画面はボタンを出さない） */
    eligible: boolean;
    records: DayRecord[];
}

type DayResult = 'added' | 'removed' | 'unchanged' | 'blocked' | 'rejected';

/** DB の行 → lib/evaluationPoints.ts の PointRecordLike。status は必ず toEvaluationPointStatus() を通す */
function toRecordLike(row: { id: string; userId: string; itemId: string; status: string; createdBy: string }): PointRecordLike {
    return { id: row.id, userId: row.userId, itemId: row.itemId, status: toEvaluationPointStatus(row.status), createdBy: row.createdBy };
}

/** 「出勤簿入力」で扱う項目 = inputBy が 'foreman' の項目（使っていない項目も含む）の ID */
async function loadForemanItemIds(): Promise<string[]> {
    const items = await prisma.evaluationPointItem.findMany({ where: { inputBy: 'foreman' }, select: { id: true } });
    return items.map((i) => i.id);
}

/**
 * その人たちの、その日の記録を DayMember の形にする。
 * 記録は、inputBy が 'foreman' の項目のものだけ（使っていない項目の記録も含む。管理者だけの項目の記録は含めない）。
 * GET は班の全員ぶん、PUT は押された1人ぶんを、同じ関数で作る（PUT の member は、GET の members の1人ぶんと同じ形）。
 * members の順番・1人の中の records の順番は決めていない（画面は userId・itemId で突き合わせる）。
 */
async function loadDayMembers(
    actor: PointActor,
    members: readonly AttendanceMember[],
    day: Date,
    foremanItemIds: readonly string[],
): Promise<DayMember[]> {
    const rows = members.length === 0 || foremanItemIds.length === 0
        ? []
        : await prisma.evaluationPointRecord.findMany({
            where: { userId: { in: members.map((m) => m.id) }, date: day, itemId: { in: [...foremanItemIds] } },
            select: { id: true, userId: true, itemId: true, itemName: true, status: true, createdBy: true, createdByName: true },
        });

    const recordsByUser = new Map<string, DayRecord[]>();
    for (const row of rows) {
        const list = recordsByUser.get(row.userId) ?? [];
        list.push({
            id: row.id,
            itemId: row.itemId,
            itemName: row.itemName,
            status: toEvaluationPointStatus(row.status),
            createdBy: row.createdBy,
            createdByName: row.createdByName,
            canRemove: canRemoveRecord(actor, toRecordLike(row)),
        });
        recordsByUser.set(row.userId, list);
    }

    return members.map((m) => ({
        userId: m.id,
        // m.role は DB の値（大文字が混ざる）。判定の関数が小文字にそろえて比べる
        eligible: isEvaluationPointEligibleRole(m.role),
        records: recordsByUser.get(m.id) ?? [],
    }));
}

// ================================================================ GET

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);

        // 確かめる順番と文言は、PUT の 1〜4 と同じ
        // 1. 付けられるロールでない → 403（作業員が foremanId に自分の ID を指定しても、ここで断る）
        if (!canInputEvaluationPoints(actor.role)) return errorResponse('権限がありません', 403);

        // 2. 入力の形
        const url = new URL(req.url);
        const foremanId = url.searchParams.get('foremanId');
        const date = url.searchParams.get('date');
        if (!foremanId || !date) return validationErrorResponse('入力が不正です');

        // 3. 日付の形
        const day = dateKeyToDate(date);
        if (!day) return validationErrorResponse('日付が不正です');

        // 4. その職長の班を扱えない（職長は自分の班だけ）→ 403
        if (!canInputForForeman(actor, foremanId)) return errorResponse('他の職長の班の評価ポイントは扱えません', 403);

        // 先の日付には付けられないので、項目も人も空で返す（画面は何も出さない）。
        // 断るのではなく 200 で返すので、権限（4）を確かめたあとに見る
        if (isFutureDateKey(date)) {
            return NextResponse.json({ date, foremanId, items: [], members: [] }, NO_STORE);
        }

        const [members, foremanItems] = await Promise.all([
            getAttendanceMembers(foremanId, date),
            // 使っていない項目も読む（付けたあとで「使わない」にした項目の記録も返すので、記録を絞るのに要る）。
            // sortOrder が同じ項目どうしの順は決めていない
            prisma.evaluationPointItem.findMany({
                where: { inputBy: 'foreman' },
                orderBy: { sortOrder: 'asc' },
                select: { id: true, name: true, description: true, isActive: true },
            }),
        ]);

        return NextResponse.json(
            {
                date,
                foremanId,
                // ボタンとして出す項目 = 使用中のものだけ。点数は返さない
                items: foremanItems
                    .filter((i) => i.isActive)
                    .map((i) => ({ id: i.id, name: i.name, description: i.description })),
                members: await loadDayMembers(actor, members, day, foremanItems.map((i) => i.id)),
            },
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('評価ポイントの取得', err);
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
        if (!canInputEvaluationPoints(actor.role)) return errorResponse('権限がありません', 403);

        // 2. 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const body = parseToggleBody(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        const { foremanId, date, userId, itemId, on } = body;

        // 3. 日付の形 → 先の日付（付けるのも取り消すのも断る）
        const day = dateKeyToDate(date);
        if (!day) return validationErrorResponse('日付が不正です');
        if (isFutureDateKey(date)) return errorResponse('先の日付には付けられません', 400);

        // 4. その職長の班を扱えない（職長は自分の班だけ）→ 403
        if (!canInputForForeman(actor, foremanId)) return errorResponse('他の職長の班の評価ポイントは扱えません', 403);

        // 5. その日の班のメンバーでない → 400 ／ 6. ポイントをもらえるロールでない → 400
        const members = await getAttendanceMembers(foremanId, date);
        const member = members.find((m) => m.id === userId);
        if (!member) return errorResponse('この日の班のメンバーではありません', 400);
        if (!isEvaluationPointEligibleRole(member.role)) return errorResponse('評価ポイントの対象外の人です', 400);

        // ---- 項目（無ければ null）と、その人・その日・その項目の今の記録（無ければ null）を読んで、何をするかを決める
        // 記録は、取り消したときにログへ全部の列を写すので、列を絞らずに読む
        const [item, existing] = await Promise.all([
            prisma.evaluationPointItem.findUnique({ where: { id: itemId }, select: { id: true, name: true, isActive: true, inputBy: true } }),
            prisma.evaluationPointRecord.findFirst({ where: { userId, date: day, itemId } }),
        ]);
        const decision = decideDayToggle({
            operator: actor,
            targetUserId: userId,
            on,
            item: item ? { id: item.id, isActive: item.isActive, inputBy: item.inputBy } : null,
            existing: existing ? toRecordLike(existing) : null,
        });

        let result: DayResult;
        if (decision.action === 'add') {
            // 点数は「記録の日付に有効な点数」（保存した日ではなく、行動のあった日で決める）
            const ratesByItemId = await loadRatesByItemId([itemId]);
            const rate = resolveRateAt(ratesByItemId.get(itemId) ?? [], date);
            // 点数の行が1つも無い項目（通常は起きない）は断る。item は 'add' のときは必ずある
            if (!item || !rate) return errorResponse('この項目には点数が設定されていません', 400);
            const status = decision.status; // 自分の行は 'pending'（確認待ち）、他の人の行は 'confirmed'

            const added = await prisma.$transaction(async (tx) => {
                // skipDuplicates: 同時に2台から押されても、同じ記録が2行にならず、例外にもならない。
                // createManyAndReturn が返すのは「実際に入った行」だけなので、空なら別の端末が先に入れている
                const inserted = await tx.evaluationPointRecord.createManyAndReturn({
                    data: [{
                        userId,
                        date: day,
                        itemId,
                        itemName: item.name, // 今の項目名の写し（あとで項目名を変えても、記録は変わらない）
                        points: rate.points,
                        rateId: rate.id,
                        status,
                        source: 'attendance',
                        foremanId,
                        createdBy: actor.id,
                        createdByName: actor.name,
                    }],
                    skipDuplicates: true,
                });
                if (inserted.length === 0) return false;
                // ログは、実際に入ったときだけ・記録と同じトランザクションの中で書く
                const record = inserted[0];
                await tx.evaluationPointLog.create({
                    data: {
                        action: 'record_added',
                        actorId: actor.id,
                        actorName: actor.name,
                        targetUserId: record.userId,
                        itemId: record.itemId,
                        recordId: record.id,
                        recordDate: record.date,
                        detail: { itemName: record.itemName, points: record.points, status: record.status, source: record.source },
                    },
                });
                return true;
            });
            result = added ? 'added' : 'unchanged';
        } else if (decision.action === 'remove') {
            // decideDayToggle が 'remove' を返すのは、今の記録があるときだけ
            if (!existing) throw new Error('取り消す記録が読めていません');

            const removed = await prisma.$transaction(async (tx) => {
                // 条件に「読んだときの status」も入れる。
                // 読んだあとで状態が変わった記録（本人が取り下げる直前に、管理者が認めた など）は、ここで消さない。
                // ID で消すので、読んだあとに取り消されて付け直された別の記録にも当たらない
                const deleted = await tx.evaluationPointRecord.deleteMany({ where: { id: existing.id, status: existing.status } });
                if (deleted.count !== 1) return false;
                // ログは、実際に消えたときだけ。取り消した記録の全部の列を残す（日付は 'YYYY-MM-DD'）。
                // 写しは上で読んだ行でよい（状態が変わっていたら、上の条件で消えていない）
                await tx.evaluationPointLog.create({
                    data: {
                        action: 'record_removed',
                        actorId: actor.id,
                        actorName: actor.name,
                        targetUserId: existing.userId,
                        itemId: existing.itemId,
                        recordId: existing.id,
                        recordDate: existing.date,
                        detail: { ...existing, date: dateToDateKey(existing.date) },
                    },
                });
                return true;
            });
            result = removed ? 'removed' : 'unchanged';
        } else {
            // 何もしない: 'unchanged'（もうその状態）／'blocked'（取り消す権限が無い）／'rejected'（出勤簿入力では扱えない項目）
            result = decision.reason;
        }

        // 保存のあとに読み直した、その人の最新の状態を返す（別の端末が先に付けた・消した場合も、画面が正しくなる）
        const [latest] = await loadDayMembers(actor, [member], day, await loadForemanItemIds());
        return NextResponse.json({ result, member: latest }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの保存', err);
    }
}
