/**
 * 評価ポイント: 記録1件の取り消し（docs/指示書_評価ポイント.md の 6-3。共通の決まりは 6-0）。
 *
 *   DELETE /api/evaluation-points/records/[id]   admin・manager
 *
 * 取り消してよいかは lib/evaluationPoints.ts の canRemoveRecord() で決める。
 * 消すときは PUT /day と同じく deleteMany({ where: { id, status: 読んだときの status } })。
 * 本人が確認待ちを取り下げようとした直後に、別の管理者が認めた記録を消さないため。
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canRemoveRecord, dateToDateKey, isEvaluationPointManager, toEvaluationPointStatus } from '@/lib/evaluationPoints';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE } from '@/lib/evaluationPointsReport';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        // 取り消したときにログへ全部の列を写すので、列を絞らずに読む
        const existing = await prisma.evaluationPointRecord.findUnique({ where: { id: params.id } });
        if (!existing) return notFoundResponse('記録');

        const like = {
            id: existing.id,
            userId: existing.userId,
            itemId: existing.itemId,
            status: toEvaluationPointStatus(existing.status),
            createdBy: existing.createdBy,
        };
        if (!canRemoveRecord(actor, like)) return errorResponse('この記録は取り消せません', 403);

        const removed = await prisma.$transaction(async (tx) => {
            const deleted = await tx.evaluationPointRecord.deleteMany({ where: { id: existing.id, status: existing.status } });
            if (deleted.count !== 1) return false;
            // ログは、実際に消えたときだけ。取り消した記録の全部の列を残す（日付は 'YYYY-MM-DD'）
            await tx.evaluationPointLog.create({
                data: {
                    action: 'record_removed',
                    actorId: actor.id,
                    actorName: actor.name,
                    targetUserId: existing.userId,
                    itemId: existing.itemId,
                    recordId: existing.id,
                    recordDate: existing.date,
                    detail: {
                        ...existing,
                        date: dateToDateKey(existing.date),
                        createdAt: existing.createdAt.toISOString(),
                        updatedAt: existing.updatedAt.toISOString(),
                        confirmedAt: existing.confirmedAt ? existing.confirmedAt.toISOString() : null,
                    } as Prisma.InputJsonObject,
                },
            });
            return true;
        });
        if (!removed) return errorResponse('記録の状態が変わっています。画面を読み直してください', 400);

        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの記録の取り消し', err);
    }
}
