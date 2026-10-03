/**
 * 評価ポイント: 点数表の並べ替え（docs/指示書_評価ポイント.md の 6-1。共通の決まりは 6-0）。
 *
 *   PUT /api/evaluation-points/items/order   { ids: string[] }  admin
 *       全項目の ID を並べたい順に受け取り、sortOrder を 0 から振り直す。
 *       （画面は、使用中の項目を並べ替えたあとの順で並べ、そのあとに使っていない項目を今の順で続けて送る）
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { isEvaluationPointAdmin } from '@/lib/evaluationPoints';
import { actorOf } from '@/lib/evaluationPointsServer';
import { NO_STORE, asObject } from '../_shared';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const body = asObject(await req.json().catch(() => null));
        const ids = body?.ids;
        if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
            return validationErrorResponse('入力が不正です');
        }

        // 過不足・重複があれば断る（ほかの人が項目を足した・消したあとの古い画面から送られた）
        const items = await prisma.evaluationPointItem.findMany({ select: { id: true, sortOrder: true } });
        const sortOrderById = new Map(items.map((i) => [i.id, i.sortOrder]));
        const unique = new Set(ids);
        if (unique.size !== ids.length || ids.length !== items.length || !ids.every((id) => sortOrderById.has(id))) {
            return errorResponse('項目が変わっています。画面を読み直してください', 400);
        }

        // 並びが変わる項目だけを直す。1つも変わらなければ、書き込みもログもしない
        const changes = ids
            .map((id, index) => ({ id, sortOrder: index }))
            .filter((c) => sortOrderById.get(c.id) !== c.sortOrder);
        if (changes.length > 0) {
            await prisma.$transaction(async (tx) => {
                for (const c of changes) {
                    await tx.evaluationPointItem.update({ where: { id: c.id }, data: { sortOrder: c.sortOrder } });
                }
                // 1回の操作で1行
                await tx.evaluationPointLog.create({
                    data: {
                        action: 'items_reordered',
                        actorId: actor.id,
                        actorName: actor.name,
                        detail: { ids },
                    },
                });
            });
        }

        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの項目の並べ替え', err);
    }
}
