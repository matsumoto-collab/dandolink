/**
 * 評価ポイント: 人ごと・項目ごとの集計（docs/指示書_評価ポイント.md の 6-3。共通の決まりは 6-0）。
 *
 *   GET /api/evaluation-points/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD   admin・manager（期間は必須）
 *
 * 集計そのものは lib/evaluationPointsReport.ts の loadEvaluationPointSummary()。
 * CSV（GET /export?type=summary）も同じ関数を使う＝同じ人・同じ並び・同じ数字。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { isEvaluationPointManager } from '@/lib/evaluationPoints';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE, loadEvaluationPointSummary, parsePeriodParams } from '@/lib/evaluationPointsReport';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        const parsed = parsePeriodParams(new URL(req.url).searchParams);
        if (!parsed.ok) return validationErrorResponse(parsed.message);
        if (!parsed.period) return validationErrorResponse('入力が不正です');

        return NextResponse.json(await loadEvaluationPointSummary(parsed.period), NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの集計の取得', err);
    }
}
