import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { okResponse, requireJoyoAdmin } from '../_shared';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/joyo-statements/[id]
 * 一度も発行していない下書きだけを消す（admin 限定）。
 * 一度でも発行した明細（書類番号が入っている）は、渡したかもしれない書類を跡形なく消さないため消せない（3-3）。
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { error } = await requireJoyoAdmin();
        if (error) return error;

        const statement = await prisma.joyoStatement.findUnique({
            where: { id: params.id },
            select: { id: true, status: true, statementNo: true },
        });
        if (!statement) return notFoundResponse('支払明細書');
        if (statement.status === 'issued') return errorResponse('発行済みの明細は消せません', 400);
        if (statement.statementNo) {
            return errorResponse('一度発行した明細は消せません。直してもう一度発行してください', 400);
        }

        // 確かめてから消すまでのあいだに発行された場合は消さない（条件つきで消して件数を見る）
        const deleted = await prisma.joyoStatement.deleteMany({
            where: { id: statement.id, status: 'draft', statementNo: null },
        });
        if (deleted.count !== 1) {
            return errorResponse('明細の状態が変わりました。画面を開き直してください', 400);
        }

        return okResponse(statement.id);
    } catch (error) {
        return serverErrorResponse('支払明細書の削除', error);
    }
}
