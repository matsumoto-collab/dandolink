/**
 * 手当: 月を締める・締めを外す（docs/指示書_大規模手当.md の 6-6。共通の決まりは 6-0）。
 *
 *   POST /api/allowances/close   body: { month: 'YYYY-MM', action: 'close' | 'reopen' }   admin だけ
 *
 *   close  … 締める。締めた月の日付の記録は、足す・取り消す・認めるができなくなる。
 *            終わった月だけ・確認待ちが1件も無いときだけ（lib/allowances.ts の checkCanCloseMonth）。
 *   reopen … 締めを外す。
 *
 * 書くのは lib/allowancesServer.ts の closeAllowanceMonth()・reopenAllowanceMonth() だけ
 * （鍵 → 確かめる → 書く → 履歴。記録を足す・取り消す・認める操作と、同時には行われない）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { isAllowanceAdmin } from '@/lib/allowances';
import { actorOf, closeAllowanceMonth, reopenAllowanceMonth } from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

/** { month: string, action: 'close' | 'reopen' } のときだけ、その中身を返す。違えば null（月の形は、締める関数が確かめる） */
function parseBody(value: unknown): { month: string; action: 'close' | 'reopen' } | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const { month, action } = value as Record<string, unknown>;
    if (typeof month !== 'string') return null;
    if (action !== 'close' && action !== 'reopen') return null;
    return { month, action };
}

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const body = parseBody(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');

        if (body.action === 'close') {
            const result = await closeAllowanceMonth(actor, body.month);
            if (!result.ok) {
                if (result.reason === 'has_pending') {
                    return errorResponse(`確認待ちが${result.pendingCount}件あります。認めるか取り消してから締めてください`, 400);
                }
                if (result.reason === 'invalid_month') return validationErrorResponse('月が不正です');
                if (result.reason === 'not_ended') return errorResponse('まだ終わっていない月は締められません', 400);
                return errorResponse('この月は、すでに締めてあります', 400);
            }
            return NextResponse.json(
                { ok: true, month: body.month, closed: { closedByName: actor.name, closedAt: result.closedAt.toISOString() } },
                NO_STORE,
            );
        }

        const result = await reopenAllowanceMonth(actor, body.month);
        if (!result.ok) {
            if (result.reason === 'invalid_month') return validationErrorResponse('月が不正です');
            return errorResponse('この月は締めていません', 400);
        }
        return NextResponse.json({ ok: true, month: body.month, closed: null }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の月の締め', err);
    }
}
