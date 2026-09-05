'use client';

import React, { useCallback, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { MessageSquare, X, ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useChatStore } from '@/stores/chatStore';
import type { ChatRoomSummary } from '@/types/chat';
import ChatRoomView from './ChatRoomView';

/**
 * 画面端に貼り付けるチャット（ドッキング表示）。
 * 「この現場空けれますか？」の確認で、スケジュールを見ながら返信できるようにするためのもの。
 *  - PC(lg以上): 右側の固定パネル（幅380px）
 *  - モバイル(lg未満): 画面下のボトムシート。ヘッダーのタップで展開/折りたたみ
 * レイアウト切替は CSS（lg:）で行い useMediaQuery は使わない（初期描画のちらつき回避）。
 */
export default function DockedChatPanel() {
    const { data: session } = useSession();
    const router = useRouter();
    const { setActivePage } = useNavigation();
    const myUserId = session?.user?.id;

    const dockedRoomId = useChatStore((s) => s.dockedRoomId);
    const setDockedRoom = useChatStore((s) => s.setDockedRoom);
    const room = useChatStore(
        useCallback(
            (s) => (dockedRoomId ? s.rooms.find((r) => r.id === dockedRoomId) : undefined),
            [dockedRoomId]
        )
    );

    // モバイルのボトムシートの開閉。PC(lg以上)では無視される
    const [isCollapsed, setIsCollapsed] = useState(false);

    const openInChatPage = useCallback(() => {
        if (!dockedRoomId) return;
        setActivePage('chat');
        router.push(`/?page=chat&roomId=${dockedRoomId}`);
        setDockedRoom(null);
    }, [dockedRoomId, setActivePage, router, setDockedRoom]);

    if (!dockedRoomId) return null;

    const title = room ? roomLabel(room, myUserId) : 'チャット';

    return (
        <div
            className={`
                fixed z-30 bg-white shadow-2xl flex flex-col
                inset-x-0 bottom-0 border-t border-slate-200 rounded-t-2xl
                ${isCollapsed ? 'h-12' : 'h-[min(60vh,520px)]'}
                pb-[env(safe-area-inset-bottom,0px)]
                lg:inset-x-auto lg:top-0 lg:right-0 lg:bottom-0 lg:w-[380px]
                lg:h-auto lg:rounded-none lg:border-t-0 lg:border-l lg:border-slate-200 lg:pb-0
            `}
        >
            {/* ヘッダー（モバイルはタップで展開/折りたたみ） */}
            <div className="flex-shrink-0 flex items-center gap-1.5 px-3 h-12 border-b border-slate-200 bg-white lg:rounded-none rounded-t-2xl">
                <button
                    type="button"
                    onClick={() => setIsCollapsed((v) => !v)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left lg:cursor-default"
                    aria-label={isCollapsed ? 'チャットを開く' : 'チャットを折りたたむ'}
                >
                    <MessageSquare className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
                    {room && room.type !== 'dm' && (
                        <span className="text-[11px] text-slate-500 flex-shrink-0">
                            参加{room.members.length}名
                        </span>
                    )}
                    <span className="lg:hidden flex-shrink-0 text-slate-400">
                        {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                </button>
                <button
                    type="button"
                    onClick={openInChatPage}
                    className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    aria-label="チャットで開く"
                    title="チャットで開く"
                >
                    <ExternalLink className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setDockedRoom(null)}
                    className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    aria-label="閉じる"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className={`flex-1 min-h-0 ${isCollapsed ? 'hidden lg:block' : ''}`}>
                {/* realtimeKey: 同じルームを案件詳細モーダル側でも開いたときにチャンネル名が衝突しないように */}
                <ChatRoomView roomId={dockedRoomId} myUserId={myUserId} realtimeKey="docked" />
            </div>
        </div>
    );
}

/** ChatRoomView 内の roomLabel と同じロジック */
function roomLabel(room: ChatRoomSummary, myUserId: string | undefined): string {
    if (room.name) return room.name;
    if (room.type === 'dm') {
        const other = room.members.find((m) => m.userId !== myUserId);
        return other?.displayName || 'ダイレクトメッセージ';
    }
    const others = room.members.filter((m) => m.userId !== myUserId);
    return others.map((m) => m.displayName).slice(0, 3).join(', ') || 'チャット';
}
