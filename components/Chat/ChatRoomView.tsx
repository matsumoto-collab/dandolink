'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, Send, Users, ChevronDown, ChevronUp, UserPlus, Paperclip, Camera, X, FileText, Smile, MoreHorizontal, Trash2, Pencil, SmilePlus, CalendarDays, PictureInPicture2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { useNavigation } from '@/contexts/NavigationContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import InviteMembersModal from './InviteMembersModal';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';
import { useChatStore } from '@/stores/chatStore';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import type { ChatRoomSummary, ChatMessage, ProjectScheduleItem, ProjectScheduleResponse } from '@/types/chat';
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
import { REACTION_EMOJIS } from '@/lib/chat/reactions';

const EMPTY_MESSAGES: ChatMessage[] = [];

/** 週間カレンダー画面を持たないロール（「予定」ボタンを出さない） */
const ROLES_WITHOUT_CALENDAR = ['worker', 'partner', 'partner_member', 'accountant'];

const PRESET_STAMPS: { emoji: string; text: string }[] = [
    { emoji: '👍', text: '了解しました' },
    { emoji: '🙏', text: 'ありがとうございます' },
    { emoji: '🙇', text: 'よろしくお願いします' },
    { emoji: '😊', text: 'とんでもございません！' },
    { emoji: '💪', text: 'がんばります！' },
    { emoji: '🙏💦', text: 'ごめんなさい' },
];

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
    /**
     * 予定へジャンプする直前に呼ばれる。モーダル内に埋め込まれている場合は
     * 親モーダルを閉じるために使う（閉じないとカレンダーが裏に隠れたままになる）。
     */
    onNavigateAway?: () => void;
    /**
     * Realtime チャンネル名の接尾辞。同じルームを2箇所で同時に開く呼び出し元
     * （ドッキング表示）が指定する。未指定同士が同時に立つと購読が片方外れる。
     */
    realtimeKey?: string;
    /**
     * ウインドウ／画面端パネルの中に描画されているか。
     * true のときは「ウインドウ」ボタンを出さない（すでにウインドウ表示中のため）。
     */
    isFloating?: boolean;
}

