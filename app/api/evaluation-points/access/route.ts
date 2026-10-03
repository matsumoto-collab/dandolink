/**
 * 評価ポイント: 「評価ポイント」の画面の見せ方（docs/指示書_評価ポイント.md の 6-4。共通の決まりは 6-0）。
 *
 *   GET /api/evaluation-points/access   ログインしている人ならだれでも。{ mode: 'manager' | 'member' | 'none' }
 *
 * 見せ方は lib/evaluationPointsServer.ts の resolveAccessMode() で決める（ここに決まりを書き直さない）。
 * メニュー（hooks/useEvaluationPointAccess.ts）が、職長・作業員のときにだけ読む。
 */
import { NextResponse } from 'next/server';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { actorOf, resolveAccessMode } from '@/lib/evaluationPointsServer';
import { NO_STORE } from '@/lib/evaluationPointsReport';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        const mode = await resolveAccessMode(actor.role);
        return NextResponse.json({ mode }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの表示の設定の取得', err);
    }
}
