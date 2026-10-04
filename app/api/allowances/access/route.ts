/**
 * 手当: 「手当」の画面の見せ方（docs/指示書_大規模手当.md の 6-7。共通の決まりは 6-0）。
 *
 *   GET /api/allowances/access   ログインしている人ならだれでも。{ mode: 'manager' | 'member' | 'none' }
 *
 * 見せ方は lib/allowancesServer.ts の resolveAllowanceAccessMode() で決める（ここに決まりを書き直さない）。
 * メニュー（hooks/useAllowanceAccess.ts）が、職長・作業員のときにだけ読む。
 */
import { NextResponse } from 'next/server';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { actorOf, resolveAllowanceAccessMode } from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        const mode = await resolveAllowanceAccessMode(actor.role);
        return NextResponse.json({ mode }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の表示の設定の取得', err);
    }
}
