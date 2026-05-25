import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
} from '@/lib/api/utils';

interface RouteContext {
    params: Promise<{ id: string; replyId: string }>;
}

/**
 * DELETE /api/assignments/[id]/work-status/replies/[replyId]
 * 返信を削除する。投稿者本人 または admin/manager のみ可。
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id, replyId } = await context.params;

        const reply = await prisma.workReportReply.findUnique({
            where: { id: replyId },
            select: { id: true, assignmentId: true, authorId: true },
        });
        if (!reply) return notFoundResponse('返信');
        if (reply.assignmentId !== id) {
            return errorResponse('指定された配置に紐づかない返信です', 400);
        }

        const role = session!.user.role;
        const isManager = role === 'admin' || role === 'manager';
        const isAuthor = reply.authorId === session!.user.id;
        if (!isManager && !isAuthor) {
            return errorResponse('この返信を削除する権限がありません', 403);
        }

        await prisma.workReportReply.delete({ where: { id: replyId } });

        return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('返信削除', error);
    }
}
