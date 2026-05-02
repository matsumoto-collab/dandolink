import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse } from '@/lib/api/utils';

/**
 * POST /api/chat/rooms/[roomId]/read
 * body: { messageId?: string }  指定なしならルームの最新メッセージまで既読
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { roomId } = await params;
        const userId = session!.user.id;

        const member = await prisma.chatMember.findUnique({
            where: { roomId_userId: { roomId, userId } },
        });
        if (!member || member.leftAt) return errorResponse('権限がありません', 403);

        const body = await req.json().catch(() => ({}));
        let messageId: string | null = typeof body?.messageId === 'string' ? body.messageId : null;
        let readAt = new Date();

        if (!messageId) {
            const latest = await prisma.message.findFirst({
                where: { roomId },
                orderBy: { createdAt: 'desc' },
                select: { id: true, createdAt: true },
            });
            if (!latest) return NextResponse.json({ ok: true });
            messageId = latest.id;
            readAt = latest.createdAt;
        } else {
            const target = await prisma.message.findUnique({
                where: { id: messageId },
                select: { roomId: true, createdAt: true },
            });
            if (!target || target.roomId !== roomId) {
                return errorResponse('対象メッセージが不正です', 400);
            }
            readAt = target.createdAt;
        }

        await prisma.chatMember.update({
            where: { roomId_userId: { roomId, userId } },
            data: { lastReadAt: readAt, lastReadMessageId: messageId },
        });

        // 厳密既読（誰がどこまで読んだか）— 直近100件まで
        const recents = await prisma.message.findMany({
            where: { roomId, createdAt: { lte: readAt }, senderId: { not: userId } },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: { id: true },
        });
        if (recents.length > 0) {
            await prisma.$transaction(
                recents.map((m) =>
                    prisma.messageRead.upsert({
                        where: { messageId_userId: { messageId: m.id, userId } },
                        create: { messageId: m.id, userId },
                        update: {},
                    })
                )
            );
        }

        return NextResponse.json({ ok: true, messageId });
    } catch (error) {
        return serverErrorResponse('既読更新', error);
    }
}
