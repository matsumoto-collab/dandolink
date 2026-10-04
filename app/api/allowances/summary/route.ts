/**
 * 手当: 月の、人ごとの集計（docs/指示書_大規模手当.md の 6-4。共通の決まりは 6-0）。
 *
 *   GET /api/allowances/summary?month=YYYY-MM   admin・manager（月は必須）
 *
 * 集計そのものは lib/allowancesReport.ts の loadAllowanceSummary()。
 * CSV（GET /export?type=summary）も同じ関数を使う＝同じ人・同じ並び・同じ数字。
 * 応答には、集計に加えて unclosedPastMonths（終わったのに締めていない月。古い順）を足す
 * ＝ 画面が「◯月分がまだ締められていません」を出すのに使う。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { isAllowanceManager } from '@/lib/allowances';
import { actorOf, loadUnclosedPastMonths } from '@/lib/allowancesServer';
import { NO_STORE, loadAllowanceSummary } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const month = new URL(req.url).searchParams.get('month');
        if (month === null) return validationErrorResponse('入力が不正です');
        const summary = await loadAllowanceSummary(month);
        if (!summary) return validationErrorResponse('月が不正です');
        const unclosedPastMonths = await loadUnclosedPastMonths();

        return NextResponse.json({ ...summary, unclosedPastMonths }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の集計の取得', err);
    }
}
