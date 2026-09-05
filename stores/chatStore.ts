import { create } from 'zustand';
import { logger } from '@/lib/logger';
import type { ChatRoomSummary, ChatMessage, MessageReaction } from '@/types/chat';

interface ChatState {
    rooms: ChatRoomSummary[];
    activeRoomId: string | null;
    /**
     * チャットウインドウ（PC・iPad）／ボトムシート（スマホ）で表示中のルーム。
     * null のときはウインドウにルーム一覧だけを出す
     */
    dockedRoomId: string | null;
    /**
     * チャットウインドウ／ボトムシートを出しているか。
     * PC・iPad ではサイドバーの「チャット」を押すとチャット画面へは行かず、このウインドウで開く
     */
    isChatWindowOpen: boolean;
    messagesByRoom: Record<string, ChatMessage[]>;
    hasMoreByRoom: Record<string, boolean>;
    totalUnread: number;
    isLoadingRooms: boolean;
    isLoadingMessages: boolean;
}

interface ChatActions {
    fetchRooms: () => Promise<void>;
    fetchUnreadCount: () => Promise<void>;
    setActiveRoom: (roomId: string | null) => void;
    /** ウインドウに出すルームを切り替える（指定ありならウインドウも開く。null は一覧だけの状態） */
    setDockedRoom: (roomId: string | null) => void;
    /** ウインドウを開く（ルームは直前のものを保つ。無ければ一覧だけ） */
    openChatWindow: () => void;
    /** ウインドウを閉じる（ルームは保つので次に開いたとき続きが見える） */
    closeChatWindow: () => void;
    fetchMessages: (roomId: string, opts?: { before?: string }) => Promise<void>;
    sendMessage: (
        roomId: string,
        body: string,
        mentions?: { targetType: 'user' | 'project' | 'role'; targetId: string; label?: string }[],
        attachments?: Array<{
            fileType: string;
            storagePath: string;
            thumbnailPath?: string | null;
            signedUrl?: string | null;
            signedUrlExpiresAt?: string | null;
            thumbnailSignedUrl?: string | null;
            thumbnailSignedUrlExpiresAt?: string | null;
            mimeType: string;
            fileSize: number;
            width?: number | null;
            height?: number | null;
        }>
    ) => Promise<ChatMessage | null>;
    upsertMessage: (msg: ChatMessage) => void;
    deleteMessage: (messageId: string, roomId: string) => Promise<boolean>;
    toggleReaction: (messageId: string, roomId: string, emoji: string, myUserId: string) => Promise<boolean>;
    markRead: (roomId: string, messageId?: string) => Promise<void>;
    createDM: (otherUserId: string) => Promise<string | null>;
    createGroup: (memberIds: string[], name: string) => Promise<string | null>;
    renameRoom: (roomId: string, name: string) => Promise<boolean>;
    deleteRoom: (roomId: string) => Promise<boolean>;
    reset: () => void;
}

