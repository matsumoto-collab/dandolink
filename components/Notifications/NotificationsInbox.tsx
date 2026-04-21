'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface NotificationItem {
    id: string;
    type: string;
    title: string;
    body: string;
    url: string | null;
    data: unknown;
    readAt: string | null;
    createdAt: string;
}

interface Props {
    /** 表示サイズ: compact=モバイルヘッダー用、full=サイドバー用 */
    variant?: 'icon' | 'row';
}

function formatRelative(iso: string): string {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'たった今';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}分前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}時間前`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}日前`;
    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

export default function NotificationsInbox({ variant = 'icon' }: Props) {
    const { data: session } = useSession();
    const userId = session?.user?.id;
    const router = useRouter();

    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const fetchUnreadCount = useCallback(async () => {
        if (!userId) return;
        try {
            const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
            if (!res.ok) return;
            const { count } = (await res.json()) as { count: number };
            setUnreadCount(count);
        } catch {
            // ignore
        }
    }, [userId]);

    const fetchItems = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const res = await fetch('/api/notifications?limit=30', { cache: 'no-store' });
            if (!res.ok) return;
            const json = (await res.json()) as { items: NotificationItem[]; unreadCount: number };
            setItems(json.items);
            setUnreadCount(json.unreadCount);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    // 初回 + 60秒ごとのフォールバック（Realtimeが切れていたとき用）
    useEffect(() => {
        if (!userId) return;
        fetchUnreadCount();
        const iv = setInterval(fetchUnreadCount, 60_000);
        return () => clearInterval(iv);
    }, [userId, fetchUnreadCount]);

    // Supabase Realtime: 自分宛ての新規通知を即時反映
    useEffect(() => {
        if (!userId) return;

        let channel: RealtimeChannel | null = null;
        try {
            channel = supabase
                .channel(`notification-${userId}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'Notification',
                        filter: `userId=eq.${userId}`,
                    },
                    () => {
                        setUnreadCount((c) => c + 1);
                        if (open) fetchItems();
                    }
                )
                .subscribe();
        } catch {
            // realtime未設定でも polling があるので無視
        }

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [userId, open, fetchItems]);

    // パネルを開いたときに一覧取得
    useEffect(() => {
        if (open) fetchItems();
    }, [open, fetchItems]);

    // 外側クリックで閉じる（デスクトップ用ドロップダウン）
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent | TouchEvent) => {
            if (!panelRef.current) return;
            if (!panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
        };
    }, [open]);

    const handleClickItem = async (n: NotificationItem) => {
        // optimistic 既読化
        if (!n.readAt) {
            setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
            setUnreadCount((c) => Math.max(0, c - 1));
            fetch(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
        }
        setOpen(false);
        if (n.url) router.push(n.url);
    };

    const handleMarkAllRead = async () => {
        setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
        setUnreadCount(0);
        try {
            await fetch('/api/notifications/mark-all-read', { method: 'POST' });
        } catch {
            // ignore
        }
    };

    if (!userId) return null;

    const trigger = variant === 'icon' ? (
        <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="relative p-2 hover:bg-slate-800/60 rounded-lg transition-colors"
            aria-label="通知"
        >
            <Bell className="w-6 h-6 text-slate-300" />
            {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                </span>
            )}
        </button>
    ) : (
        <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="nav-item-animate w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 relative"
        >
            <Bell className="w-4 h-4" />
            <span className="flex-1 text-left">通知</span>
            {unreadCount > 0 && (
                <span className="min-w-[18px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                </span>
            )}
        </button>
    );

    const panel = open ? (
        <>
            {/* モバイル: 全画面オーバーレイ、デスクトップ: 軽いbackdrop */}
            <div
                className="fixed inset-0 z-[60] bg-black/30 lg:bg-transparent"
                onClick={() => setOpen(false)}
                aria-hidden
            />
            <div
                ref={panelRef}
                className="fixed z-[70] bg-white rounded-t-2xl lg:rounded-xl shadow-2xl border border-slate-200 flex flex-col
                           left-0 right-0 bottom-0 max-h-[80vh]
                           lg:left-auto lg:right-4 lg:top-16 lg:bottom-auto lg:w-96 lg:max-h-[70vh]"
                role="dialog"
                aria-label="通知一覧"
            >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                            <h3 className="font-semibold text-slate-800">通知</h3>
                            <div className="flex items-center gap-1">
                                {unreadCount > 0 && (
                                    <button
                                        onClick={handleMarkAllRead}
                                        className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                                    >
                                        <Check className="w-3.5 h-3.5" /> すべて既読
                                    </button>
                                )}
                                <button
                                    onClick={() => setOpen(false)}
                                    className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
                                    aria-label="閉じる"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto overscroll-contain">
                            {loading && items.length === 0 ? (
                                <div className="py-10 text-center text-sm text-slate-500">読み込み中...</div>
                            ) : items.length === 0 ? (
                                <div className="py-10 text-center text-sm text-slate-500">通知はありません</div>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {items.map((n) => {
                                        const unread = !n.readAt;
                                        return (
                                            <li key={n.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleClickItem(n)}
                                                    className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 transition-colors ${unread ? 'bg-sky-50/60' : ''}`}
                                                >
                                                    <span className={`flex-shrink-0 mt-1.5 w-2 h-2 rounded-full ${unread ? 'bg-sky-500' : 'bg-transparent'}`} aria-hidden />
                                                    <span className="flex-1 min-w-0">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="font-medium text-sm text-slate-800 line-clamp-2">{n.title}</div>
                                                            <div className="flex-shrink-0 text-[11px] text-slate-400">{formatRelative(n.createdAt)}</div>
                                                        </div>
                                                        <div className="mt-0.5 text-xs text-slate-600 line-clamp-2">{n.body}</div>
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                <div className="safe-area-bottom" />
            </div>
        </>
    ) : null;

    return (
        <>
            {trigger}
            {mounted && panel ? createPortal(panel, document.body) : null}
        </>
    );
}
