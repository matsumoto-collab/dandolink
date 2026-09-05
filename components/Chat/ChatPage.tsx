'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Search, Plus } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import ChatRoomView from './ChatRoomView';
import ChatRoomList, { filterRooms } from './ChatRoomList';
import NewRoomModal from './NewRoomModal';

/**
 * チャット画面（スマホ用）。PC・iPad(768px以上)ではサイドバーの「チャット」は
 * チャットウインドウ(FloatingChatPanel)で開くので、この画面には来ない
 * （来た場合は MainContent がウインドウへ振り替える）。
 */
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
    // 職方・協力業者・応援はチャット新規作成不可
    const myRole = session?.user?.role;
    const canCreateRoom = myRole !== 'worker' && myRole !== 'partner' && myRole !== 'support';

    useEffect(() => {
        fetchRooms();
        fetchUnreadCount();
    }, [fetchRooms, fetchUnreadCount]);

    // スケジュール画面にドッキングしていたルームがあれば、チャット画面に来たときはそれを開く
    // （ドッキングパネルはチャット画面では出ないので、続きがすぐ見えるように）。
    // 初回マウント時のみ。URL の roomId 指定がある場合は下の効果が上書きする。
    useEffect(() => {
        const { activeRoomId: current, dockedRoomId: docked, setActiveRoom: activate } = useChatStore.getState();
        if (!current && docked) activate(docked);
    }, []);

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

    const filteredRooms = useMemo(() => filterRooms(rooms, search, myUserId), [rooms, search, myUserId]);

    return (
        <div className="flex h-full min-h-0 -m-4 sm:-m-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <aside
                className={`${activeRoomId ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 border-r border-slate-200 bg-slate-50 min-h-0`}
            >
                <div className="p-3 border-b border-slate-200 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                        <h2 className="text-base font-bold text-slate-900 flex-1">チャット</h2>
                        {canCreateRoom && (
                            <button
                                onClick={() => setShowNewRoomModal(true)}
                                className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-sm"
                                aria-label="新規チャット"
                            >
                                <Plus className="w-5 h-5" />
                            </button>
                        )}
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
                    <ChatRoomList
                        rooms={filteredRooms}
                        activeRoomId={activeRoomId}
                        onSelect={setActiveRoom}
                        myUserId={myUserId}
                        isLoading={isLoadingRooms && rooms.length === 0}
                        emptyMessage={<>チャットがありません<br />「+」から新規作成</>}
                    />
                </div>
            </aside>

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
