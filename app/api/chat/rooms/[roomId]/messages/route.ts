import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, validationErrorResponse } from '@/lib/api/utils';
import { notifyUsers } from '@/lib/notifications';

const MESSAGE_MAX_LENGTH = 4000;

/**
 * GET /api/chat/rooms/[roomId]/messages?before=msgId&limit=50
 * カーソルページング（新しい順 → 古い順にスクロール）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { roomId } = await params;
        const userId = session!.user.id;

        const member = await prisma.chatMember.findUnique({
            where: { roomId_userId: { roomId, userId } },
        });
        if (!member || member.leftAt) return errorResponse('権限がありません', 403);

        const { searchParams } = new URL(req.url);
        const before = searchParams.get('before');
        const limitParam = Number(searchParams.get('limit') || 50);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;

        let beforeDate: Date | undefined;
        if (before) {
            const anchor = await prisma.message.findUnique({
                where: { id: before },
                select: { createdAt: true },
            });
            beforeDate = anchor?.createdAt;
        }

        const rows = await prisma.message.findMany({
            where: {
                roomId,
                ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            include: {
                mentions: true,
                attachments: true,
                reads: { select: { userId: true, readAt: true } },
            },
        });
        const hasMore = rows.length > limit;
        const items = (hasMore ? rows.slice(0, limit) : rows).reverse(); // 古い順で返却

        return NextResponse.json(
            { items, hasMore },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('メッセージ取得', error);
    }
}

/**
 * POST /api/chat/rooms/[roomId]/messages
 * body: { body: string, contentType?: string, parentId?: string, mentions?: {targetType, targetId}[] }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { roomId } = await params;
        const userId = session!.user.id;
        const senderName = session!.user.name || '';

        const member = await prisma.chatMember.findUnique({
            where: { roomId_userId: { roomId, userId } },
        });
        if (!member || member.leftAt) return errorResponse('権限がありません', 403);

        const body = await req.json();
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (!text) return validationErrorResponse('メッセージ本文は必須です');
        if (text.length > MESSAGE_MAX_LENGTH) {
            return validationErrorResponse(`メッセージは${MESSAGE_MAX_LENGTH}文字以内で入力してください`);
        }

        const contentType = typeof body.contentType === 'string' ? body.contentType : 'text';
        const parentId = typeof body.parentId === 'string' ? body.parentId : null;
        const mentions = Array.isArray(body.mentions) ? body.mentions : [];

        const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
        const now = new Date();

        const message = await prisma.$transaction(async (tx) => {
            const msg = await tx.message.create({
                data: {
                    roomId,
                    senderId: userId,
                    body: text,
                    contentType,
                    parentId,
                    createdAt: now,
                    mentions: mentions.length
                        ? {
                            create: mentions
                                .filter(
                                    (m: unknown): m is { targetType: string; targetId: string; label?: string } =>
                                        !!m &&
                                        typeof (m as { targetType?: unknown }).targetType === 'string' &&
                                        typeof (m as { targetId?: unknown }).targetId === 'string'
                                )
                                .map((m: { targetType: string; targetId: string; label?: string }) => ({
                                    targetType: m.targetType,
                                    targetId: m.targetId,
                                    label: typeof m.label === 'string' ? m.label : null,
                                })),
                        }
                        : undefined,
                },
                include: { mentions: true, attachments: true, reads: true },
            });
            await tx.chatRoom.update({
                where: { id: roomId },
                data: { lastMessageAt: now, lastMessagePreview: preview },
            });
            // 送信者は自動既読
            await tx.chatMember.update({
                where: { roomId_userId: { roomId, userId } },
                data: { lastReadAt: now, lastReadMessageId: msg.id },
            });
            return msg;
        });

        // 通知対象（送信者除く・mute除く・離脱除く）
        const otherMembers = await prisma.chatMember.findMany({
            where: {
                roomId,
                userId: { not: userId },
                leftAt: null,
                isMuted: false,
            },
            select: { userId: true },
        });
        const targetUserIds = otherMembers.map((m) => m.userId);

        // ロールメンション拡散（@[role:...](admin,manager) のような token を targetType='role' で正規化済み）
        const roleMentions = mentions.filter(
            (m: unknown): m is { targetType: string; targetId: string } =>
                !!m && (m as { targetType?: unknown }).targetType === 'role'
        );
        if (roleMentions.length > 0) {
            const roles: string[] = Array.from(
                new Set(
                    roleMentions.flatMap((rm: { targetType: string; targetId: string }) =>
                        String(rm.targetId).split(',').map((r) => r.trim()).filter(Boolean)
                    )
                )
            );
            if (roles.length > 0) {
                const roleUsers = await prisma.user.findMany({
                    where: { role: { in: roles }, isActive: true, id: { not: userId } },
                    select: { id: true },
                });
                roleUsers.forEach((u) => {
                    if (!targetUserIds.includes(u.id)) targetUserIds.push(u.id);
                });
            }
        }

        // 案件メンション拡散: その案件の手配確定メンバー＋managerIdsへ通知
        const projectMentions = mentions.filter(
            (m: unknown): m is { targetType: string; targetId: string } =>
                !!m && (m as { targetType?: unknown }).targetType === 'project'
        );
        if (projectMentions.length > 0) {
            const projectIds: string[] = Array.from(
                new Set(projectMentions.map((p: { targetType: string; targetId: string }) => p.targetId).filter(Boolean))
            );
            const pmRows = await prisma.projectMaster.findMany({
                where: { id: { in: projectIds } },
                select: { managerIds: true },
            });
            pmRows.forEach((pm) => {
                (pm.managerIds || []).forEach((id) => {
                    if (id !== userId && !targetUserIds.includes(id)) targetUserIds.push(id);
                });
            });
            const pmAssignments = await prisma.projectAssignment.findMany({
                where: { projectMasterId: { in: projectIds } },
                select: { confirmedWorkerIds: true, assignedEmployeeId: true },
            });
            for (const a of pmAssignments) {
                if (a.assignedEmployeeId && a.assignedEmployeeId !== userId && !targetUserIds.includes(a.assignedEmployeeId)) {
                    targetUserIds.push(a.assignedEmployeeId);
                }
                if (a.confirmedWorkerIds) {
                    try {
                        const ids = JSON.parse(a.confirmedWorkerIds);
                        if (Array.isArray(ids)) {
                            ids.forEach((id) => {
                                if (typeof id === 'string' && id !== userId && !targetUserIds.includes(id)) {
                                    targetUserIds.push(id);
                                }
                            });
                        }
                    } catch { /* noop */ }
                }
            }
        }

        if (targetUserIds.length > 0) {
            const room = await prisma.chatRoom.findUnique({
                where: { id: roomId },
                select: { type: true, name: true },
            });
            const title =
                room?.type === 'dm'
                    ? senderName || 'メッセージ'
                    : room?.name
                        ? `${room.name}（${senderName}）`
                        : `${senderName}`;
            await notifyUsers({
                userIds: targetUserIds,
                type: 'chat-message',
                title,
                body: preview,
                url: `/?page=chat&roomId=${roomId}`,
                pushTag: `chat-${roomId}`,
                data: { roomId, messageId: message.id },
            });
        }

        return NextResponse.json({ message });
    } catch (error) {
        return serverErrorResponse('メッセージ送信', error);
    }
}
