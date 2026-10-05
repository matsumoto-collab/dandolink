/**
 * 支払明細書: 画面の見せ方。
 *
 *   GET /api/joyo-statements/access   ログインしている人ならだれでも。{ mode: 'admin' | 'member' | 'none' }
 *
 * 見せ方は lib/joyoStatementServer.ts の resolveJoyoAccessMode() で決める（ここに決まりを書き直さない）。
 * だれの分かは、必ずセッションの id から決める（クエリ・ボディは読まない）。
 * メニュー（hooks/useJoyoStatementAccess.ts）が、manager・職長・作業員のときにだけ読む。
 */
import { NextResponse } from 'next/server';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { resolveJoyoAccessMode } from '@/lib/joyoStatementServer';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const mode = await resolveJoyoAccessMode(session!.user.role, session!.user.id);
        return NextResponse.json({ mode }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('支払明細書の表示の設定の取得', err);
    }
}
