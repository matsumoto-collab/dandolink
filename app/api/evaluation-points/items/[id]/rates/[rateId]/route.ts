/**
 * 評価ポイント: 点数の予約の取り消し（docs/指示書_評価ポイント.md の 6-1。共通の決まりは 6-0）。
 *
 *   DELETE /api/evaluation-points/items/[id]/rates/[rateId]   admin
 *       適用開始日が今日（日本時間）より後の行（まだ始まっていない予約）だけ削除できる。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { dateKeyToDate, dateToDateKey, isEvaluationPointAdmin, todayJstDateKey } from '@/lib/evaluationPoints';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE } from '../../../_shared';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

const STARTED_MESSAGE = 'すでに始まっている点数は取り消せません';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; rateId: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const rate = await prisma.evaluationPointRate.findUnique({ where: { id: params.rateId } });
        // ほかの項目の行を、この項目の URL で消させない
        if (!rate || rate.itemId !== params.id) return notFoundResponse('点数');

        // 予約（適用開始日が今日より後）でなければ断る
        const today = todayJstDateKey();
        const effectiveFromKey = dateToDateKey(rate.effectiveFrom);
        if (effectiveFromKey <= today) return errorResponse(STARTED_MESSAGE, 400);

        const removed = await prisma.$transaction(async (tx) => {
            // 確かめてから消すまでのあいだに日付が変わって始まった行は、ここで消さない
            const deleted = await tx.evaluationPointRate.deleteMany({
                where: { id: rate.id, effectiveFrom: { gt: dateKeyToDate(today)! } },
            });
            if (deleted.count !== 1) return false;
            // ログは、実際に消えたときだけ。取り消した行の全部の列を残す（日付は 'YYYY-MM-DD'）
            await tx.evaluationPointLog.create({
                data: {
                    action: 'rate_cancelled',
                    actorId: actor.id,
                    actorName: actor.name,
                    itemId: rate.itemId,
                    detail: {
                        id: rate.id,
                        itemId: rate.itemId,
                        points: rate.points,
                        effectiveFrom: effectiveFromKey,
                        createdBy: rate.createdBy,
                        createdByName: rate.createdByName,
                        createdAt: rate.createdAt.toISOString(),
                    },
                },
            });
            return true;
        });
        if (!removed) return errorResponse(STARTED_MESSAGE, 400);

        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの点数の予約の取り消し', err);
    }
}
