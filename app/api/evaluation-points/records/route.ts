/**
 * 評価ポイント: 記録の一覧・追加・確認（docs/指示書_評価ポイント.md の 6-3。共通の決まりは 6-0）。
 *
 *   GET   /api/evaluation-points/records?startDate=&endDate=&userId=&status=
 *         期間は必須。ただし status=pending のときだけ期間を省ける（省いたら全期間の確認待ち）
 *   POST  /api/evaluation-points/records   body: { userId, date, itemId, note? }   記録を1件付ける
 *   PATCH /api/evaluation-points/records   body: { action: 'confirm', ids: string[] }   確認待ちを認める
 *
 * すべて admin・manager だけ。だれが何をできるか・どの点数を使うかは lib/evaluationPoints.ts の関数で決める。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    EVALUATION_POINT_NOTE_MAX,
    canConfirmRecord,
    dateKeyToDate,
    isEvaluationPointEligibleRole,
    isEvaluationPointManager,
    isFutureDateKey,
    resolveRateAt,
    statusForNewRecord,
    toEvaluationPointStatus,
} from '@/lib/evaluationPoints';
import { actorOf, loadRatesByItemId } from '@/lib/evaluationPointsServer';
import {
    NO_STORE,
    RECORD_SELECT,
    UNKNOWN_USER_NAME,
    loadUserNames,
    parsePeriodParams,
    toRecordResponse,
} from '@/lib/evaluationPointsReport';
import { asObject, parseOptionalText } from '../items/_shared';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

const DUPLICATE_MESSAGE = 'その日のその項目は、すでに付いています';

/** 1回の「まとめて認める」で受け付ける件数の上限（画面の確認待ちの一覧より十分に大きい数） */
const CONFIRM_IDS_MAX = 1000;

// ================================================================ GET

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        const params = new URL(req.url).searchParams;
        const status = params.get('status');
        if (status !== null && status !== 'confirmed' && status !== 'pending') return validationErrorResponse('入力が不正です');
        const userId = params.get('userId');
        if (userId === '') return validationErrorResponse('入力が不正です');

        // 確認待ちが、表示している期間の外に埋もれないように、status=pending のときだけ期間を省ける
        const parsed = parsePeriodParams(params, status === 'pending');
        if (!parsed.ok) return validationErrorResponse(parsed.message);

        const rows = await prisma.evaluationPointRecord.findMany({
            where: {
                ...(parsed.period ? { date: parsed.period.range } : {}),
                ...(userId ? { userId } : {}),
                ...(status ? { status } : {}),
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            select: RECORD_SELECT,
        });
        const names = await loadUserNames(rows.map((r) => r.userId));

        return NextResponse.json(
            { records: rows.map((r) => toRecordResponse(r, names.get(r.userId) ?? UNKNOWN_USER_NAME, actor)) },
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('評価ポイントの記録の取得', err);
    }
}

