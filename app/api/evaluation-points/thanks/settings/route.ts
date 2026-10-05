/**
 * 評価ポイント「ありがとう」: 設定（使う／使わない・1回あたりの点数）。
 *
 *   GET /api/evaluation-points/thanks/settings   admin。{ isActive, pointsPerThanks }
 *   PUT /api/evaluation-points/thanks/settings   admin。body: { isActive?: boolean, pointsPerThanks?: number }（どちらかは必須）
 *       点数は 0〜9999 の整数。保存は lib/evaluationThanksServer.ts の updateThanksSetting() だけ。
 *       あとから点数を変えても、送ってある「ありがとう」の点数は変わらない（送った時点の写し）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE } from '@/lib/evaluationPointsReport';
import { isThanksAdmin, isValidThanksPoints } from '@/lib/evaluationThanks';
import { getThanksSetting, updateThanksSetting } from '@/lib/evaluationThanksServer';
import { asObject } from '../../items/_shared';

export const dynamic = 'force-dynamic';

// ================================================================ GET

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isThanksAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const setting = await getThanksSetting();
        return NextResponse.json({ isActive: setting.isActive, pointsPerThanks: setting.pointsPerThanks }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('「ありがとう」の設定の取得', err);
    }
}

// ================================================================ PUT

export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isThanksAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const body = asObject(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        const { isActive, pointsPerThanks } = body;
        if (isActive === undefined && pointsPerThanks === undefined) return validationErrorResponse('入力が不正です');
        if (isActive !== undefined && typeof isActive !== 'boolean') return validationErrorResponse('入力が不正です');
        if (pointsPerThanks !== undefined && typeof pointsPerThanks !== 'number') return validationErrorResponse('入力が不正です');
        if (pointsPerThanks !== undefined && !isValidThanksPoints(pointsPerThanks)) {
            return errorResponse('点数は 0〜9999 の整数で入れてください', 400);
        }

        const saved = await updateThanksSetting({
            actor,
            ...(isActive !== undefined ? { isActive } : {}),
            ...(pointsPerThanks !== undefined ? { pointsPerThanks } : {}),
        });
        return NextResponse.json({ isActive: saved.isActive, pointsPerThanks: saved.pointsPerThanks }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('「ありがとう」の設定の保存', err);
    }
}
