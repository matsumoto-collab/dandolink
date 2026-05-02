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
        const offNew = onBroadcast('chat:new-message', (payload) => {
            if ((payload as { roomId?: string }).roomId === roomId) {
                fetchMessages(roomId);
            }
            fetchRooms();
        });
        // 既読通知: 自分の送信メッセージに「既読N」を即時反映するため再フェッチ
        const offRead = onBroadcast('chat:message-read', (payload) => {
            if ((payload as { roomId?: string }).roomId === roomId) {
                fetchMessages(roomId);
            }
        });
        return () => {
            offNew();
            offRead();
        };
    }, [roomId, fetchMessages, fetchRooms]);
}

/**
 * グローバル: ルーム一覧と未読バッジの更新。
 * INSERT 時は即時に upsertMessage で楽観バッジ更新、その後 fetchRooms で整合。
 */
export function useChatRoomsRealtime(enabled: boolean, myUserId: string | undefined) {
    const fetchRooms = useChatStore((s) => s.fetchRooms);
    const upsertMessage = useChatStore((s) => s.upsertMessage);

    useRealtimeSubscription({
        table: 'Message',
        channelName: 'chat-rooms-global',
        enabled,
        debounceMs: 0, // 即時反映優先
        onDataChange: (payload) => {
            try {
                if (payload.eventType === 'INSERT' && payload.new) {
                    const newRow = payload.new as Record<string, unknown>;
                    const senderId = newRow.senderId as string;
                    if (senderId === myUserId) {
                        // 自分の送信は楽観更新済みなのでスキップ
                        return;
                    }
                    upsertMessage({
                        id: newRow.id as string,
                        roomId: newRow.roomId as string,
                        senderId,
                        body: (newRow.body as string) ?? '',
                        contentType: (newRow.contentType as string) ?? 'text',
                        parentId: (newRow.parentId as string | null) ?? null,
                        editedAt: (newRow.editedAt as string | null) ?? null,
                        deletedAt: (newRow.deletedAt as string | null) ?? null,
                        createdAt: (newRow.createdAt as string) ?? new Date().toISOString(),
                        mentions: [],
                        attachments: [],
                        reads: [],
                    });
                }
                // 整合のため軽く再取得（debounce代わりに setTimeout）
                setTimeout(() => fetchRooms(), 300);
            } catch (e) {
                logger.error('[chat] global realtime', e);
            }
        },
    });

    useEffect(() => {
        if (!enabled) return;
        const off = onBroadcast('chat:new-message', () => {
            fetchRooms();
        });
        return off;
    }, [enabled, fetchRooms]);
}
