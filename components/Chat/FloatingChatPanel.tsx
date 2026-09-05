'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
    MessageSquare,
    X,
    ExternalLink,
    ChevronUp,
    ChevronDown,
    PanelRight,
    PictureInPicture2,
} from 'lucide-react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useChatStore } from '@/stores/chatStore';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import type { ChatRoomSummary } from '@/types/chat';
import ChatRoomView from './ChatRoomView';

/**
 * チャット画面以外でチャットを開いておくためのパネル。
 * 「この現場空けれますか？」の確認で、スケジュールを見ながら返信できるようにするためのもの。
 *  - 幅768px未満(スマホ): 画面下のボトムシート。ヘッダーのタップで展開/折りたたみ
 *  - 幅768px以上(PC・iPad): chatPanelMode により
 *      floating = 自由に移動・リサイズできる画面内ウインドウ
 *      docked   = 右側の固定パネル（幅380px。本文は MainContent 側で右へ寄せる）
 *
 * 幅の判定は matchMedia を同期取得する（このコンポーネントは ssr:false で読まれるので
 * 初回描画から確定値が使える。hooks/useMediaQuery は初回 null を返すのでここでは使わない）。
 */
const WIDE_QUERY = '(min-width: 768px)';

export default function FloatingChatPanel() {
    const { data: session } = useSession();
    const router = useRouter();
    const { setActivePage } = useNavigation();
    const myUserId = session?.user?.id;

    const dockedRoomId = useChatStore((s) => s.dockedRoomId);
    const setDockedRoom = useChatStore((s) => s.setDockedRoom);
    const chatPanelMode = useChatStore((s) => s.chatPanelMode);
    const setChatPanelMode = useChatStore((s) => s.setChatPanelMode);
    const room = useChatStore(
        useCallback(
            (s) => (dockedRoomId ? s.rooms.find((r) => r.id === dockedRoomId) : undefined),
            [dockedRoomId]
        )
    );

    // 幅768px以上か（初期値も同期で取る＝初回描画のちらつき回避）
    const [isWide, setIsWide] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia(WIDE_QUERY).matches;
    });
    useEffect(() => {
        const mql = window.matchMedia(WIDE_QUERY);
        const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
        setIsWide(mql.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);

    // スマホ(768px未満)のボトムシートの開閉。768px以上(md:)の右端固定では無視される
    const [isCollapsed, setIsCollapsed] = useState(false);

    const isFloating = isWide && chatPanelMode === 'floating';
    const { rect, isInteracting, dragHandleProps, getResizeHandleProps } = useFloatingWindow(isFloating);

    const openInChatPage = useCallback(() => {
        if (!dockedRoomId) return;
        setActivePage('chat');
        router.push(`/?page=chat&roomId=${dockedRoomId}`);
        setDockedRoom(null);
    }, [dockedRoomId, setActivePage, router, setDockedRoom]);

    const toggleMode = useCallback(() => {
        setChatPanelMode(chatPanelMode === 'floating' ? 'docked' : 'floating');
    }, [chatPanelMode, setChatPanelMode]);

    if (!dockedRoomId) return null;

    const title = room ? roomLabel(room, myUserId) : 'チャット';
    const memberBadge = room && room.type !== 'dm' ? `参加${room.members.length}名` : null;

    /** ヘッダー右側のボタン群（フローティング・ドッキング共通） */
    const headerActions = (
        <>
            {isWide && (
                <button
                    type="button"
                    onClick={toggleMode}
                    className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    aria-label={isFloating ? '右端に固定' : 'ウインドウ表示'}
                    title={isFloating ? '右端に固定' : 'ウインドウ表示'}
                >
                    {isFloating ? <PanelRight className="w-4 h-4" /> : <PictureInPicture2 className="w-4 h-4" />}
                </button>
            )}
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
                title="閉じる"
            >
                <X className="w-4 h-4" />
            </button>
        </>
    );

    // --- 自由に移動・リサイズできるウインドウ（PC・iPad） ---
    if (isFloating) {
        return (
            <div
                // transform は使わない（中の fixed 配置ポップオーバーの基準がずれて壊れるため）。
                // z-30: モーダル(z-[60])より下に置く
                className="fixed z-30 bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                role="dialog"
                aria-label={`${title} のチャットウインドウ`}
            >
                {/* ヘッダー: ドラッグで移動 */}
                <div
                    {...dragHandleProps}
                    style={{ touchAction: 'none' }}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 h-12 border-b border-slate-200 bg-white select-none ${
                        isInteracting ? 'cursor-grabbing' : 'cursor-move'
                    }`}
                >
                    <MessageSquare className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <span className="flex-1 min-w-0 text-sm font-bold text-slate-900 truncate">{title}</span>
                    {memberBadge && (
                        <span className="text-[11px] text-slate-500 flex-shrink-0">{memberBadge}</span>
                    )}
                    {headerActions}
                </div>

                {/* 本文。ドラッグ/リサイズ中は誤操作しないように無効化 */}
                <div className={`flex-1 min-h-0 ${isInteracting ? 'pointer-events-none' : ''}`}>
                    {/* realtimeKey: 同じルームを案件詳細モーダル側でも開いたときにチャンネル名が衝突しないように */}
                    <ChatRoomView roomId={dockedRoomId} myUserId={myUserId} realtimeKey="docked" isFloating />
                </div>

                {/* リサイズハンドル（右下・左下）。L字の縁取りで「ここを掴める」と分かるようにする */}
                <div
                    {...getResizeHandleProps('se')}
                    style={{ touchAction: 'none' }}
                    className="absolute bottom-0 right-0 z-10 w-4 h-4 cursor-nwse-resize border-b-2 border-r-2 border-slate-300 rounded-br-xl"
                    aria-hidden="true"
                />
                <div
                    {...getResizeHandleProps('sw')}
                    style={{ touchAction: 'none' }}
                    className="absolute bottom-0 left-0 z-10 w-4 h-4 cursor-nesw-resize border-b-2 border-l-2 border-slate-300 rounded-bl-xl"
                    aria-hidden="true"
                />
            </div>
        );
    }

    // --- 右端に固定（768px以上=md: PC・iPad）／ボトムシート（768px未満=スマホ） ---
    // 幅の閾値は上の isWide(768px) と同じ md: に揃える（lg: はアスペクト比条件付きで iPad が外れる）
    return (
        <div
            className={`
                fixed z-30 bg-white shadow-2xl flex flex-col
                inset-x-0 bottom-0 border-t border-slate-200 rounded-t-2xl
                ${isCollapsed ? 'h-12' : 'h-[min(60vh,520px)]'}
                pb-[env(safe-area-inset-bottom,0px)]
                md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:w-[380px]
                md:h-auto md:rounded-none md:border-t-0 md:border-l md:border-slate-200 md:pb-0
            `}
        >
            {/* ヘッダー（スマホはタップで展開/折りたたみ） */}
            <div className="flex-shrink-0 flex items-center gap-1.5 px-3 h-12 border-b border-slate-200 bg-white md:rounded-none rounded-t-2xl">
                <button
                    type="button"
                    onClick={() => setIsCollapsed((v) => !v)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left md:cursor-default"
                    aria-label={isCollapsed ? 'チャットを開く' : 'チャットを折りたたむ'}
                >
                    <MessageSquare className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
                    {memberBadge && (
                        <span className="text-[11px] text-slate-500 flex-shrink-0">{memberBadge}</span>
                    )}
                    <span className="md:hidden flex-shrink-0 text-slate-400">
                        {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                </button>
                {headerActions}
            </div>

            <div className={`flex-1 min-h-0 ${isCollapsed ? 'hidden md:block' : ''}`}>
                {/* realtimeKey: 同じルームを案件詳細モーダル側でも開いたときにチャンネル名が衝突しないように */}
                <ChatRoomView roomId={dockedRoomId} myUserId={myUserId} realtimeKey="docked" isFloating />
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
