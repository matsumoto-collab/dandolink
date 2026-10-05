/**
 * 評価ポイント「ありがとう」: 1件の取り消し。
 *
 *   DELETE /api/evaluation-points/thanks/[id]   対象のロールの人（ほかは 403）
 *
 * 取り消してよいかは lib/evaluationThanks.ts の canRemoveThanks()
 * （送った本人は送った日のうちだけ。管理者・マネージャーは、いつでも・だれの分でも）。
 * 消すのは lib/evaluationThanksServer.ts の removeThanks() だけ。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE } from '@/lib/evaluationPointsReport';
import { canUseThanks } from '@/lib/evaluationThanks';
import { removeThanks } from '@/lib/evaluationThanksServer';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!canUseThanks(actor.role) || !actor.id) return errorResponse('権限がありません', 403);

        const result = await removeThanks({ actor, id: params.id });
        if (!result.ok) {
            if (result.reason === 'not_found') return errorResponse('「ありがとう」が見つかりません', 404);
            return errorResponse('取り消せるのは、送った本人（送った日のうち）と、管理者・マネージャーです', 403);
        }
        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('「ありがとう」の取り消し', err);
    }
}
