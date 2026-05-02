import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, notFoundResponse, errorResponse } from '@/lib/api/utils';

async function ensureMember(roomId: string, userId: string) {
    const m = await prisma.chatMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
    });
    return m && !m.leftAt ? m : null;
}

/**
 * GET /api/chat/rooms/[roomId]
 * ルーム詳細＋メンバー情報
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { roomId } = await params;
        const userId = session!.user.id;

        const member = await ensureMember(roomId, userId);
        if (!member) return errorResponse('このルームにアクセスする権限がありません', 403);

        const room = await prisma.chatRoom.findUnique({
            where: { id: roomId },
            include: { members: { where: { leftAt: null } } },
        });
        if (!room) return notFoundResponse('チャットルーム');

        const userIds = room.members.map((m) => m.userId);
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true, role: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        return NextResponse.json(
            {
                room: {
                    id: room.id,
                    type: room.type,
                    name: room.name,
                    projectMasterId: room.projectMasterId,
                    isArchived: room.isArchived,
                    members: room.members.map((m) => ({
                        userId: m.userId,
                        role: m.role,
                        isMuted: m.isMuted,
                        displayName: userMap.get(m.userId)?.displayName ?? '(不明)',
                        userRole: userMap.get(m.userId)?.role ?? null,
                    })),
                },
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('チャットルーム取得', error);
    }
}

/**
 * PATCH /api/chat/rooms/[roomId]
 * body: { name?, isArchived?, isMuted?, isPinned?, addMemberIds?, removeMemberIds? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { roomId } = await params;
        const userId = session!.user.id;

        const member = await ensureMember(roomId, userId);
        if (!member) return errorResponse('権限がありません', 403);

        const body = await req.json();

        // 自分のメンバー設定（mute/pin）はいつでも可
        const memberPatch: { isMuted?: boolean; isPinned?: boolean } = {};
        if (typeof body.isMuted === 'boolean') memberPatch.isMuted = body.isMuted;
        if (typeof body.isPinned === 'boolean') memberPatch.isPinned = body.isPinned;
        if (Object.keys(memberPatch).length > 0) {
            await prisma.chatMember.update({
                where: { roomId_userId: { roomId, userId } },
                data: memberPatch,
            });
        }

        // ルーム自体の更新は owner のみ
        const roomPatch: { name?: string | null; isArchived?: boolean } = {};
        if (typeof body.name === 'string') roomPatch.name = body.name.trim() || null;
        if (typeof body.isArchived === 'boolean') roomPatch.isArchived = body.isArchived;

        if (Object.keys(roomPatch).length > 0) {
            if (member.role !== 'owner') {
                return errorResponse('ルーム編集はオーナーのみ可能です', 403);
            }
            await prisma.chatRoom.update({ where: { id: roomId }, data: roomPatch });
        }

        // ルーム種別の取得（DMはメンバー追加不可）
        const roomMeta = await prisma.chatRoom.findUnique({
            where: { id: roomId },
            select: { type: true },
        });

        // メンバー追加: グループ/案件は参加メンバー誰でも可能
        if (Array.isArray(body.addMemberIds) && body.addMemberIds.length > 0) {
            if (roomMeta?.type === 'dm') {
                return errorResponse('DMにはメンバーを追加できません', 400);
            }
            await prisma.$transaction(
                (body.addMemberIds as string[]).map((id) =>
                    prisma.chatMember.upsert({
                        where: { roomId_userId: { roomId, userId: id } },
                        create: { roomId, userId: id, role: 'member' },
                        update: { leftAt: null },
                    })
                )
            );
        }
        // メンバー削除: オーナーのみ。自分自身（退室）はメンバー誰でも可
        if (Array.isArray(body.removeMemberIds) && body.removeMemberIds.length > 0) {
            const removeIds = body.removeMemberIds as string[];
            const isSelfOnly = removeIds.length === 1 && removeIds[0] === userId;
            if (!isSelfOnly && member.role !== 'owner') {
                return errorResponse('メンバー削除はオーナーのみ可能です', 403);
            }
            await prisma.chatMember.updateMany({
                where: { roomId, userId: { in: removeIds } },
                data: { leftAt: new Date() },
            });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        return serverErrorResponse('チャットルーム更新', error);
    }
}
