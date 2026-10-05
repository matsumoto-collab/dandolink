/**
 * 評価ポイント「ありがとう」: 本人の「送る」の材料と、もらった・送った一覧。
 *
 *   GET /api/evaluation-points/thanks/me?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD   期間は必須
 *
 * だれ: 「ありがとう」の対象のロールの人（lib/evaluationThanks.ts の canUseThanks）。ほかは 403。
 * 返すのは、ログインしている本人の分だけ。userId は必ずセッションから取る（クエリで受け取らない）。
 * 評価ポイントの見せ方（resolveAccessMode）が 'none' の人には、点数（points・pointsPerThanks・receivedPoints）を返さない（null）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { actorOf, resolveAccessMode } from '@/lib/evaluationPointsServer';
import { NO_STORE, parsePeriodParams } from '@/lib/evaluationPointsReport';
import { THANKS_DAILY_LIMIT, canUseThanks } from '@/lib/evaluationThanks';
import {
    getThanksSetting,
    loadMyThanks,
    loadThanksSendContext,
    type MyThanksReceived,
    type MyThanksSent,
} from '@/lib/evaluationThanksServer';

export const dynamic = 'force-dynamic';

interface MyThanksResponse {
    startDate: string;
    endDate: string;
    /** 設定が「使う」か */
    active: boolean;
    /** resolveAccessMode(role) !== 'none' */
    showPoints: boolean;
    /** showPoints のときだけ。そうでなければ null */
    pointsPerThanks: number | null;
    dailyLimit: number;
    remainingToday: number;
    sentTodayToIds: string[];
    recipients: { userId: string; displayName: string }[];
    receivedCount: number;
    receivedPoints: number | null;
    received: MyThanksReceived[];
    sent: MyThanksSent[];
}

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!canUseThanks(actor.role) || !actor.id) return errorResponse('権限がありません', 403);

        const parsed = parsePeriodParams(new URL(req.url).searchParams);
        if (!parsed.ok) return validationErrorResponse(parsed.message);
        if (!parsed.period) return validationErrorResponse('入力が不正です');
        const period = parsed.period;

        const [setting, mode] = await Promise.all([getThanksSetting(), resolveAccessMode(actor.role)]);
        const showPoints = mode !== 'none';

        const [context, mine] = await Promise.all([
            loadThanksSendContext(actor.id, setting),
            // 本人の分だけ（セッションの id）
            loadMyThanks({ userId: actor.id, role: actor.role, period, showPoints }),
        ]);

        const body: MyThanksResponse = {
            startDate: period.startDate,
            endDate: period.endDate,
            active: setting.isActive,
            showPoints,
            pointsPerThanks: showPoints ? setting.pointsPerThanks : null,
            dailyLimit: THANKS_DAILY_LIMIT,
            remainingToday: context.remainingToday,
            sentTodayToIds: context.sentTodayToIds,
            recipients: context.recipients,
            receivedCount: mine.receivedCount,
            receivedPoints: mine.receivedPoints,
            received: mine.received,
            sent: mine.sent,
        };
        return NextResponse.json(body, NO_STORE);
    } catch (err) {
        return serverErrorResponse('「ありがとう」の取得', err);
    }
}
