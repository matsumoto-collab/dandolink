/**
 * 評価ポイント「ありがとう」: 送れるか（メニュー・ボタンを出すか）。
 *
 *   GET /api/evaluation-points/thanks/access   ログインしている人ならだれでも。{ enabled: boolean }
 *
 * enabled = 設定が「使う」で、ロールが対象（lib/evaluationThanks.ts の canUseThanks）。
 * 対象外のロールは、DB を読まずに false を返す。
 */
import { NextResponse } from 'next/server';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE } from '@/lib/evaluationPointsReport';
import { canUseThanks } from '@/lib/evaluationThanks';
import { getThanksSetting } from '@/lib/evaluationThanksServer';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!canUseThanks(actor.role) || !actor.id) return NextResponse.json({ enabled: false }, NO_STORE);
        const setting = await getThanksSetting();
        return NextResponse.json({ enabled: setting.isActive }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('「ありがとう」の表示の設定の取得', err);
    }
}
