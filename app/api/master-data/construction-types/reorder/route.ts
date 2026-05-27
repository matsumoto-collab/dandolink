import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

/**
 * PUT /api/master-data/construction-types/reorder
 * body: { ids: string[] } — 並び順に並んだ ID 配列
 *
 * 受け取った順序で sortOrder を 0..N-1 で振り直す。
 * 一覧表示は sortOrder asc なので、これでそのまま反映される。
 */
export async function PUT(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const body = await request.json();
        const ids = body?.ids;
        if (!Array.isArray(ids) || ids.some((v) => typeof v !== 'string')) {
            return validationErrorResponse('ids は string[] が必要です');
        }
        if (ids.length === 0) {
            return NextResponse.json({ success: true, updated: 0 });
        }
        // 同一トランザクションで一括 update（途中失敗時は全件ロールバック）
        await prisma.$transaction(
            ids.map((id, index) =>
                prisma.constructionType.update({
                    where: { id },
                    data: { sortOrder: index },
                })
            )
        );
        return NextResponse.json({ success: true, updated: ids.length });
    } catch (err) {
        return serverErrorResponse('工事種別並び替え', err);
    }
}
