/**
 * 手当: 記録1件の取り消し（docs/指示書_大規模手当.md の 6-3。共通の決まりは 6-0）。
 *
 *   DELETE /api/allowances/records/[id]   admin・manager
 *
 * 取り消してよいか（締めた月でないか・権限があるか）は、lib/allowancesServer.ts の removeAllowanceRecord() が
 * 鍵を取ったあとで確かめる（締めるのと同時に取り消されることが無い）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { ALLOWANCE_CLOSED_MESSAGE, isAllowanceManager } from '@/lib/allowances';
import { actorOf, removeAllowanceRecord } from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const result = await removeAllowanceRecord(actor, params.id);
        if (result === 'not_found') return notFoundResponse('記録');
        if (result === 'closed') return errorResponse(ALLOWANCE_CLOSED_MESSAGE, 400);
        // 管理者・マネージャーが取り消せないのは、確定した自分の分だけ（canRemoveRecord）
        if (result === 'forbidden') return errorResponse('自分の分の記録は、自分では取り消せません（ほかの管理者・マネージャーに頼んでください）', 403);
        if (result === 'changed') return errorResponse('記録の状態が変わっています。画面を読み直してください', 400);

        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の記録の取り消し', err);
    }
}
