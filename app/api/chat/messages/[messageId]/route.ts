import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, notFoundResponse } from '@/lib/api/utils';

const EDIT_WINDOW_MS = 5 * 60 * 1000;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { messageId } = await params;
        const userId = session!.user.id;

        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!msg) return notFoundResponse('メッセージ');
        if (msg.senderId !== userId) return errorResponse('編集できるのは送信者のみです', 403);
        if (msg.deletedAt) return errorResponse('削除済みのメッセージは編集できません', 400);
        if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) {
            return errorResponse('送信から5分を超えたメッセージは編集できません', 400);
        }

        const body = await req.json();
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (!text) return errorResponse('本文は必須です', 400);

        const updated = await prisma.message.update({
            where: { id: messageId },
            data: { body: text, editedAt: new Date() },
            include: { mentions: true, attachments: true, reads: true },
        });
        return NextResponse.json({ message: updated });
    } catch (error) {
        return serverErrorResponse('メッセージ編集', error);
    }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { messageId } = await params;
        const userId = session!.user.id;

        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!msg) return notFoundResponse('メッセージ');
        if (msg.senderId !== userId && session!.user.role !== 'admin') {
            return errorResponse('削除できるのは送信者または管理者のみです', 403);
        }

        await prisma.message.update({
            where: { id: messageId },
            data: { deletedAt: new Date(), body: '(削除されたメッセージ)' },
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        return serverErrorResponse('メッセージ削除', error);
    }
}
