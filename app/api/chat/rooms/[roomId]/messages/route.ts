import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, validationErrorResponse } from '@/lib/api/utils';
import { notifyUsers } from '@/lib/notifications';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const SIGNED_URL_TTL = 3600;
const SIGNED_URL_BUFFER_MS = 5 * 60 * 1000;

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
                reactions: { select: { id: true, userId: true, emoji: true } },
            },
        });
        const hasMore = rows.length > limit;
        const items = (hasMore ? rows.slice(0, limit) : rows).reverse(); // 古い順で返却

        // 添付の signedUrl 期限チェック → 期限間近は再生成して DB 更新
        const now = new Date();
        await Promise.all(
            items.flatMap((m) =>
                m.attachments.map(async (att) => {
                    const updates: Record<string, unknown> = {};
                    const mainExpired = !att.signedUrl || !att.signedUrlExpiresAt
                        || att.signedUrlExpiresAt.getTime() - now.getTime() < SIGNED_URL_BUFFER_MS;
                    if (mainExpired && att.storagePath) {
                        try {
                            const { data } = await supabaseAdmin.storage
                                .from(STORAGE_BUCKET)
                                .createSignedUrl(att.storagePath, SIGNED_URL_TTL);
                            if (data?.signedUrl) {
                                att.signedUrl = data.signedUrl;
                                att.signedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
                                updates.signedUrl = att.signedUrl;
                                updates.signedUrlExpiresAt = att.signedUrlExpiresAt;
                            }
                        } catch (e) {
                            logger.error('[chat] sign main', e);
                        }
                    }
                    if (att.thumbnailPath) {
                        const thumbExpired = !att.thumbnailSignedUrl || !att.thumbnailSignedUrlExpiresAt
                            || att.thumbnailSignedUrlExpiresAt.getTime() - now.getTime() < SIGNED_URL_BUFFER_MS;
                        if (thumbExpired) {
                            try {
                                const { data } = await supabaseAdmin.storage
                                    .from(STORAGE_BUCKET)
                                    .createSignedUrl(att.thumbnailPath, SIGNED_URL_TTL);
                                if (data?.signedUrl) {
                                    att.thumbnailSignedUrl = data.signedUrl;
                                    att.thumbnailSignedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
                                    updates.thumbnailSignedUrl = att.thumbnailSignedUrl;
                                    updates.thumbnailSignedUrlExpiresAt = att.thumbnailSignedUrlExpiresAt;
                                }
                            } catch (e) {
                                logger.error('[chat] sign thumb', e);
                            }
                        }
                    }
                    if (Object.keys(updates).length > 0) {
                        await prisma.messageAttachment.update({
                            where: { id: att.id },
                            data: updates,
                        }).catch(() => { /* noop */ });
                    }
                })
            )
        );

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
        const attachments = Array.isArray(body.attachments) ? body.attachments : [];
        if (!text && attachments.length === 0) {
            return validationErrorResponse('メッセージ本文または添付ファイルが必要です');
        }
        if (text.length > MESSAGE_MAX_LENGTH) {
            return validationErrorResponse(`メッセージは${MESSAGE_MAX_LENGTH}文字以内で入力してください`);
        }

        const contentType = typeof body.contentType === 'string' ? body.contentType : 'text';
        const parentId = typeof body.parentId === 'string' ? body.parentId : null;
        const mentions = Array.isArray(body.mentions) ? body.mentions : [];

        const previewBase = text || (attachments.length > 0
            ? attachments.some((a: { fileType?: unknown }) => (a as { fileType?: string }).fileType === 'image')
                ? '📷 画像'
                : '📎 添付ファイル'
            : '');
        const preview = previewBase.length > 80 ? previewBase.slice(0, 80) + '…' : previewBase;
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
                    attachments: attachments.length
                        ? {
                            create: attachments
                                .filter(
                                    (a: unknown): a is {
                                        fileType: string; storagePath: string; mimeType: string; fileSize: number;
                                        thumbnailPath?: string | null; signedUrl?: string | null;
                                        signedUrlExpiresAt?: string | null; thumbnailSignedUrl?: string | null;
                                        thumbnailSignedUrlExpiresAt?: string | null;
                                        width?: number | null; height?: number | null;
                                    } =>
                                        !!a &&
                                        typeof (a as { fileType?: unknown }).fileType === 'string' &&
                                        typeof (a as { storagePath?: unknown }).storagePath === 'string' &&
                                        typeof (a as { mimeType?: unknown }).mimeType === 'string' &&
                                        typeof (a as { fileSize?: unknown }).fileSize === 'number'
                                )
                                .map((a: {
                                    fileType: string; storagePath: string; mimeType: string; fileSize: number;
                                    thumbnailPath?: string | null; signedUrl?: string | null;
                                    signedUrlExpiresAt?: string | null; thumbnailSignedUrl?: string | null;
                                    thumbnailSignedUrlExpiresAt?: string | null;
                                    width?: number | null; height?: number | null;
                                }) => ({
                                    fileType: a.fileType,
                                    storagePath: a.storagePath,
                                    thumbnailPath: a.thumbnailPath ?? null,
                                    signedUrl: a.signedUrl ?? null,
                                    signedUrlExpiresAt: a.signedUrlExpiresAt ? new Date(a.signedUrlExpiresAt) : null,
                                    thumbnailSignedUrl: a.thumbnailSignedUrl ?? null,
                                    thumbnailSignedUrlExpiresAt: a.thumbnailSignedUrlExpiresAt
                                        ? new Date(a.thumbnailSignedUrlExpiresAt) : null,
                                    mimeType: a.mimeType,
                                    fileSize: a.fileSize,
                                    width: a.width ?? null,
                                    height: a.height ?? null,
                                })),
                        }
                        : undefined,
                },
                include: { mentions: true, attachments: true, reads: true, reactions: true },
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

        // 通知対象: そのチャットルームの参加メンバーのみ（送信者・mute・離脱除く）
        // ロール/案件メンションは表示・拡散ロジック上の意味は持つが、通知は
        // チャット参加者に限定（外部の人を勝手に巻き込まない方針）
        const otherMembers = await prisma.chatMember.findMany({
            where: {
                roomId,
                userId: { not: userId },
                leftAt: null,
                isMuted: false,
            },
            select: { userId: true },
        });
        const targetUserIds = Array.from(
            new Set(otherMembers.map((m) => m.userId).filter((id) => id && id !== userId))
        );

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