export default function ChatRoomView({ roomId, myUserId, onBack, onNavigateAway, realtimeKey, isFloating }: ChatRoomViewProps) {
    const { data: session } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const { activePage, setActivePage } = useNavigation();
    const canInvite = session?.user?.role !== 'partner';
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    // 「ウインドウ」ボタンの表示判定。iPad縦(768px)も対象に含める
    const isWideScreen = useMediaQuery('(min-width: 768px)');
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
    const renameRoom = useChatStore((s) => s.renameRoom);
    const deleteRoom = useChatStore((s) => s.deleteRoom);

    // グループの管理（名称変更・削除）はオーナーまたは管理者のみ
    const myMember = room?.members.find((m) => m.userId === myUserId);
    const canManageRoom =
        room?.type === 'group' && (myMember?.role === 'owner' || session?.user?.role === 'admin');

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
    const [showStamps, setShowStamps] = useState(false);
    // 案件チャットの「予定」ポップオーバー
    const [showSchedule, setShowSchedule] = useState(false);
    const [scheduleItems, setScheduleItems] = useState<ProjectScheduleItem[]>([]);
    const [scheduleTodayKey, setScheduleTodayKey] = useState('');
    const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
    const [scheduleError, setScheduleError] = useState(false);
    const [showPastSchedule, setShowPastSchedule] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const lastMessageIdRef = useRef<string | null>(null);
    const lastReadIdRef = useRef<string | null>(null);
    // メンション候補ポップオーバー内（検索欄など）を押している最中フラグ。
    // relatedTarget が取れない環境向けの補完（300ms で自動解除＝取りこぼしを残さない）
    const popoverHoldRef = useRef(false);

    useChatRealtime(roomId, realtimeKey);

    // 「予定」ボタンの表示条件: 案件チャットで、週間カレンダーを持つロールのときだけ
    const myRoleLower = (session?.user?.role ?? '').toLowerCase();
    const canViewSchedule = !ROLES_WITHOUT_CALENDAR.includes(myRoleLower);
    const showScheduleButton = canViewSchedule && room?.type === 'project' && !!room?.projectMasterId;

    // ポップオーバーを開いたときに取得（deps はプリミティブのみ）
    useEffect(() => {
        if (!showSchedule) return;
        let cancelled = false;
        setIsLoadingSchedule(true);
        setScheduleError(false);
        (async () => {
            try {
                const res = await fetch(`/api/chat/rooms/${roomId}/schedule`, { cache: 'no-store' });
                if (!res.ok) throw new Error('schedule fetch failed');
                const data: ProjectScheduleResponse = await res.json();
                if (cancelled) return;
                setScheduleItems(data.items ?? []);
                setScheduleTodayKey(data.todayKey ?? '');
            } catch (e) {
                logger.error('[chat] fetch schedule', e);
                if (!cancelled) setScheduleError(true);
            } finally {
                if (!cancelled) setIsLoadingSchedule(false);
            }
        })();
        return () => { cancelled = true; };
    }, [showSchedule, roomId]);

    // ルームが切り替わったらポップオーバーは畳む
    useEffect(() => {
        setShowSchedule(false);
        setShowPastSchedule(false);
    }, [roomId]);

    const pastScheduleItems = useMemo(
        () => scheduleItems.filter((it) => scheduleTodayKey && it.dateKey < scheduleTodayKey),
        [scheduleItems, scheduleTodayKey]
    );
    const upcomingScheduleItems = useMemo(
        () => scheduleItems.filter((it) => !scheduleTodayKey || it.dateKey >= scheduleTodayKey),
        [scheduleItems, scheduleTodayKey]
    );

    /**
     * 予定の行クリック → 週間カレンダーのその日へジャンプし、チャットは画面端にドッキングする。
     * 遷移は NavigationContext 直接更新 + router.push の二段構え（通知ディープリンクと同じ規約）。
     */
    const navigateToSchedule = useCallback((item: ProjectScheduleItem) => {
        setShowSchedule(false);
        onNavigateAway?.();
        setActivePage('schedule');
        const params = new URLSearchParams();
        params.set('page', 'schedule');
        params.set('view', 'calendar');
        params.set('date', item.dateKey);
        params.set('assignmentId', item.id);
        params.set('chatRoomId', roomId);
        router.push(`/?${params.toString()}`);
    }, [onNavigateAway, setActivePage, router, roomId]);

    /**
     * 「ウインドウ」→ チャットを画面内のフローティングウインドウへ移す。
     * ウインドウを出すのはトップ(/)のメイン画面だけなので、そこに居ないときは
     * スケジュール画面へ移してから出す（遷移は /?page= 経由）。
     *   - チャット画面: 同じルームを二重に開かないためパネルを出さない仕様
     *   - /project-masters など別ルート: そもそもパネルが描画されない
     */
    const openInFloatingWindow = useCallback(() => {
        onNavigateAway?.();
        const store = useChatStore.getState();
        // 「ウインドウ」を押したのだから、以前「右端に固定」を選んでいてもウインドウ表示で出す
        store.setChatPanelMode('floating');
        store.setDockedRoom(roomId);
        if (activePage === 'chat' || pathname !== '/') {
            setActivePage('schedule');
            router.push('/?page=schedule');
        }
    }, [onNavigateAway, roomId, activePage, pathname, setActivePage, router]);

    // 入力欄からフォーカスが外れたときの候補ポップオーバー閉じ判定。
    // ポップオーバー内の検索欄へフォーカスが移った場合は閉じない（閉じると検索できない）。
    const onComposerBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
        const next = e.relatedTarget as HTMLElement | null;
        if (next && typeof next.closest === 'function' && next.closest('[data-mention-popover]')) return;
        setTimeout(() => {
            if (popoverHoldRef.current) return;
            setMentionTrigger(null);
        }, 100);
    };
    const holdPopover = () => {
        popoverHoldRef.current = true;
        setTimeout(() => { popoverHoldRef.current = false; }, 300);
    };

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

    const startEditName = () => {
        setNameInput(room?.name ?? '');
        setIsEditingName(true);
    };

    const saveName = async () => {
        const v = nameInput.trim();
        if (!v) {
            toast.error('グループ名を入力してください', { position: 'bottom-center' });
            return;
        }
        setIsSavingName(true);
        const ok = await renameRoom(roomId, v);
        setIsSavingName(false);
        if (ok) {
            setIsEditingName(false);
            toast.success('グループ名を変更しました', { position: 'bottom-center' });
        } else {
            toast.error('グループ名の変更に失敗しました', { position: 'bottom-center' });
        }
    };

    const handleDeleteGroup = async () => {
        if (!window.confirm('このグループを削除しますか？\nすべてのメッセージ履歴が完全に削除され、元に戻せません。')) return;
        const ok = await deleteRoom(roomId);
        if (ok) {
            toast.success('グループを削除しました', { position: 'bottom-center' });
        } else {
            toast.error('グループの削除に失敗しました', { position: 'bottom-center' });
        }
    };

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
                toast.error(`アップロード失敗: ${f.name}`, { position: 'bottom-center' });
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

    const sendStamp = async (stamp: { emoji: string; text: string }) => {
        if (isSending) return;
        setShowStamps(false);
        const body = `${stamp.text} ${stamp.emoji}`;
        await sendMessage(roomId, body, [], []);
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
        // 送信は常に送信ボタン or Shift+Enter から。Enter単体は改行
        if (isDesktop && e.key === 'Enter' && e.shiftKey && !e.nativeEvent.isComposing) {
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
                        {isEditingName ? (
                            <div className="flex items-center gap-1.5">
                                <input
                                    value={nameInput}
                                    onChange={(e) => setNameInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); saveName(); }
                                        if (e.key === 'Escape') setIsEditingName(false);
                                    }}
                                    autoFocus
                                    placeholder="グループ名"
                                    className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 shadow-sm"
                                />
                                <button
                                    type="button"
                                    onClick={saveName}
                                    disabled={isSavingName}
                                    className="flex-shrink-0 px-2.5 py-1 text-xs font-medium rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40"
                                >
                                    保存
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsEditingName(false)}
                                    className="flex-shrink-0 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5">
                                <h2 className="text-base font-bold text-slate-900 truncate">
                                    {room ? roomLabel(room, myUserId) : '...'}
                                </h2>
                                {canManageRoom && (
                                    <button
                                        type="button"
                                        onClick={startEditName}
                                        className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                                        aria-label="グループ名を変更"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        )}
                        {room && room.type !== 'dm' && !isEditingName && (
                            <p className="text-xs text-slate-500 truncate">
                                {room.members.length}名が参加
                            </p>
                        )}
                    </div>
                    {!isFloating && isWideScreen === true && (
                        <button
                            type="button"
                            onClick={openInFloatingWindow}
                            className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100"
                            aria-label="チャットをウインドウで開く"
                            title="チャットをウインドウで開く"
                        >
                            <PictureInPicture2 className="w-4 h-4" />
                            <span>ウインドウ</span>
                        </button>
                    )}
                    {showScheduleButton && (
                        <div className="relative flex-shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowSchedule((v) => !v)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium ${
                                    showSchedule ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-100'
                                }`}
                                aria-label="この案件の予定"
                            >
                                <CalendarDays className="w-4 h-4" />
                                <span>予定</span>
                            </button>
                            {showSchedule && (
                                <>
                                    <div className="fixed inset-0 z-20" onClick={() => setShowSchedule(false)} />
                                    <div className="absolute z-30 top-full right-0 mt-2 w-[19rem] max-w-[85vw] bg-white rounded-xl shadow-lg border border-slate-200 p-2">
                                        <p className="px-1 pb-1.5 text-[11px] font-semibold text-slate-500">
                                            この案件の予定（タップでカレンダーへ）
                                        </p>
                                        {isLoadingSchedule ? (
                                            <div className="flex items-center justify-center py-6">
                                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-500" />
                                            </div>
                                        ) : scheduleError ? (
                                            <p className="px-1 py-4 text-center text-xs text-rose-600">
                                                予定を取得できませんでした
                                            </p>
                                        ) : (
                                            <div className="max-h-72 overflow-y-auto">
                                                {pastScheduleItems.length > 0 && (
                                                    <>
                                                        {showPastSchedule && (
                                                            <ul className="space-y-1 mb-1">
                                                                {pastScheduleItems.map((it) => (
                                                                    <ScheduleRow
                                                                        key={it.id}
                                                                        item={it}
                                                                        isPast
                                                                        onClick={() => navigateToSchedule(it)}
                                                                    />
                                                                ))}
                                                            </ul>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPastSchedule((v) => !v)}
                                                            className="w-full text-center py-1 mb-1 text-[11px] text-slate-500 hover:text-slate-700 underline"
                                                        >
                                                            {showPastSchedule
                                                                ? '過去の予定を隠す'
                                                                : `過去の予定を表示（${pastScheduleItems.length}件）`}
                                                        </button>
                                                    </>
                                                )}
                                                {upcomingScheduleItems.length > 0 ? (
                                                    <ul className="space-y-1">
                                                        {upcomingScheduleItems.map((it) => (
                                                            <ScheduleRow
                                                                key={it.id}
                                                                item={it}
                                                                onClick={() => navigateToSchedule(it)}
                                                            />
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="px-1 py-4 text-center text-xs text-slate-400">
                                                        今後の予定はありません
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    {room && room.type !== 'dm' && (
                        <button
                            type="button"
                            onClick={() => setShowMembers((v) => !v)}
                            className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100"
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
                            {canInvite && (
                                <button
                                    type="button"
                                    onClick={() => setShowInvite(true)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white shadow-sm"
                                >
                                    <UserPlus className="w-3.5 h-3.5" />
                                    追加
                                </button>
                            )}
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
                                    <span className="w-5 h-5 rounded-full bg-slate-400 text-white text-[10px] font-bold flex items-center justify-center">
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
                        {canManageRoom && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                                <button
                                    type="button"
                                    onClick={handleDeleteGroup}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 border border-rose-200 hover:bg-rose-50"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    グループを削除
                                </button>
                                <p className="text-[10px] text-slate-400 mt-1.5">
                                    削除するとすべてのメッセージ履歴が完全に消え、元に戻せません。
                                </p>
                            </div>
                        )}
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
                            myUserId={myUserId}
                            senderName={memberMap.get(msg.senderId) ?? '(不明)'}
                            memberMap={memberMap}
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
                {/* モバイル: テキスト欄を1段目、ボタン群を2段目に分離 */}
                <div className="lg:hidden flex flex-col gap-2 relative">
                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={text}
                            onChange={onTextChange}
                            onKeyDown={onKeyDown}
                            onBlur={onComposerBlur}
                            rows={2}
                            placeholder="メッセージを入力"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm resize-none max-h-40"
                            style={{ minHeight: 64 }}
                        />
                        {mentionTrigger && (
                            <div data-mention-popover onMouseDown={holdPopover} onTouchStart={holdPopover}>
                                <MentionSuggestPopover
                                    trigger={mentionTrigger.trigger}
                                    query={mentionTrigger.query}
                                    roomId={roomId}
                                    onSelect={onSelectMention}
                                    onClose={() => setMentionTrigger(null)}
                                />
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
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
                            className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 flex-shrink-0"
                            aria-label="カメラ"
                        >
                            <Camera className="w-5 h-5" />
                        </button>
                        <div className="relative flex-shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowStamps((v) => !v)}
                                className={`inline-flex items-center justify-center w-11 h-11 rounded-xl border ${showStamps ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                                aria-label="スタンプ"
                            >
                                <Smile className="w-5 h-5" />
                            </button>
                            {showStamps && (
                                <div className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 z-30 p-2">
                                    <ul className="grid grid-cols-1 gap-1">
                                        {PRESET_STAMPS.map((s) => (
                                            <li key={s.text}>
                                                <button
                                                    type="button"
                                                    onClick={() => sendStamp(s)}
                                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-slate-700 hover:bg-slate-50"
                                                >
                                                    <span className="flex-1">{s.text}</span>
                                                    <span className="text-lg leading-none">{s.emoji}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="flex-1" />
                        <button
                            onClick={onSend}
                            disabled={(!text.trim() && pendingAttachments.length === 0) || isSending || uploadingCount > 0}
                            className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 shadow-sm flex-shrink-0"
                            aria-label="送信"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* PC: 横一列レイアウト（mobileと同じrefを使うのでカスタムrefは省略・popoverは PC 側に再掲） */}
                <div className="hidden lg:flex items-end gap-2 relative">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 flex-shrink-0"
                        aria-label="ファイル添付"
                    >
                        <Paperclip className="w-5 h-5" />
                    </button>
                    <div className="relative flex-shrink-0">
                        <button
                            type="button"
                            onClick={() => setShowStamps((v) => !v)}
                            className={`inline-flex items-center justify-center w-11 h-11 rounded-xl border ${showStamps ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                            aria-label="スタンプ"
                        >
                            <Smile className="w-5 h-5" />
                        </button>
                        {showStamps && (
                            <div className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 z-30 p-2">
                                <ul className="grid grid-cols-1 gap-1">
                                    {PRESET_STAMPS.map((s) => (
                                        <li key={s.text}>
                                            <button
                                                type="button"
                                                onClick={() => sendStamp(s)}
                                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                                <span className="flex-1">{s.text}</span>
                                                <span className="text-lg leading-none">{s.emoji}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 relative">
                        <textarea
                            ref={(el) => { if (el) textareaRef.current = el; }}
                            value={text}
                            onChange={onTextChange}
                            onKeyDown={onKeyDown}
                            onBlur={onComposerBlur}
                            rows={1}
                            placeholder="メッセージを入力（Shift+Enterで送信）"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm resize-none max-h-32"
                            style={{ minHeight: 44 }}
                        />
                        {mentionTrigger && (
                            <div data-mention-popover onMouseDown={holdPopover} onTouchStart={holdPopover}>
                                <MentionSuggestPopover
                                    trigger={mentionTrigger.trigger}
                                    query={mentionTrigger.query}
                                    roomId={roomId}
                                    onSelect={onSelectMention}
                                    onClose={() => setMentionTrigger(null)}
                                />
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onSend}
                        disabled={(!text.trim() && pendingAttachments.length === 0) || isSending || uploadingCount > 0}
                        className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 shadow-sm flex-shrink-0"
                        aria-label="送信"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
}

/** 'YYYY-MM-DD' → 「9/8(月)」 */
function formatScheduleDateLabel(dateKey: string): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    if (!y || !m || !d) return dateKey;
    const date = new Date(y, m - 1, d);
    return `${formatDate(date, 'short')}(${getDayOfWeekString(date, 'short')})`;
}

interface ScheduleRowProps {
    item: ProjectScheduleItem;
    isPast?: boolean;
    onClick: () => void;
}

/** 「予定」ポップオーバーの1行 */
function ScheduleRow({ item, isPast = false, onClick }: ScheduleRowProps) {
    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                className={`w-full text-left px-2 py-2 rounded-lg hover:bg-slate-50 ${isPast ? 'opacity-60' : ''}`}
            >
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">
                        {formatScheduleDateLabel(item.dateKey)}
                    </span>
                    <span className="text-xs text-slate-700 truncate">{item.foremanName}</span>
                    {item.isTentative && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                            仮
                        </span>
                    )}
                    {item.isDispatchConfirmed && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                            手配済
                        </span>
                    )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span>{item.memberCount}人 · {item.estimatedHours}h</span>
                    {item.constructionTypeName && (
                        <span className="truncate">{item.constructionTypeName}</span>
                    )}
                </div>
            </button>
        </li>
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
    // 日付が変わっても時刻は常に表示する（当日は時刻のみ、過去日は「6/8 16:53」形式）
    const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) {
        return time;
    }
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

interface MessageBubbleProps {
    message: ChatMessage;
    isMine: boolean;
    myUserId: string | undefined;
    senderName: string;
    memberMap: Map<string, string>;
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

function MessageBubble({ message, isMine, myUserId, senderName, memberMap }: MessageBubbleProps) {
    const isDeleted = !!message.deletedAt;
    const [showReaders, setShowReaders] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showReactionPicker, setShowReactionPicker] = useState(false);
    // ピッカーは fixed 配置で画面内にクランプする（absolute だと長文メッセージで
    // ボタンが画面端に寄ったとき左右にはみ出して絵文字が切れるため）
    const [pickerPos, setPickerPos] = useState<{ left: number; bottom: number } | null>(null);
    const reactionButtonRef = useRef<HTMLButtonElement>(null);
    const deleteMessage = useChatStore((s) => s.deleteMessage);
    const toggleReaction = useChatStore((s) => s.toggleReaction);
    const canUnsend = isMine && !isDeleted;

    const openReactionPicker = () => {
        if (showReactionPicker) {
            setShowReactionPicker(false);
            return;
        }
        const btn = reactionButtonRef.current;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        // ピッカー実幅: 絵文字ボタン w-9(36px)×n + gap-0.5(2px)×(n-1) + px-1.5(12px) + border(2px)
        const pickerWidth = REACTION_EMOJIS.length * 36 + (REACTION_EMOJIS.length - 1) * 2 + 14;
        const margin = 8;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - pickerWidth - margin));
        setPickerPos({ left, bottom: window.innerHeight - rect.top + 4 });
        setShowReactionPicker(true);
    };

    const handleUnsend = async () => {
        setShowMenu(false);
        if (!window.confirm('このメッセージの送信を取り消しますか？')) return;
        const ok = await deleteMessage(message.id, message.roomId);
        if (!ok) {
            toast.error('送信の取り消しに失敗しました', { position: 'bottom-center' });
        }
    };

    const onPickReaction = (emoji: string) => {
        setShowReactionPicker(false);
        if (!myUserId) return;
        toggleReaction(message.id, message.roomId, emoji, myUserId);
    };

    // 絵文字ごとに集計（REACTION_EMOJIS の順で並べる）
    const reactionGroups = useMemo(() => {
        const list = message.reactions ?? [];
        const map = new Map<string, string[]>();
        for (const r of list) {
            const arr = map.get(r.emoji) ?? [];
            arr.push(r.userId);
            map.set(r.emoji, arr);
        }
        const ordered = [
            ...REACTION_EMOJIS.filter((e) => map.has(e)),
            ...Array.from(map.keys()).filter((e) => !(REACTION_EMOJIS as readonly string[]).includes(e)),
        ];
        return ordered.map((emoji) => ({ emoji, userIds: map.get(emoji)! }));
    }, [message.reactions]);

    // リアクション追加トリガ + 送信取り消しメニュー（吹き出しの脇に配置）
    const controls = !isDeleted ? (
        <div className="flex items-center gap-0.5 flex-shrink-0">
            <div className="relative">
                <button
                    ref={reactionButtonRef}
                    type="button"
                    onClick={openReactionPicker}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    aria-label="リアクション"
                >
                    <SmilePlus className="w-4 h-4" />
                </button>
                {showReactionPicker && pickerPos && (
                    <>
                        <div className="fixed inset-0 z-20" onClick={() => setShowReactionPicker(false)} />
                        <div
                            className="fixed z-30 bg-white rounded-full shadow-lg border border-slate-200 px-1.5 py-1 flex items-center gap-0.5"
                            style={{ left: pickerPos.left, bottom: pickerPos.bottom }}
                        >
                            {REACTION_EMOJIS.map((e) => (
                                <button
                                    key={e}
                                    type="button"
                                    onClick={() => onPickReaction(e)}
                                    className="w-9 h-9 inline-flex items-center justify-center rounded-full text-xl hover:bg-slate-100 active:scale-95"
                                >
                                    {e}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
            {canUnsend && (
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setShowMenu((v) => !v)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        aria-label="メッセージ操作"
                    >
                        <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {showMenu && (
                        <>
                            <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
                            <div className="absolute z-30 bottom-full mb-1 right-0 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
                                <button
                                    type="button"
                                    onClick={handleUnsend}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                                >
                                    <Trash2 className="w-4 h-4 flex-shrink-0" />
                                    送信を取り消す
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    ) : null;

    return (
        <li className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                {!isMine && (
                    <span className="text-[11px] text-slate-500 mb-0.5 px-1">{senderName}</span>
                )}
                <div className="flex items-center gap-1">
                    {isMine && controls}
                    <div
                        className={`rounded-xl px-3 py-2 shadow-sm ${
                            isDeleted
                                ? 'bg-slate-100 text-slate-400 italic border border-slate-200'
                                : isMine
                                    ? 'bg-teal-600 text-white'
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
                                    ) : part.kind === 'link' ? (
                                        <a
                                            key={i}
                                            href={part.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className={`underline break-all ${
                                                isMine ? 'text-white decoration-white/60' : 'text-teal-700 hover:text-teal-800'
                                            }`}
                                        >
                                            {part.text}
                                        </a>
                                    ) : (
                                        <MentionChip key={i} token={part.token} onMine={isMine} />
                                    )
                                )}
                            </p>
                        )}
                        {!isDeleted && message.attachments && message.attachments.length > 0 && (
                            <div className={`flex flex-wrap gap-2 ${message.body ? 'mt-2' : ''}`}>
                                {message.attachments.map((att) => (
                                    <AttachmentView key={att.id} att={att} isMine={isMine} />
                                ))}
                            </div>
                        )}
                    </div>
                    {!isMine && controls}
                </div>
                {!isDeleted && reactionGroups.length > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                        {reactionGroups.map((g) => {
                            const mine = myUserId ? g.userIds.includes(myUserId) : false;
                            const names = g.userIds.map((uid) => memberMap.get(uid) ?? '(不明)').join('、');
                            return (
                                <button
                                    key={g.emoji}
                                    type="button"
                                    title={names}
                                    onClick={() => myUserId && toggleReaction(message.id, message.roomId, g.emoji, myUserId)}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                        mine
                                            ? 'bg-teal-50 border-teal-300 text-teal-700'
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    <span className="text-sm leading-none">{g.emoji}</span>
                                    <span className="text-[11px] font-medium tabular-nums">{g.userIds.length}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
                <span className={`text-[10px] text-slate-400 mt-0.5 px-1 ${isMine ? 'text-right' : 'text-left'}`}>
                    {formatTime(message.createdAt)}
                    {!isDeleted && message.editedAt && '（編集済み）'}
                    {!isDeleted && isMine && message.reads && message.reads.length > 0 && (
                        <span className="relative inline-block ml-2">
                            <button
                                type="button"
                                onClick={() => setShowReaders((v) => !v)}
                                className="text-teal-600 font-medium hover:underline"
                            >
                                既読 {message.reads.length}
                            </button>
                            {showReaders && (
                                <span
                                    className="absolute right-0 bottom-full mb-1 z-20 w-48 max-h-56 overflow-y-auto bg-white rounded-xl shadow-lg border border-slate-200 p-2 text-left"
                                    onMouseLeave={() => setShowReaders(false)}
                                >
                                    <span className="block text-[10px] font-semibold text-slate-500 px-1 mb-1">既読者</span>
                                    <ul className="space-y-1">
                                        {message.reads.map((r) => (
                                            <li
                                                key={r.userId}
                                                className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-700"
                                            >
                                                <span className="truncate">{memberMap.get(r.userId) ?? '(不明)'}</span>
                                                <span className="text-[10px] text-slate-400 flex-shrink-0">
                                                    {formatTime(r.readAt)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </span>
                            )}
                        </span>
                    )}
                </span>
            </div>
        </li>
    );
}
