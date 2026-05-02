import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';

/**
 * GET /api/chat/rooms
 * 自分が参加しているチャットルーム一覧（最終メッセージ・未読数つき）
 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const userId = session!.user.id;

        const memberships = await prisma.chatMember.findMany({
            where: { userId, leftAt: null },
            include: {
                room: {
                    include: {
                        members: {
                            where: { leftAt: null },
                            select: {
                                userId: true,
                                role: true,
                                isMuted: true,
                                lastReadAt: true,
                            },
                        },
                    },
                },
            },
        });

        const userIds = Array.from(
            new Set(memberships.flatMap((m) => m.room.members.map((mm) => mm.userId)))
        );
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true, role: true, isActive: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        const rooms = await Promise.all(
            memberships.map(async (m) => {
                const unreadCount = await prisma.message.count({
                    where: {
                        roomId: m.roomId,
                        senderId: { not: userId },
                        deletedAt: null,
                        ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
                    },
                });
                return {
                    id: m.room.id,
                    type: m.room.type,
                    name: m.room.name,
                    projectMasterId: m.room.projectMasterId,
                    lastMessageAt: m.room.lastMessageAt,
                    lastMessagePreview: m.room.lastMessagePreview,
                    isArchived: m.room.isArchived,
                    isMuted: m.isMuted,
                    isPinned: m.isPinned,
                    unreadCount,
                    members: m.room.members.map((mm) => ({
                        userId: mm.userId,
                        role: mm.role,
                        displayName: userMap.get(mm.userId)?.displayName ?? '(不明)',
                        userRole: userMap.get(mm.userId)?.role ?? null,
                    })),
                };
            })
        );

        rooms.sort((a, b) => {
            const ta = a.lastMessageAt?.getTime() ?? 0;
            const tb = b.lastMessageAt?.getTime() ?? 0;
            return tb - ta;
        });

        return NextResponse.json({ rooms }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('チャットルーム一覧取得', error);
    }
}

/**
 * POST /api/chat/rooms
 * body: { type: 'dm'|'group', memberIds: string[], name?: string }
 * - dm: 2人指定（自分含む）。同じペアがあれば既存を返す（冪等）
 * - group: 自分含む複数。常に新規作成
 */
export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const userId = session!.user.id;

        const body = await request.json();
        const type = body.type as string;
        const memberIds = Array.isArray(body.memberIds) ? (body.memberIds as string[]) : [];
        const name = typeof body.name === 'string' ? body.name.trim() : null;

        if (type !== 'dm' && type !== 'group') {
            return validationErrorResponse('typeはdmまたはgroupを指定してください');
        }

        const allMemberIds = Array.from(new Set([userId, ...memberIds.filter(Boolean)]));
        if (type === 'dm' && allMemberIds.length !== 2) {
            return validationErrorResponse('DMは相手1名を指定してください');
        }
        if (type === 'group' && allMemberIds.length < 2) {
            return validationErrorResponse('グループは2名以上で作成してください');
        }

        // DMは冪等: 既存のDMルームを検索
        if (type === 'dm') {
            const candidate = await prisma.chatRoom.findFirst({
                where: {
                    type: 'dm',
                    members: { every: { userId: { in: allMemberIds }, leftAt: null } },
                },
                include: { members: true },
            });
            if (
                candidate &&
                candidate.members.length === 2 &&
                allMemberIds.every((id) => candidate.members.some((m) => m.userId === id))
            ) {
                return NextResponse.json({ roomId: candidate.id, existing: true });
            }
        }

        const room = await prisma.chatRoom.create({
            data: {
                type,
                name,
                createdBy: userId,
                members: {
                    create: allMemberIds.map((id) => ({
                        userId: id,
                        role: id === userId ? 'owner' : 'member',
                    })),
                },
            },
        });

        return NextResponse.json({ roomId: room.id, existing: false });
    } catch (error) {
        return serverErrorResponse('チャットルーム作成', error);
    }
}
