/**
 * 評価ポイント「ありがとう」: 送る・全員分の一覧。
 *
 *   POST /api/evaluation-points/thanks   body: { toUserId: string, message?: string | null }
 *        対象のロールの人。送る人は必ずセッションの id（ボディで受け取らない）。日付は今日（日本時間）をサーバーが決める。
 *        201 { thanks: { id, date, toUserId, toUserName, message }, remainingToday }
 *   GET  /api/evaluation-points/thanks?startDate=&endDate=   admin・manager。{ thanks: [...] }
 *
 * だれが何をできるかは lib/evaluationThanks.ts の関数で決める。書くのは lib/evaluationThanksServer.ts の関数だけ。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE, parsePeriodParams } from '@/lib/evaluationPointsReport';
import { canUseThanks, isThanksManager, normalizeThanksMessage } from '@/lib/evaluationThanks';
import { loadThanksList, sendThanks } from '@/lib/evaluationThanksServer';
import { asObject } from '../items/_shared';

export const dynamic = 'force-dynamic';

const MESSAGE_INVALID = 'ひとことは100字までの文字で入れてください';

// ================================================================ GET

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isThanksManager(actor.role)) return errorResponse('権限がありません', 403);

        const parsed = parsePeriodParams(new URL(req.url).searchParams);
        if (!parsed.ok) return validationErrorResponse(parsed.message);
        if (!parsed.period) return validationErrorResponse('入力が不正です');

        const thanks = await loadThanksList(parsed.period);
        return NextResponse.json({ thanks }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('「ありがとう」の一覧の取得', err);
    }
}

// ================================================================ POST

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        // 送る人は、必ずセッションの id（ボディの fromUserId などは見ない）
        const actor = actorOf(session!);
        if (!canUseThanks(actor.role) || !actor.id) return errorResponse('権限がありません', 403);

        const body = asObject(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        const { toUserId } = body;
        if (typeof toUserId !== 'string' || !toUserId) return validationErrorResponse('入力が不正です');
        const message = normalizeThanksMessage(body.message);
        if (!message.ok) return errorResponse(MESSAGE_INVALID, 400);

        const result = await sendThanks({ actor, toUserId, message: message.value });
        if (!result.ok) return errorResponse(result.message, result.status);

        return NextResponse.json(
            { thanks: result.thanks, remainingToday: result.remainingToday },
            { status: 201, ...NO_STORE },
        );
    } catch (err) {
        return serverErrorResponse('「ありがとう」を送る', err);
    }
}
