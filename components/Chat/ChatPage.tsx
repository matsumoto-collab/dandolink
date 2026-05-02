'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Search, Plus, ArrowLeft, Send, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import type { ChatRoomSummary, ChatMessage } from '@/types/chat';
import {
    detectMentionTrigger,
    parseMessageParts,
    replaceTriggerWithVisible,
    filterActiveMentions,
    type MentionToken,
    type MentionTriggerState,
    type SelectedMention,
} from '@/lib/chat/mentionParser';
import MentionChip from './MentionChip';
import MentionSuggestPopover from './MentionSuggestPopover';

// 空配列の安定参照（?? [] が毎レンダー新参照を返してループする問題の回避）
const EMPTY_MESSAGES: ChatMessage[] = [];

interface UserOption {
    id: string;
    displayName: string;
    role: string;
}

export default function ChatPage() {
    const { data: session } = useSession();
    const myUserId = session?.user?.id;
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const rooms = useChatStore((s) => s.rooms);
    const activeRoomId = useChatStore((s) => s.activeRoomId);
    const setActiveRoom = useChatStore((s) => s.setActiveRoom);
    const fetchRooms = useChatStore((s) => s.fetchRooms);
    const fetchUnreadCount = useChatStore((s) => s.fetchUnreadCount);
    const isLoadingRooms = useChatStore((s) => s.isLoadingRooms);

    const [showNewRoomModal, setShowNewRoomModal] = useState(false);
    const [search, setSearch] = useState('');

    // useChatRoomsRealtime は Sidebar でグローバル購読しているのでここでは呼ばない

    useEffect(() => {
        fetchRooms();
        fetchUnreadCount();
    }, [fetchRooms, fetchUnreadCount]);

    // 通知タップで ?roomId=... 付きで来た場合
    useEffect(() => {
        const rid = searchParams?.get('roomId');
        if (rid) {
            setActiveRoom(rid);
            const next = new URLSearchParams(searchParams?.toString() || '');
            next.delete('roomId');
            const qs = next.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname);
        }
    }, [searchParams, setActiveRoom, router, pathname]);

    const filteredRooms = useMemo(() => {
        if (!search.trim()) return rooms;
        const q = search.toLowerCase();
        return rooms.filter((r) => {
            const title = roomTitle(r, myUserId);
            return title.toLowerCase().includes(q) ||
                (r.lastMessagePreview ?? '').toLowerCase().includes(q);
        });
    }, [rooms, search, myUserId]);

    return (
        <div className="flex h-full min-h-0 -m-4 sm:-m-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Room List */}
            <aside
                className={`${activeRoomId ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 border-r border-slate-200 bg-slate-50 min-h-0`}
            >
                <div className="p-3 border-b border-slate-200 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                        <h2 className="text-base font-bold text-slate-900 flex-1">チャット</h2>
                        <button
                            onClick={() => setShowNewRoomModal(true)}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-r from-teal-500 to-teal-700 text-white hover:opacity-90 shadow-sm"
                            aria-label="新規チャット"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="検索"
                            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm bg-white"
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {isLoadingRooms && rooms.length === 0 && (
                        <div className="p-8 text-center text-sm text-slate-400">読み込み中...</div>
                    )}
                    {!isLoadingRooms && filteredRooms.length === 0 && (
                        <div className="p-8 text-center text-sm text-slate-400">
                            チャットがありません<br />「+」から新規作成
                        </div>
                    )}
                    <ul className="divide-y divide-slate-200">
                        {filteredRooms.map((room) => (
                            <li key={room.id}>
                                <button
                                    onClick={() => setActiveRoom(room.id)}
                                    className={`w-full text-left px-3 py-3 hover:bg-white transition-colors ${activeRoomId === room.id ? 'bg-white' : ''}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 flex items-center justify-center text-white font-bold flex-shrink-0">
                                            {roomTitle(room, myUserId).charAt(0)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-slate-900 truncate flex-1">
                                                    {roomTitle(room, myUserId)}
                                                </span>
                                                {room.lastMessageAt && (
                                                    <span className="text-[11px] text-slate-400 flex-shrink-0">
                                                        {formatTime(room.lastMessageAt)}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs text-slate-500 truncate flex-1">
                                                    {room.lastMessagePreview || '（メッセージなし）'}
                                                </span>
                                                {room.unreadCount > 0 && (
                                                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-semibold flex-shrink-0">
                                                        {room.unreadCount > 99 ? '99+' : room.unreadCount}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </aside>

            {/* Room View */}
            <section
                className={`${activeRoomId ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-h-0 min-w-0`}
            >
                {activeRoomId ? (
                    <ChatRoomView
                        roomId={activeRoomId}
                        myUserId={myUserId}
                        onBack={() => setActiveRoom(null)}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400">
                        ルームを選択してください
                    </div>
                )}
            </section>

            {showNewRoomModal && (
                <NewRoomModal
                    onClose={() => setShowNewRoomModal(false)}
                    onCreated={(rid) => {
                        setActiveRoom(rid);
                        setShowNewRoomModal(false);
                    }}
                />
            )}
        </div>
    );
}

function roomTitle(room: ChatRoomSummary, myUserId: string | undefined): string {
    if (room.name) return room.name;
    if (room.type === 'dm') {
        const other = room.members.find((m) => m.userId !== myUserId);
        return other?.displayName || 'ダイレクトメッセージ';
    }
    const others = room.members.filter((m) => m.userId !== myUserId);
    return others.map((m) => m.displayName).slice(0, 3).join(', ') || 'グループ';
}

function formatTime(d: string | Date): string {
    const date = typeof d === 'string' ? new Date(d) : d;
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
        return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

interface ChatRoomViewProps {
    roomId: string;
    myUserId: string | undefined;
    onBack: () => void;
}

function ChatRoomView({ roomId, myUserId, onBack }: ChatRoomViewProps) {
    // ?? [] / ?? false を使うと毎レンダー新参照を返してリレンダーループを誘発するため避ける
    const rawMessages = useChatStore((s) => s.messagesByRoom[roomId]);
    const rawHasMore = useChatStore((s) => s.hasMoreByRoom[roomId]);
    const messages = rawMessages ?? EMPTY_MESSAGES;
    const hasMore = rawHasMore ?? false;
    const room = useChatStore(
        useCallback((s) => s.rooms.find((r) => r.id === roomId), [roomId])
    );
    const fetchMessages = useChatStore((s) => s.fetchMessages);
    const sendMessage = useChatStore((s) => s.sendMessage);
    const markRead = useChatStore((s) => s.markRead);

    const memberMap = useMemo(() => {
        const m = new Map<string, string>();
        room?.members.forEach((mm) => m.set(mm.userId, mm.displayName));
        return m;
    }, [room]);

    const [text, setText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [mentionTrigger, setMentionTrigger] = useState<MentionTriggerState | null>(null);
    const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastMessageIdRef = useRef<string | null>(null);
    const lastReadIdRef = useRef<string | null>(null);

    useChatRealtime(roomId);

    // 初期ロード + ルーム切替時
    useEffect(() => {
        lastMessageIdRef.current = null;
        lastReadIdRef.current = null;
        fetchMessages(roomId);
    }, [roomId, fetchMessages]);

    // 最新メッセージID（プリミティブ）だけで効果を発火
    const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;

    // 新着で最下部にスクロール
    useEffect(() => {
        if (!lastMessageId) return;
        if (lastMessageId !== lastMessageIdRef.current) {
            lastMessageIdRef.current = lastMessageId;
            requestAnimationFrame(() => {
                scrollRef.current?.scrollTo({
                    top: scrollRef.current.scrollHeight,
                    behavior: 'smooth',
                });
            });
        }
    }, [lastMessageId]);

    // 既読更新（連鎖re-render対策で別effect・ref guard）
    useEffect(() => {
        if (!lastMessageId) return;
        if (lastMessageId === lastReadIdRef.current) return;
        lastReadIdRef.current = lastMessageId;
        markRead(roomId, lastMessageId);
    }, [lastMessageId, roomId, markRead]);

    const onSend = useCallback(async () => {
        const body = text.trim();
        if (!body || isSending) return;
        setIsSending(true);
        const active = filterActiveMentions(text, selectedMentions);
        // 同一(targetType,targetId)の重複を排除
        const seen = new Set<string>();
        const dedup = active.filter((m) => {
            const k = `${m.type}:${m.targetId}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        const apiMentions = dedup.map((m) => ({
            targetType: m.type,
            targetId: m.targetId,
            label: m.label,
        }));
        const result = await sendMessage(roomId, body, apiMentions);
        setIsSending(false);
        if (result) {
            setText('');
            setSelectedMentions([]);
            setMentionTrigger(null);
        }
    }, [text, isSending, sendMessage, roomId, selectedMentions]);

    const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setText(value);
        // 本文に登場しなくなったメンションは除外
        setSelectedMentions((prev) => prev.filter((m) => value.includes(m.visible)));
        const cursor = e.target.selectionStart ?? value.length;
        setMentionTrigger(detectMentionTrigger(value, cursor));
    };

    const onSelectMention = (token: MentionToken) => {
        if (!mentionTrigger) return;
        const { newText, newCursor, visible } = replaceTriggerWithVisible(text, mentionTrigger, token);
        setText(newText);
        setSelectedMentions((prev) => {
            // 同じ targetId は1件だけ保持
            const next = prev.filter((m) => !(m.type === token.type && m.targetId === token.targetId));
            return [...next, { ...token, visible }];
        });
        // 連続選択用: 同じトリガで empty query の状態を維持
        setMentionTrigger({
            trigger: mentionTrigger.trigger,
            query: '',
            startIdx: newCursor,
            endIdx: newCursor,
        });
        requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (ta) {
                ta.focus();
                ta.setSelectionRange(newCursor, newCursor);
            }
        });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape' && mentionTrigger) {
            e.preventDefault();
            setMentionTrigger(null);
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            // メンションサジェスト表示中は送信を抑止
            if (mentionTrigger) return;
            e.preventDefault();
            onSend();
        }
    };

    return (
        <>
            {/* Header */}
            <header className="flex items-center gap-2 px-3 py-3 border-b border-slate-200 bg-white">
                <button
                    onClick={onBack}
                    className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl hover:bg-slate-100"
                    aria-label="戻る"
                >
                    <ArrowLeft className="w-5 h-5 text-slate-600" />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-slate-900 truncate">
                        {room ? roomTitle(room, myUserId) : '...'}
                    </h2>
                    {room && room.type !== 'dm' && (
                        <p className="text-xs text-slate-500 truncate">
                            {room.members.length}名
                        </p>
                    )}
                </div>
            </header>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 bg-slate-50">
                {hasMore && (
                    <div className="text-center mb-3">
                        <button
                            onClick={() => {
                                const oldest = messages[0];
                                if (oldest) fetchMessages(roomId, { before: oldest.id });
                            }}
                            className="text-xs text-slate-500 hover:text-slate-700 underline"
                        >
                            過去のメッセージを読み込む
                        </button>
                    </div>
                )}
                <ul className="space-y-3">
                    {messages.map((msg) => (
                        <MessageBubble
                            key={msg.id}
                            message={msg}
                            isMine={msg.senderId === myUserId}
                            senderName={memberMap.get(msg.senderId) ?? '(不明)'}
                        />
                    ))}
                </ul>
            </div>

            {/* Composer */}
            <div className="p-3 border-t border-slate-200 bg-white">
                <p className="text-[10px] text-slate-400 mb-1">
                    @ でユーザー/ロール、# で案件をメンション
                </p>
                <div className="flex items-end gap-2 relative">
                    <div className="flex-1 relative">
                        <textarea
                            ref={textareaRef}
                            value={text}
                            onChange={onTextChange}
                            onKeyDown={onKeyDown}
                            onBlur={() => setTimeout(() => setMentionTrigger(null), 100)}
                            rows={1}
                            placeholder="メッセージを入力（Enterで送信、Shift+Enterで改行）"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm resize-none max-h-32"
                            style={{ minHeight: 44 }}
                        />
                        {mentionTrigger && (
                            <MentionSuggestPopover
                                trigger={mentionTrigger.trigger}
                                query={mentionTrigger.query}
                                onSelect={onSelectMention}
                                onClose={() => setMentionTrigger(null)}
                            />
                        )}
                    </div>
                    <button
                        onClick={onSend}
                        disabled={!text.trim() || isSending}
                        className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-r from-teal-500 to-teal-700 text-white hover:opacity-90 disabled:opacity-40 shadow-sm flex-shrink-0"
                        aria-label="送信"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </>
    );
}

