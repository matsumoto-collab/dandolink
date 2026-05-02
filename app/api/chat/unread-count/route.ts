import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

/**
 * GET /api/chat/unread-count
 * サイドバー集約用: 全ルーム合算の未読数（mute除く）
 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const userId = session!.user.id;

        const memberships = await prisma.chatMember.findMany({
            where: { userId, leftAt: null, isMuted: false },
            select: { roomId: true, lastReadAt: true },
        });

        let total = 0;
        for (const m of memberships) {
            const c = await prisma.message.count({
                where: {
                    roomId: m.roomId,
                    senderId: { not: userId },
                    deletedAt: null,
                    ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
                },
            });
            total += c;
        }

        return NextResponse.json({ unreadCount: total }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('未読数取得', error);
    }
}
