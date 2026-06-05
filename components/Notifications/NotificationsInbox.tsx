'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, ChevronDown, MessageSquare, Settings, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import NotificationSettings from '@/components/Settings/NotificationSettings';
import CustomerNotifyDialog from '@/components/Notifications/CustomerNotifyDialog';
import { usePageVisible } from '@/hooks/useRealtimeSubscription';
import { setAppBadge } from '@/lib/appBadge';
import { useNavigation, PageType } from '@/contexts/NavigationContext';

const INITIAL_LIMIT = 5;
const LOAD_MORE_STEP = 20;

// サイドバーとヘッダーに同居する2つの NotificationsInbox インスタンス間で
// 既読状態を同期するためのウィンドウイベント。発火元は自身のIDを source に入れ、
// 受信側は source が一致する場合は無視（重複適用を防ぐ）。
const NOTIFICATION_SYNC_EVENT = 'dandolink:notification-sync';
type NotificationSyncDetail =
    | { kind: 'read'; id: string; source: string }
    | { kind: 'read-all'; source: string };

function dispatchNotificationSync(detail: NotificationSyncDetail) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<NotificationSyncDetail>(NOTIFICATION_SYNC_EVENT, { detail }));
}

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

// 通知URLで使われる page 値の許可リスト（ホワイトリスト）。
// MainContent の VALID_PAGES と一致させる。
const VALID_PAGES: ReadonlyArray<PageType> = [
    'schedule', 'my-schedule', 'project-masters', 'reports', 'attendance',
    'profit-dashboard', 'estimates', 'site-surveys', 'invoices',
    'partners', 'customers', 'company',
    'materials', 'inventory', 'loading-list', 'settings', 'chat',
    'payment-schedules', 'payees', 'partner-work-volume', 'company-calendar',
];