interface MessageBubbleProps {
    message: ChatMessage;
    isMine: boolean;
    senderName: string;
}

function MessageBubble({ message, isMine, senderName }: MessageBubbleProps) {
    const isDeleted = !!message.deletedAt;
    return (
        <li className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                {!isMine && (
                    <span className="text-[11px] text-slate-500 mb-0.5 px-1">{senderName}</span>
                )}
                <div
                    className={`rounded-xl px-3 py-2 shadow-sm ${
                        isDeleted
                            ? 'bg-slate-100 text-slate-400 italic border border-slate-200'
                            : isMine
                                ? 'bg-gradient-to-br from-teal-500 to-teal-700 text-white'
                                : 'bg-white text-slate-900 border border-slate-200'
                    }`}
                >
                    <p className="text-sm whitespace-pre-wrap break-words">
                        {parseMessageParts(
                            message.body,
                            (message.mentions ?? []).map((mm) => ({
                                targetType: mm.targetType,
                                targetId: mm.targetId,
                                label: mm.label ?? undefined,
                            }))
                        ).map((part, i) =>
                            part.kind === 'text' ? (
                                <React.Fragment key={i}>{part.text}</React.Fragment>
                            ) : (
                                <MentionChip key={i} token={part.token} onMine={isMine} />
                            )
                        )}
                    </p>
                </div>
                <span className={`text-[10px] text-slate-400 mt-0.5 px-1 ${isMine ? 'text-right' : 'text-left'}`}>
                    {formatTime(message.createdAt)}
                    {message.editedAt && '（編集済み）'}
                    {isMine && message.reads && message.reads.length > 0 && (
                        <span className="ml-2 text-teal-600 font-medium">既読 {message.reads.length}</span>
                    )}
                </span>
            </div>
        </li>
    );
}

