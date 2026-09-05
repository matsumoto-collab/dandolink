import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { useRealtimeSubscription, type RealtimePayload } from './useRealtimeSubscription';
import { useChatStore } from '@/stores/chatStore';
import { onBroadcast } from '@/lib/broadcastChannel';
import type { ChatMessage } from '@/types/chat';
import { logger } from '@/lib/logger';

/**
 * アクティブルームのメッセージ Realtime 購読 + ルーム一覧の未読更新。
 * INSERT は単件差分更新、その他（UPDATE/DELETE）はルーム再取得。
 *
 * @param channelKey 同じルームを同時に2箇所で開く場合（例: ドッキング表示＋案件詳細モーダル）の
 *   チャンネル名の接尾辞。useRealtimeSubscription は同名チャンネルを毎回新規生成するため、
 *   同名が2本になると片方の unmount でもう片方の購読も外れる。呼び出し元ごとに別名にして回避する。
 */
export function useChatRealtime(roomId: string | null, channelKey?: string) {
    const fetchMessages = useChatStore((s) => s.fetchMessages);
    const fetchRooms = useChatStore((s) => s.fetchRooms);
    const upsertMessage = useChatStore((s) => s.upsertMessage);

    useRealtimeSubscription({
        table: 'Message',
        channelName: roomId ? `chat-room-${roomId}${channelKey ? `-${channelKey}` : ''}` : 'chat-room-disabled',
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
        // 送信取り消し: 別端末での取消を即時反映（postgres_changes の遅延対策）
        const offDeleted = onBroadcast('chat:message-deleted', (payload) => {
            if ((payload as { roomId?: string }).roomId === roomId) {
                fetchMessages(roomId);
            }
            fetchRooms();
        });
        // リアクション: MessageReaction は postgres_changes 非購読のため broadcast で反映
        const offReaction = onBroadcast('chat:reaction', (payload) => {
            if ((payload as { roomId?: string }).roomId === roomId) {
                fetchMessages(roomId);
            }
        });
        return () => {
            offNew();
            offRead();
            offDeleted();
            offReaction();
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
        const offNew = onBroadcast('chat:new-message', () => {
            fetchRooms();
        });
        // ルーム名変更: 一覧・ヘッダー名を最新化
        const offUpdated = onBroadcast('chat:room-updated', () => {
            fetchRooms();
        });
        // グループ削除: 開いていたら閉じて通知し、一覧から除去
        const offDeleted = onBroadcast('chat:room-deleted', (payload) => {
            const deletedId = (payload as { roomId?: string }).roomId;
            const { activeRoomId, setActiveRoom, dockedRoomId, setDockedRoom } = useChatStore.getState();
            const wasOpen = !!deletedId && (activeRoomId === deletedId || dockedRoomId === deletedId);
            if (deletedId && activeRoomId === deletedId) setActiveRoom(null);
            // チャットウインドウ／ボトムシートで開いていたルームが消えた場合はルーム一覧に戻す（ウインドウ自体は閉じない）
            if (deletedId && dockedRoomId === deletedId) setDockedRoom(null);
            if (wasOpen) toast('このグループは削除されました', { position: 'bottom-center' });
            fetchRooms();
        });
        return () => {
            offNew();
            offUpdated();
            offDeleted();
        };
    }, [enabled, fetchRooms]);
}
