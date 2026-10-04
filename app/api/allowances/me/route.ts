/**
 * 手当: 本人の、その月の手当（docs/指示書_大規模手当.md の 6-7。共通の決まりは 6-0）。
 *
 *   GET /api/allowances/me?month=YYYY-MM   月は必須
 *
 * だれ: resolveAllowanceAccessMode() が 'manager' か 'member' の人。'none'（公開の設定がオフの職長・作業員など）は 403。
 * 返すのは、ログインしている本人の記録だけ。userId は必ずセッションから取る（クエリやボディで受け取らない）。
 * 付けた人の名前・メモは返さない。中身は lib/allowancesReport.ts の loadMyAllowance()。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { actorOf, resolveAllowanceAccessMode } from '@/lib/allowancesServer';
import { NO_STORE, loadMyAllowance } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        const mode = await resolveAllowanceAccessMode(actor.role);
        // ID の入っていないセッションも断る（空の ID で読むと、本人の分に絞れない）
        if (mode === 'none' || !actor.id) return errorResponse('権限がありません', 403);

        const month = new URL(req.url).searchParams.get('month');
        if (month === null) return validationErrorResponse('入力が不正です');
        // 本人の分だけ（セッションの ID）
        const mine = await loadMyAllowance(actor.id, month);
        if (!mine) return validationErrorResponse('月が不正です');

        return NextResponse.json(mine, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の取得', err);
    }
}