export default function NotificationsInbox({ variant = 'icon' }: Props) {
    const { data: session } = useSession();
    const userId = session?.user?.id;
    const role = session?.user?.role;
    const router = useRouter();
    const { setActivePage } = useNavigation();

    const [open, setOpen] = useState(false);
    const [notifyTarget, setNotifyTarget] = useState<string | null>(null);
    const [view, setView] = useState<'list' | 'settings'>('list');
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [limit, setLimit] = useState(INITIAL_LIMIT);
    const [hasMore, setHasMore] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const instanceIdRef = useRef<string>('');
    if (!instanceIdRef.current) {
        instanceIdRef.current =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `inbox-${Math.random().toString(36).slice(2)}`;
    }

    useEffect(() => {
        setMounted(true);
    }, []);

    // 別インスタンス（サイドバー/ヘッダーのもう片方）で既読化された時にローカルステートを追従させる
    useEffect(() => {
        const handler = (e: Event) => {
            const ce = e as CustomEvent<NotificationSyncDetail>;
            const detail = ce.detail;
            if (!detail || detail.source === instanceIdRef.current) return;
            if (detail.kind === 'read') {
                const targetId = detail.id;
                setItems((prev) =>
                    prev.map((x) =>
                        x.id === targetId && !x.readAt
                            ? { ...x, readAt: new Date().toISOString() }
                            : x
                    )
                );
                // 未読カウントはグローバル値なので、items に未ロードのIDでも 1 減らす
                setUnreadCount((c) => Math.max(0, c - 1));
            } else if (detail.kind === 'read-all') {
                setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
                setUnreadCount(0);
            }
        };
        window.addEventListener(NOTIFICATION_SYNC_EVENT, handler);
        return () => window.removeEventListener(NOTIFICATION_SYNC_EVENT, handler);
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

    const fetchItems = useCallback(async (fetchLimit: number = limit) => {
        if (!userId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/notifications?limit=${fetchLimit}`, { cache: 'no-store' });
            if (!res.ok) return;
            const json = (await res.json()) as { items: NotificationItem[]; unreadCount: number; hasMore?: boolean };
            setItems(json.items);
            setUnreadCount(json.unreadCount);
            setHasMore(Boolean(json.hasMore));
        } finally {
            setLoading(false);
        }
    }, [userId, limit]);

    const handleLoadMore = () => {
        const next = limit + LOAD_MORE_STEP;
        setLimit(next);
        fetchItems(next);
    };

    // 未読数の変更をPWAアプリアイコンのバッジに反映
    useEffect(() => {
        setAppBadge(unreadCount);
    }, [unreadCount]);

    // 初回 + 30秒ごとのフォールバックポーリング（Realtime不達時の即応性確保）
    // + ブラウザタブにフォーカスが戻ったとき即時再取得
    useEffect(() => {
        if (!userId) return;
        fetchUnreadCount();
        const iv = setInterval(() => {
            if (document.visibilityState === 'visible') fetchUnreadCount();
        }, 30_000);
        const onVisible = () => {
            if (document.visibilityState === 'visible') fetchUnreadCount();
        };
        const onFocus = () => fetchUnreadCount();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(iv);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onFocus);
        };
    }, [userId, fetchUnreadCount]);

    // Supabase Realtime: 自分宛ての新規通知を即時反映
    // タブ非表示時は接続を閉じる（復帰時にポーリング/focusでキャッチアップ）
    const isVisible = usePageVisible();
    useEffect(() => {
        if (!userId || !isVisible) return;

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
                        if (open && view === 'list') fetchItems(limit);
                    }
                )
                .subscribe();
        } catch {
            // realtime未設定でも polling があるので無視
        }

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [userId, isVisible, open, view, limit, fetchItems]);

    // パネルを開いたときに一覧取得（常に初期limitで再取得）
    useEffect(() => {
        if (open && view === 'list') {
            setLimit(INITIAL_LIMIT);
            fetchItems(INITIAL_LIMIT);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, view]);

    // パネルを閉じたらビューをlistに戻す
    useEffect(() => {
        if (!open) setView('list');
    }, [open]);

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
            dispatchNotificationSync({ kind: 'read', id: n.id, source: instanceIdRef.current });
            fetch(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
        }
        setOpen(false);
        if (n.url) {
            // 「現在のページから他ページへの遷移」が router.push 単独だと一部画面で
            // useSearchParams の更新が遅れて MainContent の useEffect が発火せず
            // ページが切り替わらないケース（特にスケジュール画面）の対策として、
            // URL から page パラメータを抽出して NavigationContext を直接更新する。
            // pmId / scrollTo / view 等は router.push 後の URL から
            // 各ページの useSearchParams が読み取る。
            try {
                const parsed = new URL(n.url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
                const pageParam = parsed.searchParams.get('page');
                if (pageParam && (VALID_PAGES as ReadonlyArray<string>).includes(pageParam)) {
                    setActivePage(pageParam as PageType);
                }
            } catch {
                // URL パース失敗時は router.push のみに任せる
            }
            router.push(n.url);
        }
    };

    const handleMarkAllRead = async () => {
        setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
        setUnreadCount(0);
        dispatchNotificationSync({ kind: 'read-all', source: instanceIdRef.current });
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
                    <div className="flex items-center gap-2">
                        {view === 'settings' && (
                            <button
                                onClick={() => setView('list')}
                                className="p-1 text-slate-500 hover:bg-slate-100 rounded-lg"
                                aria-label="戻る"
                            >
                                <ChevronDown className="w-4 h-4 rotate-90" />
                            </button>
                        )}
                        <h3 className="font-semibold text-slate-800">{view === 'settings' ? '通知設定' : '通知'}</h3>
                    </div>
                    <div className="flex items-center gap-1">
                        {view === 'list' && unreadCount > 0 && (
                            <button
                                onClick={handleMarkAllRead}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                <Check className="w-3.5 h-3.5" /> すべて既読
                            </button>
                        )}
                        {view === 'list' && (
                            <button
                                onClick={() => setView('settings')}
                                className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
                                aria-label="通知設定"
                                title="通知設定"
                            >
                                <Settings className="w-4 h-4" />
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
                    {view === 'settings' ? (
                        <div className="p-4">
                            <NotificationSettings />
                        </div>
                    ) : loading && items.length === 0 ? (
                        <div className="py-10 text-center text-sm text-slate-500">読み込み中...</div>
                    ) : items.length === 0 ? (
                        <div className="py-10 text-center text-sm text-slate-500">通知はありません</div>
                    ) : (
                        <>
                            <ul className="divide-y divide-slate-100">
                                {items.map((n) => {
                                    const unread = !n.readAt;
                                    const d = (n.data ?? {}) as { milestone?: string; assigneeIds?: string[]; assignmentId?: string };
                                    const isAdminOrManager = role === 'admin' || role === 'manager';
                                    // 「顧客へ完了連絡」ボタンは 組立/解体の完了通知 かつ admin/manager または案件担当者 のみ表示
                                    const canNotifyCustomer =
                                        n.type === 'work-ended' &&
                                        !!d.milestone &&
                                        !!d.assignmentId &&
                                        (isAdminOrManager || (Array.isArray(d.assigneeIds) && !!userId && d.assigneeIds.includes(userId)));
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
                                            {canNotifyCustomer && (
                                                <div className="px-4 pb-3 -mt-1">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setNotifyTarget(d.assignmentId!);
                                                        }}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                                                    >
                                                        <MessageSquare className="w-3.5 h-3.5" />
                                                        顧客へ完了連絡
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            {hasMore && (
                                <div className="p-3 border-t border-slate-100">
                                    <button
                                        onClick={handleLoadMore}
                                        disabled={loading}
                                        className="w-full py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                                    >
                                        <ChevronDown className="w-4 h-4" />
                                        {loading ? '読み込み中...' : 'もっと見る'}
                                    </button>
                                </div>
                            )}
                        </>
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
            {mounted && notifyTarget
                ? createPortal(
                    <CustomerNotifyDialog assignmentId={notifyTarget} onClose={() => setNotifyTarget(null)} />,
                    document.body
                )
                : null}
        </>
    );
}
