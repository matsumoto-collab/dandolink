import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, notFoundResponse, validationErrorResponse } from '@/lib/api/utils';
import { isReactionEmoji } from '@/lib/chat/reactions';

/**
 * POST /api/chat/messages/[messageId]/reactions
 * body: { emoji: string }
 *
 * LINE方式（1ユーザー1メッセージにつき1種類）のトグル:
 * - 同じ絵文字が既にあれば解除（removed）
 * - 別の絵文字があれば付け替え、無ければ新規（set）
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { messageId } = await params;
        const userId = session!.user.id;

        const body = await req.json();
        const emoji = typeof body.emoji === 'string' ? body.emoji : '';
        if (!isReactionEmoji(emoji)) {
            return validationErrorResponse('使用できない絵文字です');
        }

        const msg = await prisma.message.findUnique({
            where: { id: messageId },
            select: { roomId: true, deletedAt: true },
        });
        if (!msg) return notFoundResponse('メッセージ');
        if (msg.deletedAt) return errorResponse('取り消されたメッセージにはリアクションできません', 400);

        // ルームメンバーであること
        const member = await prisma.chatMember.findUnique({
            where: { roomId_userId: { roomId: msg.roomId, userId } },
        });
        if (!member || member.leftAt) return errorResponse('権限がありません', 403);

        const existing = await prisma.messageReaction.findUnique({
            where: { messageId_userId: { messageId, userId } },
        });

        let action: 'set' | 'removed';
        if (existing && existing.emoji === emoji) {
            await prisma.messageReaction.delete({
                where: { messageId_userId: { messageId, userId } },
            });
            action = 'removed';
        } else {
            await prisma.messageReaction.upsert({
                where: { messageId_userId: { messageId, userId } },
                create: { messageId, userId, emoji },
                update: { emoji },
            });
            action = 'set';
        }

        const reactions = await prisma.messageReaction.findMany({
            where: { messageId },
            select: { id: true, userId: true, emoji: true },
        });

        return NextResponse.json({ action, roomId: msg.roomId, reactions });
    } catch (error) {
        return serverErrorResponse('リアクション更新', error);
    }
}
