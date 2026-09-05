'use client';

import React from 'react';
import type { ChatRoomSummary } from '@/types/chat';

/**
 * チャットルーム一覧（チャット画面の左カラムと、スケジュール上のチャットウインドウで共用）。
 * 並びはストアの rooms の順（API 側でピン留め → 最終メッセージ順）をそのまま使う。
 */

/** 一覧・ヘッダーに出すルーム名。名前なしのDMは相手、グループはメンバー名を3人まで */
export function roomTitle(room: ChatRoomSummary, myUserId: string | undefined): string {
    if (room.name) return room.name;
    if (room.type === 'dm') {
        const other = room.members.find((m) => m.userId !== myUserId);
        return other?.displayName || 'ダイレクトメッセージ';
    }
    const others = room.members.filter((m) => m.userId !== myUserId);
    return others.map((m) => m.displayName).slice(0, 3).join(', ') || 'グループ';
}

/** 最終メッセージ時刻。当日は時刻、それ以外は M/D */
export function formatRoomTime(d: string | Date): string {
    const date = typeof d === 'string' ? new Date(d) : d;
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
        return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 検索欄の文字でルームを絞る（ルーム名・最終メッセージが対象） */
export function filterRooms(rooms: ChatRoomSummary[], search: string, myUserId: string | undefined): ChatRoomSummary[] {
    if (!search.trim()) return rooms;
    const q = search.toLowerCase();
    return rooms.filter((r) => {
        const title = roomTitle(r, myUserId);
        return title.toLowerCase().includes(q) ||
            (r.lastMessagePreview ?? '').toLowerCase().includes(q);
    });
}

interface ChatRoomListProps {
    rooms: ChatRoomSummary[];
    activeRoomId: string | null;
    onSelect: (roomId: string) => void;
    myUserId: string | undefined;
    /** true のあいだは「読み込み中」を出す（呼び出し側で「まだ1件も無い」条件と組み合わせる） */
    isLoading?: boolean;
    /** 0件のときの文言 */
    emptyMessage?: React.ReactNode;
    /** ウインドウ内などの狭い場所向けに行を詰める */
    compact?: boolean;
}

export default function ChatRoomList({
    rooms,
    activeRoomId,
    onSelect,
    myUserId,
    isLoading = false,
    emptyMessage = 'チャットがありません',
    compact = false,
}: ChatRoomListProps) {
    if (isLoading) {
        return <div className="p-8 text-center text-sm text-slate-400">読み込み中...</div>;
    }
    if (rooms.length === 0) {
        return <div className="p-8 text-center text-sm text-slate-400">{emptyMessage}</div>;
    }
    return (
        <ul className="divide-y divide-slate-200">
            {rooms.map((room) => {
                const title = roomTitle(room, myUserId);
                const isActive = activeRoomId === room.id;
                return (
                    <li key={room.id}>
                        <button
                            type="button"
                            onClick={() => onSelect(room.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`w-full text-left px-3 hover:bg-white transition-colors ${compact ? 'py-2' : 'py-3'} ${isActive ? 'bg-white' : ''}`}
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className={`rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 ${compact ? 'w-8 h-8 text-sm' : 'w-10 h-10'} ${room.type === 'project' ? 'bg-sky-500' : 'bg-slate-400'}`}
                                >
                                    {room.type === 'project' ? '案' : title.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-semibold text-slate-900 truncate flex-1 ${compact ? 'text-[13px]' : 'text-sm'}`}>
                                            {title}
                                        </span>
                                        {room.lastMessageAt && (
                                            <span className="text-[11px] text-slate-400 flex-shrink-0">
                                                {formatRoomTime(room.lastMessageAt)}
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
                );
            })}
        </ul>
    );
}