// ================================================================ POST

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const body = asObject(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        const { userId, date, itemId } = body;
        if (typeof userId !== 'string' || !userId || typeof date !== 'string' || typeof itemId !== 'string' || !itemId) {
            return validationErrorResponse('入力が不正です');
        }
        const note = parseOptionalText(body.note === undefined ? null : body.note, EVALUATION_POINT_NOTE_MAX);
        if (!note.ok) return validationErrorResponse('入力が不正です');

        // ---- 日付（形 → 先の日付）
        const day = dateKeyToDate(date);
        if (!day) return validationErrorResponse('日付が不正です');
        if (isFutureDateKey(date)) return errorResponse('先の日付には付けられません', 400);

        // ---- 対象の人（在籍している・ポイントをもらえるロール）
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, displayName: true, role: true, isActive: true },
        });
        if (!user || !user.isActive) return errorResponse('対象の人が見つかりません', 400);
        // user.role は DB の値（大文字が混ざる）。判定の関数が小文字にそろえて比べる
        if (!isEvaluationPointEligibleRole(user.role)) return errorResponse('評価ポイントの対象外の人です', 400);

        // ---- 項目（使用中なら inputBy は問わない＝管理者・マネージャーはどの項目も付けられる）
        const item = await prisma.evaluationPointItem.findUnique({
            where: { id: itemId },
            select: { id: true, name: true, isActive: true },
        });
        if (!item) return notFoundResponse('項目');
        if (!item.isActive) return errorResponse('この項目は、今は付けられません', 400);
        // 点数は「記録の日付に有効な点数」（保存した日ではなく、行動のあった日で決める）
        const ratesByItemId = await loadRatesByItemId([itemId]);
        const rate = resolveRateAt(ratesByItemId.get(itemId) ?? [], date);
        if (!rate) return errorResponse('この項目には点数が設定されていません', 400);

        // ---- 同じ人・同じ日・同じ項目の記録（入れるときの skipDuplicates でも、もう一度確かめる）
        const existing = await prisma.evaluationPointRecord.findFirst({ where: { userId, date: day, itemId }, select: { id: true } });
        if (existing) return errorResponse(DUPLICATE_MESSAGE, 400);

        const status = statusForNewRecord(actor.id, userId); // 自分に付けたら確認待ち

        const created = await prisma.$transaction(async (tx) => {
            // skipDuplicates: 同時に別の人が先に入れていても、例外にせず「入らなかった」で返る
            const inserted = await tx.evaluationPointRecord.createManyAndReturn({
                data: [{
                    userId,
                    date: day,
                    itemId,
                    itemName: item.name, // 今の項目名の写し
                    points: rate.points,
                    rateId: rate.id,
                    status,
                    source: 'manual',
                    foremanId: null,
                    note: note.value,
                    createdBy: actor.id,
                    createdByName: actor.name,
                }],
                skipDuplicates: true,
            });
            if (inserted.length === 0) return null;
            const record = inserted[0];
            // ログは、実際に入ったときだけ・記録と同じトランザクションの中で書く
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
            return record;
        });
        if (!created) return errorResponse(DUPLICATE_MESSAGE, 400);

        return NextResponse.json({ record: toRecordResponse(created, user.displayName, actor) }, { status: 201, ...NO_STORE });
    } catch (err) {
        return serverErrorResponse('評価ポイントの記録の追加', err);
    }
}

// ================================================================ PATCH

/** { action: 'confirm', ids: string[] } のときだけ、重なりを除いた ids を返す。違えば null */
function parseConfirmBody(value: unknown): string[] | null {
    const body = asObject(value);
    if (!body || body.action !== 'confirm' || !Array.isArray(body.ids)) return null;
    if (body.ids.length > CONFIRM_IDS_MAX) return null;
    if (!body.ids.every((id): id is string => typeof id === 'string' && id.length > 0)) return null;
    return Array.from(new Set(body.ids as string[]));
}

export async function PATCH(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        const ids = parseConfirmBody(await req.json().catch(() => null));
        if (!ids) return validationErrorResponse('入力が不正です');

        const rows = ids.length === 0
            ? []
            : await prisma.evaluationPointRecord.findMany({
                where: { id: { in: ids } },
                select: { id: true, userId: true, date: true, itemId: true, itemName: true, points: true, status: true, createdBy: true },
            });
        // 認めてよい記録だけ（自分の分・すでに確定している記録は除く。無い ID は rows に入らない）
        const targets = rows.filter((r) => canConfirmRecord(actor, {
            id: r.id, userId: r.userId, itemId: r.itemId, status: toEvaluationPointStatus(r.status), createdBy: r.createdBy,
        }));

        const confirmed = targets.length === 0 ? 0 : await prisma.$transaction(async (tx) => {
            const confirmedAt = new Date();
            const done: typeof targets = [];
            for (const r of targets) {
                // 条件に status: 'pending' を入れる（読んだあとで、ほかの人が認めた・取り消した記録には当たらない）
                const updated = await tx.evaluationPointRecord.updateMany({
                    where: { id: r.id, status: 'pending' },
                    data: { status: 'confirmed', confirmedBy: actor.id, confirmedByName: actor.name, confirmedAt },
                });
                if (updated.count === 1) done.push(r);
            }
            // ログは、実際に変わった記録だけ・1件につき1行
            if (done.length > 0) {
                await tx.evaluationPointLog.createMany({
                    data: done.map((r) => ({
                        action: 'record_confirmed',
                        actorId: actor.id,
                        actorName: actor.name,
                        targetUserId: r.userId,
                        itemId: r.itemId,
                        recordId: r.id,
                        recordDate: r.date,
                        detail: { itemName: r.itemName, points: r.points },
                    })),
                });
            }
            return done.length;
        });

        return NextResponse.json({ confirmed, skipped: ids.length - confirmed }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの記録の確認', err);
    }
}
