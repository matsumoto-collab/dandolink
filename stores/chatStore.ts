import { create } from 'zustand';
import { logger } from '@/lib/logger';
import type { ChatRoomSummary, ChatMessage } from '@/types/chat';

interface ChatState {
    rooms: ChatRoomSummary[];
    activeRoomId: string | null;
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
    fetchMessages: (roomId: string, opts?: { before?: string }) => Promise<void>;
    sendMessage: (
        roomId: string,
        body: string,
        mentions?: { targetType: 'user' | 'project' | 'role'; targetId: string; label?: string }[]
    ) => Promise<ChatMessage | null>;
    upsertMessage: (msg: ChatMessage) => void;
    markRead: (roomId: string, messageId?: string) => Promise<void>;
    createDM: (otherUserId: string) => Promise<string | null>;
    createGroup: (memberIds: string[], name: string) => Promise<string | null>;
    reset: () => void;
}

const initialState: ChatState = {
    rooms: [],
    activeRoomId: null,
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

    sendMessage: async (roomId, body, mentions = []) => {
        try {
            const res = await fetch(`/api/chat/rooms/${roomId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body, mentions }),
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

    reset: () => set(initialState),
}));