interface NewRoomModalProps {
    onClose: () => void;
    onCreated: (roomId: string) => void;
}

function NewRoomModal({ onClose, onCreated }: NewRoomModalProps) {
    const createDM = useChatStore((s) => s.createDM);
    const createGroup = useChatStore((s) => s.createGroup);
    const [users, setUsers] = useState<UserOption[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [groupName, setGroupName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetch('/api/chat/users')
            .then((r) => r.json())
            .then((d) => setUsers(d.users ?? []))
            .catch(() => { /* noop */ });
    }, []);

    const filtered = useMemo(() => {
        if (!search.trim()) return users;
        const q = search.toLowerCase();
        return users.filter((u) => u.displayName.toLowerCase().includes(q));
    }, [users, search]);

    const toggle = (uid: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    };

    const onCreate = async () => {
        if (selected.size === 0) return;
        setIsLoading(true);
        const ids = Array.from(selected);
        const roomId = ids.length === 1
            ? await createDM(ids[0])
            : await createGroup(ids, groupName.trim() || 'グループ');
        setIsLoading(false);
        if (roomId) onCreated(roomId);
    };

    const isGroup = selected.size > 1;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center px-4 py-3 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-900 flex-1">新規チャット</h3>
                    <button onClick={onClose} className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center">
                        <X className="w-5 h-5 text-slate-600" />
                    </button>
                </div>

                <div className="p-4 space-y-3 flex-1 overflow-y-auto min-h-0">
                    {isGroup && (
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">グループ名</label>
                            <input
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                placeholder="例: 現場連絡"
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                            メンバーを選択（{selected.size}名）
                        </label>
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="名前で検索"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm mb-2"
                        />
                        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl max-h-72 overflow-y-auto">
                            {filtered.map((u) => (
                                <li key={u.id}>
                                    <label className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selected.has(u.id)}
                                            onChange={() => toggle(u.id)}
                                            className="w-4 h-4"
                                        />
                                        <span className="text-sm text-slate-900 flex-1">{u.displayName}</span>
                                        <span className="text-[11px] text-slate-500">{roleLabel(u.role)}</span>
                                    </label>
                                </li>
                            ))}
                            {filtered.length === 0 && (
                                <li className="px-3 py-6 text-center text-xs text-slate-400">該当なし</li>
                            )}
                        </ul>
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-slate-200 flex gap-2 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={onCreate}
                        disabled={selected.size === 0 || isLoading}
                        className="px-4 py-2 text-sm rounded-xl bg-gradient-to-r from-teal-500 to-teal-700 text-white disabled:opacity-40 hover:opacity-90"
                    >
                        {isLoading ? '作成中...' : selected.size <= 1 ? 'DM開始' : 'グループ作成'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function roleLabel(role: string): string {
    switch (role) {
        case 'admin': return '管理者';
        case 'manager': return 'マネージャー';
        case 'foreman1': return '職長1';
        case 'foreman2': return '職長2';
        case 'worker': return '職方';
        case 'partner': return '協力業者';
        default: return role;
    }
}
