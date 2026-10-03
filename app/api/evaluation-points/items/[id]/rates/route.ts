/**
 * 評価ポイント: 項目の点数の履歴（docs/指示書_評価ポイント.md の 6-1。共通の決まりは 6-0）。
 *
 *   GET  /api/evaluation-points/items/[id]/rates   点数の履歴（適用開始日の新しい順）。admin・manager
 *   POST /api/evaluation-points/items/[id]/rates   { points, effectiveFrom } 行を足すだけ（追記のみ）。admin
 *
 * 点数を変えても、すでに付いた記録の点数は変わらない（記録には付けた時点の点数を写してある）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    dateKeyToDate,
    dateToDateKey,
    isEvaluationPointAdmin,
    isEvaluationPointManager,
    isValidPoints,
    resolveRateAt,
    todayJstDateKey,
    type PointRateLike,
} from '@/lib/evaluationPoints';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE, asObject } from '../../_shared';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

type RateState = 'upcoming' | 'current' | 'past';

interface RateResponse {
    id: string;
    points: number;
    effectiveFrom: string;
    createdByName: string;
    createdAt: string;
    /** upcoming = 予約（適用開始日が今日より後）／current = 今の点数／past = 以前 */
    state: RateState;
}

// ================================================================ GET

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        const item = await prisma.evaluationPointItem.findUnique({ where: { id: params.id }, select: { id: true } });
        if (!item) return notFoundResponse('項目');

        // createdByName が要るので、loadRatesByItemId は使わずにここで引く
        const rows = await prisma.evaluationPointRate.findMany({
            where: { itemId: item.id },
            // 適用開始日の新しい順（同じ日は入れた日時の新しい順）
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true, points: true, effectiveFrom: true, createdByName: true, createdAt: true },
        });

        const today = todayJstDateKey();
        const likes: PointRateLike[] = rows.map((r) => ({
            id: r.id,
            points: r.points,
            effectiveFrom: dateToDateKey(r.effectiveFrom),
            createdAt: r.createdAt.toISOString(),
        }));
        const current = resolveRateAt(likes, today);

        const rates: RateResponse[] = rows.map((r, i) => {
            const like = likes[i];
            const state: RateState = like.effectiveFrom > today
                ? 'upcoming'
                : current && current.id === like.id ? 'current' : 'past';
            return {
                id: like.id,
                points: like.points,
                effectiveFrom: like.effectiveFrom,
                createdByName: r.createdByName,
                createdAt: like.createdAt,
                state,
            };
        });

        // 応答は、点数の行の配列そのもの（指示書 6-1）
        return NextResponse.json(rates, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの点数の履歴の取得', err);
    }
}

// ================================================================ POST

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形
        const body = asObject(await req.json().catch(() => null));
        if (!body || !isValidPoints(body.points) || typeof body.effectiveFrom !== 'string') {
            return validationErrorResponse('入力が不正です');
        }
        const points = body.points;
        const effectiveFromKey = body.effectiveFrom;
        const effectiveFrom = dateKeyToDate(effectiveFromKey);
        if (!effectiveFrom) return validationErrorResponse('日付が不正です');

        // ---- 適用開始日は、日本時間の今日以降（過去にさかのぼった変更はできない）
        const today = todayJstDateKey();
        if (effectiveFromKey < today) return errorResponse('適用開始日は、今日以降にしてください', 400);

        const item = await prisma.evaluationPointItem.findUnique({ where: { id: params.id }, select: { id: true } });
        if (!item) return notFoundResponse('項目');

        const rate = await prisma.$transaction(async (tx) => {
            const row = await tx.evaluationPointRate.create({
                data: {
                    itemId: item.id,
                    points,
                    effectiveFrom,
                    createdBy: actor.id,
                    createdByName: actor.name,
                },
                select: { id: true, points: true, effectiveFrom: true, createdByName: true, createdAt: true },
            });
            await tx.evaluationPointLog.create({
                data: {
                    action: 'rate_added',
                    actorId: actor.id,
                    actorName: actor.name,
                    itemId: item.id,
                    detail: { points: row.points, effectiveFrom: effectiveFromKey },
                },
            });
            return row;
        });

        // 今日から始まる行は、今日の点数の中でいちばん後から入れた行なので「今の点数」になる
        const response: RateResponse = {
            id: rate.id,
            points: rate.points,
            effectiveFrom: effectiveFromKey,
            createdByName: rate.createdByName,
            createdAt: rate.createdAt.toISOString(),
            state: effectiveFromKey > today ? 'upcoming' : 'current',
        };
        return NextResponse.json({ rate: response }, { status: 201, ...NO_STORE });
    } catch (err) {
        return serverErrorResponse('評価ポイントの点数の変更', err);
    }
}
