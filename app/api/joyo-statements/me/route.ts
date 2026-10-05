/**
 * 支払明細書: 本人の画面（常用の一人親方が、自分の明細書だけを見る）。
 *
 *   GET /api/joyo-statements/me   ログインしている人で、支払明細書の対象者として登録されている人だけ。
 *
 * 返すのは、自分の「発行済み」（status='issued' で写し issuedSnapshot がある）の明細だけ（全部の月・対象月の新しい順）。
 *  - だれの分かは、必ずセッションの id から決める。クエリ・ボディの userId・contractorId は読まない（付いていても無視）
 *  - 対象者の行が無ければ 403（admin でも。admin は管理者の画面を使う）
 *  - 社内メモ・支払予定・出勤簿の日数・単価・振込先・ほかの人の情報は返さない（lib/joyoStatementServer.ts の toMyStatementDto）
 */
import { NextResponse } from 'next/server';
import { errorResponse, requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { loadMyJoyoStatements } from '@/lib/joyoStatementServer';
import type { JoyoMyStatementsResponse } from '@/types/joyoStatement';

export const dynamic = 'force-dynamic';

const NOT_CONTRACTOR = '支払明細書の対象者として登録されていません';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const userId = session!.user.id;
        if (!userId) return errorResponse(NOT_CONTRACTOR, 403);

        const statements = await loadMyJoyoStatements(userId);
        if (statements === null) return errorResponse(NOT_CONTRACTOR, 403);

        const body: JoyoMyStatementsResponse = { userId, statements };
        return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('支払明細書（本人）の取得', err);
    }
}
