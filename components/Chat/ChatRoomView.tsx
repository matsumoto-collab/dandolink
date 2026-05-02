'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import type { ChatRoomSummary, ChatMessage } from '@/types/chat';
import {
    detectMentionTrigger,
    filterActiveMentions,
    parseMessageParts,
    replaceTriggerWithVisible,
    type MentionToken,
    type MentionTriggerState,
    type SelectedMention,
} from '@/lib/chat/mentionParser';
import MentionChip from './MentionChip';
import MentionSuggestPopover from './MentionSuggestPopover';

const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatRoomViewProps {
    roomId: string;
    myUserId: string | undefined;
    /** モバイル用「戻る」ボタン。省略時は非表示（埋込モード） */
    onBack?: () => void;
}

export default function ChatRoomView({ roomId, myUserId, onBack }: ChatRoomViewProps) {
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
    const fetchRooms = useChatStore((s) => s.fetchRooms);

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

    // 初期ロード + ルーム情報が無ければルーム一覧も取得
    useEffect(() => {
        lastMessageIdRef.current = null;
        lastReadIdRef.current = null;
        fetchMessages(roomId);
        if (!room) fetchRooms();
    }, [roomId, fetchMessages, fetchRooms, room]);

    const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;

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
        setSelectedMentions((prev) => prev.filter((m) => value.includes(m.visible)));
        const cursor = e.target.selectionStart ?? value.length;
        setMentionTrigger(detectMentionTrigger(value, cursor));
    };

    const onSelectMention = (token: MentionToken) => {
        if (!mentionTrigger) return;
        const { newText, newCursor, visible } = replaceTriggerWithVisible(text, mentionTrigger, token);
        setText(newText);
        setSelectedMentions((prev) => {
            const next = prev.filter((m) => !(m.type === token.type && m.targetId === token.targetId));
            return [...next, { ...token, visible }];
        });
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
            if (mentionTrigger) return;
            e.preventDefault();
            onSend();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-white">
            <header className="flex items-center gap-2 px-3 py-3 border-b border-slate-200 bg-white">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl hover:bg-slate-100"
                        aria-label="戻る"
                    >
                        <ArrowLeft className="w-5 h-5 text-slate-600" />
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-slate-900 truncate">
                        {room ? roomLabel(room, myUserId) : '...'}
                    </h2>
                    {room && room.type !== 'dm' && (
                        <p className="text-xs text-slate-500 truncate">{room.members.length}名</p>
                    )}
                </div>
            </header>

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
        </div>
    );
}

function roomLabel(room: ChatRoomSummary, myUserId: string | undefined): string {
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
