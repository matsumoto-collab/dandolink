/**
 * 手当: 金額の予約の取り消し（docs/指示書_大規模手当.md の 6-1。共通の決まりは 6-0）。
 *
 *   DELETE /api/allowances/items/[id]/rates/[rateId]   admin
 *       適用開始日が今日（日本時間）より後の行（まだ始まっていない予約）だけ削除できる。
 *       すでに始まった行の金額を直したいときは、同じ適用開始日で、正しい金額の行を足す（POST /items/[id]/rates）。
 *
 * 書くのは lib/allowancesServer.ts の cancelAllowanceRate() だけ（鍵 → 確かめる → 消す → 履歴）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { isAllowanceAdmin } from '@/lib/allowances';
import { actorOf, cancelAllowanceRate } from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; rateId: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const result = await cancelAllowanceRate(actor, params.id, params.rateId);
        if (result === 'not_found') return notFoundResponse('金額');
        if (result === 'started') return errorResponse('すでに始まっている金額は取り消せません（直すときは、同じ適用開始日で、正しい金額を入れ直してください）', 400);

        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の金額の予約の取り消し', err);
    }
}
