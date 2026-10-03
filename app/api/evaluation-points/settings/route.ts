/**
 * 評価ポイント: 公開の設定（docs/指示書_評価ポイント.md の 6-4。共通の決まりは 6-0）。
 *
 *   GET /api/evaluation-points/settings   admin。{ showToMembers, memberNotice }
 *   PUT /api/evaluation-points/settings   admin。body: { showToMembers: boolean, memberNotice: string | null }
 *       注意書きは前後の空白を取って 200字まで・空は null。行が無ければ作る（upsert）。
 *       変わったときだけ、同じトランザクションで EvaluationPointLog に setting_updated を書く。
 *
 * だれが何をできるかは lib/evaluationPoints.ts の関数で決める（ここにロールの文字列を書かない）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { prisma } from '@/lib/prisma';
import { EVALUATION_POINT_NOTE_MAX, isEvaluationPointAdmin } from '@/lib/evaluationPoints';
import { EVALUATION_POINT_SETTING_ID, actorOf, getEvaluationPointSetting, type EvaluationPointSettingValue } from '@/lib/evaluationPointsServer';
import { NO_STORE } from '@/lib/evaluationPointsReport';
import { asObject, parseOptionalText } from '../items/_shared';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

// ================================================================ GET

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const setting = await getEvaluationPointSetting();
        return NextResponse.json({ showToMembers: setting.showToMembers, memberNotice: setting.memberNotice }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの公開の設定の取得', err);
    }
}

// ================================================================ PUT

export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const body = asObject(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        if (typeof body.showToMembers !== 'boolean') return validationErrorResponse('入力が不正です');
        const notice = parseOptionalText(body.memberNotice === undefined ? null : body.memberNotice, EVALUATION_POINT_NOTE_MAX);
        if (!notice.ok) return validationErrorResponse('入力が不正です');

        const after: EvaluationPointSettingValue = { showToMembers: body.showToMembers, memberNotice: notice.value };

        const saved = await prisma.$transaction(async (tx) => {
            const row = await tx.evaluationPointSetting.findUnique({
                where: { id: EVALUATION_POINT_SETTING_ID },
                select: { showToMembers: true, memberNotice: true },
            });
            const before: EvaluationPointSettingValue = row
                ? { showToMembers: row.showToMembers === true, memberNotice: row.memberNotice ?? null }
                : { showToMembers: false, memberNotice: null };
            // 行があって、中身が同じなら、書かない（ログも書かない＝変わった分だけ）
            if (row && before.showToMembers === after.showToMembers && before.memberNotice === after.memberNotice) {
                return before;
            }
            await tx.evaluationPointSetting.upsert({
                where: { id: EVALUATION_POINT_SETTING_ID },
                create: { id: EVALUATION_POINT_SETTING_ID, ...after, updatedBy: actor.id },
                update: { ...after, updatedBy: actor.id },
                select: { id: true },
            });
            await tx.evaluationPointLog.create({
                data: {
                    action: 'setting_updated',
                    actorId: actor.id,
                    actorName: actor.name,
                    detail: { before: { ...before }, after: { ...after } },
                },
            });
            return after;
        });

        return NextResponse.json({ showToMembers: saved.showToMembers, memberNotice: saved.memberNotice }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの公開の設定の保存', err);
    }
}
