'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
    MessageSquare,
    X,
    ExternalLink,
    ChevronUp,
    ChevronDown,
    PanelLeftClose,
    PanelLeftOpen,
    List,
    Search,
} from 'lucide-react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useChatStore } from '@/stores/chatStore';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import ChatRoomView from './ChatRoomView';
import ChatRoomList, { filterRooms, roomTitle } from './ChatRoomList';

/**
 * チャット画面以外でチャットを開いておくためのパネル。
 * 「この現場空けれますか？」の確認で、スケジュールを見ながら返信できるようにするためのもの。
 *  - 幅768px以上(PC・iPad): 自由に移動・リサイズできる画面内ウインドウ（常にこの表示）
 *  - 幅768px未満(スマホ): 画面下のボトムシート。ヘッダーのタップで展開/折りたたみ
 *
 * チャット一覧（グループ・案件・DM）もここから切り替えられる。
 *  - ウインドウ幅が LIST_COLUMN_MIN_WINDOW_W 以上: 左カラムとして常時表示（ヘッダーのボタンで隠せる）
 *  - それ未満・ボトムシート: 自動で折りたたみ。ヘッダーのボタンでチャットの上に重ねて出す
 *
 * 幅の判定は matchMedia を同期取得する（このコンポーネントは ssr:false で読まれるので
 * 初回描画から確定値が使える。hooks/useMediaQuery は初回 null を返すのでここでは使わない）。
 */
const WIDE_QUERY = '(min-width: 768px)';
/** ウインドウ幅がこれ以上なら一覧を左カラムとして出す（一覧240px＋チャット400px） */
const LIST_COLUMN_MIN_WINDOW_W = 640;
const LIST_COLUMN_W = 240;

