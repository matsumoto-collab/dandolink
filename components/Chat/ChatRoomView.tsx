'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, Send, Users, ChevronDown, ChevronUp, UserPlus, Paperclip, Camera, X, FileText } from 'lucide-react';
import InviteMembersModal from './InviteMembersModal';
import { logger } from '@/lib/logger';
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

interface UploadedAttachment {
    fileType: string;
    storagePath: string;
    thumbnailPath?: string | null;
    signedUrl?: string | null;
    signedUrlExpiresAt?: string | null;
    thumbnailSignedUrl?: string | null;
    thumbnailSignedUrlExpiresAt?: string | null;
    mimeType: string;
    fileSize: number;
    originalFileName?: string;
    width?: number | null;
    height?: number | null;
}

function PendingAttachmentChip({ attachment, onRemove }: { attachment: UploadedAttachment; onRemove: () => void }) {
    const isImage = attachment.fileType === 'image';
    return (
        <div className="relative group">
            {isImage && (attachment.thumbnailSignedUrl || attachment.signedUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={attachment.thumbnailSignedUrl || attachment.signedUrl || ''}
                    alt=""
                    className="w-16 h-16 object-cover rounded-xl border border-slate-200"
                />
            ) : (
                <div className="w-16 h-16 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                    <FileText className="w-6 h-6 text-slate-500" />
                    <span className="text-[9px] text-slate-500 mt-1 truncate max-w-[3.5rem] px-1">
                        {attachment.originalFileName || 'PDF'}
                    </span>
                </div>
            )}
            <button
                type="button"
                onClick={onRemove}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center shadow"
                aria-label="削除"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    );
}

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
    const [showMembers, setShowMembers] = useState(false);
    const [showInvite, setShowInvite] = useState(false);
    const [pendingAttachments, setPendingAttachments] = useState<UploadedAttachment[]>([]);
    const [uploadingCount, setUploadingCount] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
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
        if ((!body && pendingAttachments.length === 0) || isSending) return;
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
        const result = await sendMessage(roomId, body, apiMentions, pendingAttachments);
        setIsSending(false);
        if (result) {
            setText('');
            setSelectedMentions([]);
            setMentionTrigger(null);
            setPendingAttachments([]);
        }
    }, [text, isSending, sendMessage, roomId, selectedMentions, pendingAttachments]);

    const uploadFiles = useCallback(async (files: FileList | File[]) => {
        const list = Array.from(files);
        if (list.length === 0) return;
        setUploadingCount((c) => c + list.length);
        for (const f of list) {
            try {
                const fd = new FormData();
                fd.append('file', f);
                const res = await fetch(`/api/chat/rooms/${roomId}/attachments`, {
                    method: 'POST',
                    body: fd,
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error((err as { error?: string }).error || 'upload failed');
                }
                const data: UploadedAttachment = await res.json();
                setPendingAttachments((prev) => [...prev, data]);
            } catch (e) {
                logger.error('[chat] upload', e);
                alert(`アップロードに失敗しました: ${f.name}`);
            } finally {
                setUploadingCount((c) => c - 1);
            }
        }
    }, [roomId]);

    const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) uploadFiles(e.target.files);
        e.target.value = '';
    };

    const removePending = (idx: number) => {
        setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
    };

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
            <header className="flex-shrink-0 border-b border-slate-200 bg-white">
                <div className="flex items-center gap-2 px-3 py-3">
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
                            <p className="text-xs text-slate-500 truncate">
                                {room.members.length}名が参加
                            </p>
                        )}
                    </div>
                    {room && room.type !== 'dm' && (
                        <button
                            type="button"
                            onClick={() => setShowMembers((v) => !v)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100"
                            aria-label="参加メンバー"
                        >
                            <Users className="w-4 h-4" />
                            <span>{room.members.length}</span>
                            {showMembers ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                    )}
                </div>
                {room && showMembers && (
                    <div className="px-3 pb-3 border-t border-slate-100 bg-slate-50/60">
                        <div className="pt-2 flex items-center justify-between mb-2">
                            <span className="text-[11px] font-semibold text-slate-500">参加メンバー</span>
                            <button
                                type="button"
                                onClick={() => setShowInvite(true)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium bg-gradient-to-r from-teal-500 to-teal-700 text-white hover:opacity-90 shadow-sm"
                            >
                                <UserPlus className="w-3.5 h-3.5" />
                                追加
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {room.members.map((mm) => (
                                <span
                                    key={mm.userId}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[12px] font-medium ring-1 ${
                                        mm.userId === myUserId
                                            ? 'bg-teal-50 text-teal-700 ring-teal-200'
                                            : 'bg-white text-slate-700 ring-slate-200'
                                    }`}
                                >
                                    <span className="w-5 h-5 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 text-white text-[10px] font-bold flex items-center justify-center">
                                        {mm.displayName.charAt(0)}
                                    </span>
                                    <span>{mm.displayName}</span>
                                    {mm.userRole && (
                                        <span className="text-[10px] text-slate-400">
                                            {roleLabel(mm.userRole)}
                                        </span>
                                    )}
                                    {mm.role === 'owner' && (
                                        <span className="text-[10px] text-amber-600 font-semibold">主</span>
                                    )}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                {showInvite && room && (
                    <InviteMembersModal
                        roomId={roomId}
                        existingMemberIds={room.members.map((mm) => mm.userId)}
                        onClose={() => setShowInvite(false)}
                    />
                )}
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
                {pendingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {pendingAttachments.map((a, idx) => (
                            <PendingAttachmentChip
                                key={a.storagePath}
                                attachment={a}
                                onRemove={() => removePending(idx)}
                            />
                        ))}
                        {uploadingCount > 0 && (
                            <span className="inline-flex items-center px-2 py-1 rounded-xl text-xs text-slate-500 bg-slate-100">
                                アップロード中...
                            </span>
                        )}
                    </div>
                )}
                <p className="text-[10px] text-slate-400 mb-1">
                    @ でユーザー/ロール、# で案件をメンション
                </p>
                <div className="flex items-end gap-2 relative">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        onChange={onPickFiles}
                        className="hidden"
                    />
                    <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={onPickFiles}
                        className="hidden"
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 flex-shrink-0"
                        aria-label="ファイル添付"
                    >
                        <Paperclip className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 flex-shrink-0 lg:hidden"
                        aria-label="カメラ"
                    >
                        <Camera className="w-5 h-5" />
                    </button>
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
                        disabled={(!text.trim() && pendingAttachments.length === 0) || isSending || uploadingCount > 0}
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

interface AttachmentViewProps {
    att: NonNullable<ChatMessage['attachments']>[number];
    isMine: boolean;
}

function AttachmentView({ att, isMine }: AttachmentViewProps) {
    const url = att.signedUrl || '';
    const thumb = att.thumbnailSignedUrl || att.signedUrl || '';
    if (att.fileType === 'image') {
        return (
            <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={thumb}
                    alt=""
                    className="max-w-[220px] max-h-[220px] rounded-lg object-cover border border-white/20"
                />
            </a>
        );
    }
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
                isMine ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
        >
            <FileText className="w-4 h-4" />
            <span>PDFを開く</span>
        </a>
    );
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
                    {message.body && (
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
                    )}
                    {message.attachments && message.attachments.length > 0 && (
                        <div className={`flex flex-wrap gap-2 ${message.body ? 'mt-2' : ''}`}>
                            {message.attachments.map((att) => (
                                <AttachmentView key={att.id} att={att} isMine={isMine} />
                            ))}
                        </div>
                    )}
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
