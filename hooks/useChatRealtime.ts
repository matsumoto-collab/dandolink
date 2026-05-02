import { useEffect } from 'react';
import { useRealtimeSubscription, type RealtimePayload } from './useRealtimeSubscription';
import { useChatStore } from '@/stores/chatStore';
import { onBroadcast } from '@/lib/broadcastChannel';
import type { ChatMessage } from '@/types/chat';
import { logger } from '@/lib/logger';

/**
 * アクティブルームのメッセージ Realtime 購読 + ルーム一覧の未読更新。
 * INSERT は単件差分更新、その他（UPDATE/DELETE）はルーム再取得。
 */
export function useChatRealtime(roomId: string | null) {
    const fetchMessages = useChatStore((s) => s.fetchMessages);
    const fetchRooms = useChatStore((s) => s.fetchRooms);
    const upsertMessage = useChatStore((s) => s.upsertMessage);

    useRealtimeSubscription({
        table: 'Message',
        channelName: roomId ? `chat-room-${roomId}` : 'chat-room-disabled',
        enabled: !!roomId,
        debounceMs: 500,
        onDataChange: (payload: RealtimePayload) => {
            try {
                if (!roomId) return;
                const newRow = payload.new as Record<string, unknown> | undefined;
                const oldRow = payload.old as Record<string, unknown> | undefined;
                const targetRoom =
                    (newRow?.roomId as string | undefined) ||
                    (oldRow?.roomId as string | undefined);
                if (targetRoom !== roomId) return;
                if (payload.eventType === 'INSERT' && newRow) {
                    const msg: ChatMessage = {
                        id: newRow.id as string,
                        roomId: newRow.roomId as string,
                        senderId: newRow.senderId as string,
                        body: (newRow.body as string) ?? '',
                        contentType: (newRow.contentType as string) ?? 'text',
                        parentId: (newRow.parentId as string | null) ?? null,
                        editedAt: (newRow.editedAt as string | null) ?? null,
                        deletedAt: (newRow.deletedAt as string | null) ?? null,
                        createdAt: (newRow.createdAt as string) ?? new Date().toISOString(),
                        mentions: [],
                        attachments: [],
                        reads: [],
                    };
                    upsertMessage(msg);
                } else {
                    // UPDATE/DELETE は安全のためルーム単位でリフェッチ
                    fetchMessages(roomId);
                }
                fetchRooms();
            } catch (e) {
                logger.error('[chat] realtime payload error', e);
            }
        },
    });

    // 別端末broadcast受信
    useEffect(() => {
        if (!roomId) return;
        const off = onBroadcast('chat:new-message', (payload) => {
            if ((payload as { roomId?: string }).roomId === roomId) {
                fetchMessages(roomId);
            }
            fetchRooms();
        });
        return off;
    }, [roomId, fetchMessages, fetchRooms]);
}

/**
 * グローバル: ルーム一覧と未読バッジの更新（任意のMessage INSERTで再取得）
 */
export function useChatRoomsRealtime(enabled: boolean) {
    const fetchRooms = useChatStore((s) => s.fetchRooms);
    const fetchUnreadCount = useChatStore((s) => s.fetchUnreadCount);

    useRealtimeSubscription({
        table: 'Message',
        channelName: 'chat-rooms-global',
        enabled,
        debounceMs: 500,
        onDataChange: () => {
            fetchRooms();
            fetchUnreadCount();
        },
    });

    useEffect(() => {
        if (!enabled) return;
        const off = onBroadcast('chat:new-message', () => {
            fetchRooms();
            fetchUnreadCount();
        });
        return off;
    }, [enabled, fetchRooms, fetchUnreadCount]);
}