export default function FloatingChatPanel() {
    const { data: session } = useSession();
    const router = useRouter();
    const { setActivePage } = useNavigation();
    const myUserId = session?.user?.id;

    const dockedRoomId = useChatStore((s) => s.dockedRoomId);
    const setDockedRoom = useChatStore((s) => s.setDockedRoom);
    // 一覧はサイドバーが全ページで取得・Realtime 更新しているストアの rooms をそのまま使う
    const rooms = useChatStore((s) => s.rooms);
    const isLoadingRooms = useChatStore((s) => s.isLoadingRooms);
    const room = useMemo(
        () => (dockedRoomId ? rooms.find((r) => r.id === dockedRoomId) : undefined),
        [rooms, dockedRoomId]
    );

    // 幅768px以上か＝ウインドウ表示（初期値も同期で取る＝初回描画のちらつき回避）
    const [isFloating, setIsFloating] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia(WIDE_QUERY).matches;
    });
    useEffect(() => {
        const mql = window.matchMedia(WIDE_QUERY);
        const handler = (e: MediaQueryListEvent) => setIsFloating(e.matches);
        setIsFloating(mql.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);

    // スマホ(768px未満)のボトムシートの開閉
    const [isCollapsed, setIsCollapsed] = useState(false);

    const { rect, isInteracting, dragHandleProps, getResizeHandleProps } = useFloatingWindow(isFloating);

    // --- チャット一覧の表示状態 ---
    // canShowColumn: ウインドウが十分広く、一覧を左カラムとして並べられる
    // isColumnHidden: 広いときにユーザーが手で隠した（幅が変わっても指定は保つ）
    // isListOpen: 狭いときにチャットの上へ重ねて出している
    const canShowColumn = isFloating && rect.w >= LIST_COLUMN_MIN_WINDOW_W;
    const [isColumnHidden, setIsColumnHidden] = useState(false);
    const [isListOpen, setIsListOpen] = useState(false);
    const [listSearch, setListSearch] = useState('');
    const showColumn = canShowColumn && !isColumnHidden;

    // 広げてカラム表示になったら、重ねて出していた一覧は閉じる（二重に出さない）
    useEffect(() => {
        if (showColumn) setIsListOpen(false);
    }, [showColumn]);

    const filteredRooms = useMemo(() => filterRooms(rooms, listSearch, myUserId), [rooms, listSearch, myUserId]);

    // 今開いているルーム以外の未読（一覧ボタンのバッジ。ミュート中はストアの totalUnread と同じく除外）
    const otherUnread = useMemo(
        () => rooms.reduce((sum, r) => (r.id === dockedRoomId || r.isMuted ? sum : sum + (r.unreadCount || 0)), 0),
        [rooms, dockedRoomId]
    );

    const selectRoom = useCallback(
        (roomId: string) => {
            setDockedRoom(roomId);
            setIsListOpen(false);
        },
        [setDockedRoom]
    );

    const toggleList = useCallback(() => {
        if (canShowColumn) {
            setIsColumnHidden((v) => !v);
            return;
        }
        setIsListOpen((v) => !v);
        // ボトムシートを畳んだまま押されたら展開もする（畳んだ中で開いても見えない）
        setIsCollapsed(false);
    }, [canShowColumn]);

    const openInChatPage = useCallback(() => {
        if (!dockedRoomId) return;
        setActivePage('chat');
        router.push(`/?page=chat&roomId=${dockedRoomId}`);
        setDockedRoom(null);
    }, [dockedRoomId, setActivePage, router, setDockedRoom]);

    if (!dockedRoomId) return null;

    const title = room ? roomTitle(room, myUserId) : 'チャット';
    const memberBadge = room && room.type !== 'dm' ? `参加${room.members.length}名` : null;

    const listButtonLabel = canShowColumn
        ? (showColumn ? '一覧を隠す' : '一覧を表示')
        : (isListOpen ? '一覧を閉じる' : 'チャット一覧');

    /** ヘッダー左端: チャット一覧の開閉。他ルームの未読はバッジで知らせる */
    const listButton = (
        <button
            type="button"
            onClick={toggleList}
            className="relative flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
            aria-label={listButtonLabel}
            aria-pressed={canShowColumn ? showColumn : isListOpen}
            title={listButtonLabel}
        >
            {canShowColumn
                ? (showColumn ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />)
                : <List className="w-4 h-4" />}
            {otherUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-4 text-center">
                    {otherUnread > 99 ? '99+' : otherUnread}
                </span>
            )}
        </button>
    );

    /** ヘッダー右側のボタン群（ウインドウ・ボトムシート共通） */
    const headerActions = (
        <>
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

    /** 一覧の中身（検索欄＋ルーム一覧）。左カラムと重ね表示で共用 */
    const listPanel = (
        <div className="flex flex-col h-full min-h-0 bg-slate-50">
            <div className="flex-shrink-0 p-2 border-b border-slate-200 bg-white">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                        value={listSearch}
                        onChange={(e) => setListSearch(e.target.value)}
                        placeholder="検索"
                        aria-label="チャットを検索"
                        className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500 bg-white"
                    />
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
                <ChatRoomList
                    rooms={filteredRooms}
                    activeRoomId={dockedRoomId}
                    onSelect={selectRoom}
                    myUserId={myUserId}
                    isLoading={isLoadingRooms && rooms.length === 0}
                    compact
                />
            </div>
        </div>
    );

    /** 本文: （左カラム）＋チャット＋（重ね表示の一覧）。displayClass は 'flex' か 'hidden' */
    const renderBody = (displayClass: string) => (
        <div className={`flex-1 min-h-0 relative ${displayClass}`}>
            {showColumn && (
                <aside
                    className="flex-shrink-0 min-h-0 border-r border-slate-200"
                    style={{ width: LIST_COLUMN_W }}
                    aria-label="チャット一覧"
                >
                    {listPanel}
                </aside>
            )}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                {/* realtimeKey: 同じルームを案件詳細モーダル側でも開いたときにチャンネル名が衝突しないように */}
                <ChatRoomView roomId={dockedRoomId} myUserId={myUserId} realtimeKey="docked" isFloating />
            </div>
            {isListOpen && !showColumn && (
                <div className="absolute inset-0 z-20 flex" role="dialog" aria-label="チャット一覧">
                    <div className="w-[280px] max-w-[85%] h-full bg-white border-r border-slate-200 shadow-xl flex flex-col min-h-0">
                        <div className="flex-shrink-0 flex items-center gap-1.5 px-3 h-10 border-b border-slate-200">
                            <span className="flex-1 min-w-0 text-sm font-bold text-slate-900 truncate">チャット一覧</span>
                            <button
                                type="button"
                                onClick={() => setIsListOpen(false)}
                                className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                aria-label="一覧を閉じる"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0">{listPanel}</div>
                    </div>
                    {/* 右側の余白タップで閉じる */}
                    <button
                        type="button"
                        onClick={() => setIsListOpen(false)}
                        className="flex-1 bg-slate-900/20"
                        aria-label="一覧を閉じる"
                    />
                </div>
            )}
        </div>
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
                    className={`flex-shrink-0 flex items-center gap-1.5 px-2 h-12 border-b border-slate-200 bg-white select-none ${
                        isInteracting ? 'cursor-grabbing' : 'cursor-move'
                    }`}
                >
                    {listButton}
                    <MessageSquare className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <span className="flex-1 min-w-0 text-sm font-bold text-slate-900 truncate">{title}</span>
                    {memberBadge && (
                        <span className="text-[11px] text-slate-500 flex-shrink-0">{memberBadge}</span>
                    )}
                    {headerActions}
                </div>

                {/* 本文。ドラッグ/リサイズ中は誤操作しないように無効化 */}
                {renderBody(isInteracting ? 'flex pointer-events-none' : 'flex')}

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

    // --- ボトムシート（768px未満=スマホ） ---
    return (
        <div
            className={`
                fixed z-30 inset-x-0 bottom-0 bg-white shadow-2xl flex flex-col
                border-t border-slate-200 rounded-t-2xl
                ${isCollapsed ? 'h-12' : 'h-[min(60vh,520px)]'}
                pb-[env(safe-area-inset-bottom,0px)]
            `}
        >
            {/* ヘッダー（タップで展開/折りたたみ） */}
            <div className="flex-shrink-0 flex items-center gap-1.5 px-2 h-12 border-b border-slate-200 bg-white rounded-t-2xl">
                {listButton}
                <button
                    type="button"
                    onClick={() => setIsCollapsed((v) => !v)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                    aria-label={isCollapsed ? 'チャットを開く' : 'チャットを折りたたむ'}
                >
                    <MessageSquare className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
                    {memberBadge && (
                        <span className="text-[11px] text-slate-500 flex-shrink-0">{memberBadge}</span>
                    )}
                    <span className="flex-shrink-0 text-slate-400">
                        {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                </button>
                {headerActions}
            </div>

            {renderBody(isCollapsed ? 'hidden' : 'flex')}
        </div>
    );
}