const initialState: ChatState = {
    rooms: [],
    activeRoomId: null,
    dockedRoomId: null,
    isChatWindowOpen: false,
    messagesByRoom: {},
    hasMoreByRoom: {},
    totalUnread: 0,
    isLoadingRooms: false,
    isLoadingMessages: false,
};

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
    ...initialState,

    fetchRooms: async () => {
        set({ isLoadingRooms: true });
        try {
            const res = await fetch('/api/chat/rooms', { cache: 'no-store' });
            if (!res.ok) throw new Error('rooms fetch failed');
            const data = await res.json();
            const rooms: ChatRoomSummary[] = data.rooms ?? [];
            const totalUnread = rooms
                .filter((r) => !r.isMuted)
                .reduce((sum, r) => sum + (r.unreadCount || 0), 0);
            set({ rooms, totalUnread, isLoadingRooms: false });
        } catch (e) {
            logger.error('[chat] fetchRooms', e);
            set({ isLoadingRooms: false });
        }
    },

    fetchUnreadCount: async () => {
        try {
            const res = await fetch('/api/chat/unread-count', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            set({ totalUnread: data.unreadCount ?? 0 });
        } catch (e) {
            logger.error('[chat] fetchUnreadCount', e);
        }
    },

    setActiveRoom: (roomId) => set({ activeRoomId: roomId }),

    setDockedRoom: (roomId) =>
        set(roomId ? { dockedRoomId: roomId, isChatWindowOpen: true } : { dockedRoomId: null }),

    openChatWindow: () => set({ isChatWindowOpen: true }),

    closeChatWindow: () => set({ isChatWindowOpen: false }),

    fetchMessages: async (roomId, opts) => {
        set({ isLoadingMessages: true });
        try {
            const params = new URLSearchParams();
            if (opts?.before) params.set('before', opts.before);
            params.set('limit', '50');
            const res = await fetch(
                `/api/chat/rooms/${roomId}/messages?${params.toString()}`,
                { cache: 'no-store' }
            );
            if (!res.ok) throw new Error('messages fetch failed');
            const data = await res.json();
            const items: ChatMessage[] = data.items ?? [];
            const existing = get().messagesByRoom[roomId] ?? [];
            const merged = opts?.before
                ? [...items, ...existing.filter((m) => !items.some((x) => x.id === m.id))]
                : items;
            set((s) => ({
                messagesByRoom: { ...s.messagesByRoom, [roomId]: merged },
                hasMoreByRoom: { ...s.hasMoreByRoom, [roomId]: !!data.hasMore },
                isLoadingMessages: false,
            }));
        } catch (e) {
            logger.error('[chat] fetchMessages', e);
            set({ isLoadingMessages: false });
        }
    },

    sendMessage: async (roomId, body, mentions = [], attachments = []) => {
        try {
            const res = await fetch(`/api/chat/rooms/${roomId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body, mentions, attachments }),
            });
            if (!res.ok) throw new Error('send failed');
            const data = await res.json();
            const msg: ChatMessage = data.message;
            get().upsertMessage(msg);

            // broadcast 別端末用
            try {
                const { sendBroadcast } = await import('@/lib/broadcastChannel');
                sendBroadcast('chat:new-message', { roomId, messageId: msg.id });
            } catch { /* noop */ }

            return msg;
        } catch (e) {
            logger.error('[chat] sendMessage', e);
            return null;
        }
    },

    upsertMessage: (msg) => {
        set((s) => {
            const list = s.messagesByRoom[msg.roomId] ?? [];
            const idx = list.findIndex((m) => m.id === msg.id);
            const isNew = idx < 0;
            const next = isNew
                ? [...list, msg]
                : [...list.slice(0, idx), msg, ...list.slice(idx + 1)];
            // ルーム一覧の lastMessage / 未読を楽観更新
            const rooms = s.rooms.map((r) => {
                if (r.id !== msg.roomId) return r;
                const isFromOther = msg.senderId !== ''; // senderId 自体は myUserId と比較不可なのでフラグ運用
                const incUnread = isNew && r.id !== s.activeRoomId && isFromOther;
                return {
                    ...r,
                    lastMessageAt: msg.createdAt,
                    lastMessagePreview:
                        msg.body.length > 80 ? msg.body.slice(0, 80) + '…' : msg.body,
                    unreadCount: incUnread ? (r.unreadCount || 0) + 1 : r.unreadCount,
                };
            });
            const totalUnread = rooms
                .filter((r) => !r.isMuted)
                .reduce((sum, r) => sum + (r.unreadCount || 0), 0);
            return {
                messagesByRoom: { ...s.messagesByRoom, [msg.roomId]: next },
                rooms,
                totalUnread,
            };
        });
    },

    deleteMessage: async (messageId, roomId) => {
        try {
            const res = await fetch(`/api/chat/messages/${messageId}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || 'delete failed');
            }
            // 楽観更新: 本文をトゥームストーンに置換し、添付/メンションを除去
            set((s) => {
                const list = s.messagesByRoom[roomId];
                if (!list) return {};
                return {
                    messagesByRoom: {
                        ...s.messagesByRoom,
                        [roomId]: list.map((m) =>
                            m.id === messageId
                                ? {
                                    ...m,
                                    body: '送信を取り消しました',
                                    deletedAt: new Date().toISOString(),
                                    attachments: [],
                                    mentions: [],
                                }
                                : m
                        ),
                    },
                };
            });

            // broadcast 別端末用（postgres_changes の遅延を待たず即時同期）
            try {
                const { sendBroadcast } = await import('@/lib/broadcastChannel');
                sendBroadcast('chat:message-deleted', { roomId, messageId });
            } catch { /* noop */ }

            return true;
        } catch (e) {
            logger.error('[chat] deleteMessage', e);
            return false;
        }
    },

    toggleReaction: async (messageId, roomId, emoji, myUserId) => {
        // 楽観更新（1ユーザー1種類: 同じなら解除・違えば付け替え）
        const applyLocal = (reactions: MessageReaction[] | undefined): MessageReaction[] => {
            const list = reactions ?? [];
            const mine = list.find((r) => r.userId === myUserId);
            if (mine && mine.emoji === emoji) {
                return list.filter((r) => r.userId !== myUserId);
            }
            const without = list.filter((r) => r.userId !== myUserId);
            return [...without, { id: `optimistic-${myUserId}`, userId: myUserId, emoji }];
        };
        set((s) => {
            const list = s.messagesByRoom[roomId];
            if (!list) return {};
            return {
                messagesByRoom: {
                    ...s.messagesByRoom,
                    [roomId]: list.map((m) =>
                        m.id === messageId ? { ...m, reactions: applyLocal(m.reactions) } : m
                    ),
                },
            };
        });

        try {
            const res = await fetch(`/api/chat/messages/${messageId}/reactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || 'reaction failed');
            }
            const data = await res.json();
            const reactions: MessageReaction[] = data.reactions ?? [];
            // サーバ応答で確定
            set((s) => {
                const list = s.messagesByRoom[roomId];
                if (!list) return {};
                return {
                    messagesByRoom: {
                        ...s.messagesByRoom,
                        [roomId]: list.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
                    },
                };
            });
            // 別端末・他メンバーへ通知（MessageReaction は postgres_changes 非購読のため broadcast 必須）
            try {
                const { sendBroadcast } = await import('@/lib/broadcastChannel');
                sendBroadcast('chat:reaction', { roomId, messageId });
            } catch { /* noop */ }
            return true;
        } catch (e) {
            logger.error('[chat] toggleReaction', e);
            // 失敗時はサーバ状態に戻す
            get().fetchMessages(roomId);
            return false;
        }
    },

    markRead: async (roomId, messageId) => {
        // 楽観更新: バッジを即時0に
        set((s) => {
            const prev = s.rooms.find((r) => r.id === roomId)?.unreadCount ?? 0;
            return {
                rooms: s.rooms.map((r) =>
                    r.id === roomId ? { ...r, unreadCount: 0 } : r
                ),
                totalUnread: Math.max(0, s.totalUnread - prev),
            };
        });
        try {
            await fetch(`/api/chat/rooms/${roomId}/read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(messageId ? { messageId } : {}),
            });
            // 別端末・送信者へ既読通知（送信者UIが「既読N」即時更新できるように）
            try {
                const { sendBroadcast } = await import('@/lib/broadcastChannel');
                sendBroadcast('chat:message-read', { roomId });
            } catch { /* noop */ }
        } catch (e) {
            logger.error('[chat] markRead', e);
        }
    },

    createDM: async (otherUserId) => {
        try {
            const res = await fetch('/api/chat/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'dm', memberIds: [otherUserId] }),
            });
            if (!res.ok) throw new Error('createDM failed');
            const data = await res.json();
            await get().fetchRooms();
            return data.roomId as string;
        } catch (e) {
            logger.error('[chat] createDM', e);
            return null;
        }
    },

    createGroup: async (memberIds, name) => {
        try {
            const res = await fetch('/api/chat/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'group', memberIds, name }),
            });
            if (!res.ok) throw new Error('createGroup failed');
            const data = await res.json();
            await get().fetchRooms();
            return data.roomId as string;
        } catch (e) {
            logger.error('[chat] createGroup', e);
            return null;
        }
    },

    renameRoom: async (roomId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        try {
            const res = await fetch(`/api/chat/rooms/${roomId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmed }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || 'rename failed');
            }
            // 楽観更新
            set((s) => ({
                rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, name: trimmed } : r)),
            }));
            // 別端末・他メンバーへ通知（ChatRoom テーブルは postgres_changes 非購読のため broadcast 必須）
            try {
                const { sendBroadcast } = await import('@/lib/broadcastChannel');
                sendBroadcast('chat:room-updated', { roomId });
            } catch { /* noop */ }
            return true;
        } catch (e) {
            logger.error('[chat] renameRoom', e);
            return false;
        }
    },

    deleteRoom: async (roomId) => {
        try {
            const res = await fetch(`/api/chat/rooms/${roomId}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || 'delete failed');
            }
            // 楽観更新: 一覧から除去・アクティブ解除・キャッシュ破棄
            set((s) => {
                const rooms = s.rooms.filter((r) => r.id !== roomId);
                const messagesByRoom = { ...s.messagesByRoom };
                delete messagesByRoom[roomId];
                const hasMoreByRoom = { ...s.hasMoreByRoom };
                delete hasMoreByRoom[roomId];
                const totalUnread = rooms
                    .filter((r) => !r.isMuted)
                    .reduce((sum, r) => sum + (r.unreadCount || 0), 0);
                return {
                    rooms,
                    messagesByRoom,
                    hasMoreByRoom,
                    totalUnread,
                    activeRoomId: s.activeRoomId === roomId ? null : s.activeRoomId,
                    dockedRoomId: s.dockedRoomId === roomId ? null : s.dockedRoomId,
                };
            });
            // 別端末・他メンバーへ通知
            try {
                const { sendBroadcast } = await import('@/lib/broadcastChannel');
                sendBroadcast('chat:room-deleted', { roomId });
            } catch { /* noop */ }
            return true;
        } catch (e) {
            logger.error('[chat] deleteRoom', e);
            return false;
        }
    },

    // 表示形式は端末ごとの好みなのでログアウト等でも保存値から復元する
    reset: () => set(initialState),
}));
