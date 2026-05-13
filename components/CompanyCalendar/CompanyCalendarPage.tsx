'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import {
    CALENDAR_CATEGORY_COLORS,
    CALENDAR_CATEGORY_LABELS,
    type CalendarEventDTO,
} from '@/types/companyCalendar';
import CalendarEventModal from './CalendarEventModal';
import { initBroadcastChannel, onBroadcast } from '@/lib/broadcastChannel';
import { usePageVisible } from '@/hooks/useRealtimeSubscription';

/**
 * 社内カレンダー（admin / manager 専用）
 * 月表示のシンプルなカレンダー。日付セルをクリックして新規予定作成、
 * 既存イベントをクリックで編集/削除。
 */
export default function CompanyCalendarPage() {
    const { data: session } = useSession();
    const userId = session?.user?.id;
    const userRole = session?.user?.role;

    // 表示中の月（その月の1日を基準）
    const [cursor, setCursor] = useState<Date>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const [events, setEvents] = useState<CalendarEventDTO[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState<CalendarEventDTO | null>(null);
    const [defaultDate, setDefaultDate] = useState<Date | null>(null);

    // 月の表示範囲（月初の日曜〜月末の土曜まで）
    const { gridStart, gridEnd } = useMemo(() => {
        const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const start = new Date(firstOfMonth);
        start.setDate(start.getDate() - start.getDay()); // 直前の日曜
        const end = new Date(lastOfMonth);
        end.setDate(end.getDate() + (6 - end.getDay())); // 直後の土曜
        end.setHours(23, 59, 59, 999);
        return { gridStart: start, gridEnd: end };
    }, [cursor]);

    const fetchEvents = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                from: gridStart.toISOString(),
                to: gridEnd.toISOString(),
            });
            const res = await fetch(`/api/company-calendar?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                const msg = await res.json().catch(() => ({ error: '取得に失敗しました' }));
                throw new Error(msg.error || '取得に失敗しました');
            }
            const json = (await res.json()) as { events: CalendarEventDTO[] };
            setEvents(json.events);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, [gridStart, gridEnd]);

    useEffect(() => {
        fetchEvents();
    }, [fetchEvents]);

    // Broadcast 受信: 別デバイス/別タブで予定が更新されたら 500ms デバウンスで再フェッチ
    // タブが hidden の間は購読を張らない（visibility-gated）
    const isVisible = usePageVisible();
    useEffect(() => {
        if (!isVisible) return;
        initBroadcastChannel();
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = onBroadcast('company_calendar_updated', () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                fetchEvents();
            }, 500);
        });
        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            cleanup();
        };
    }, [isVisible, fetchEvents]);

    // 通知ディープリンク: ?pmId=<id> で該当案件の予定をモーダルで自動オープン
    // pmId は MainContent では消費されず、ここで読み取って URL から除去する
    const pmIdConsumedRef = useRef(false);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (pmIdConsumedRef.current) return;
        if (loading) return; // 初回 fetch 完了まで待つ
        const params = new URLSearchParams(window.location.search);
        const pmId = params.get('pmId');
        if (!pmId) return;

        const target = events.find((e) => e.projectMasterId === pmId);
        if (target) {
            if (target.isAuto) {
                // 自動生成イベントは編集モーダルを開かず、案件マスター側へ誘導
                toast(
                    '自動生成された予定は案件マスターの編集画面から変更してください',
                    { icon: 'ℹ️', position: 'bottom-center' },
                );
            } else {
                setEditingEvent(target);
                setDefaultDate(null);
                setModalOpen(true);
            }
        } else if (events.length > 0 || !loading) {
            // events ロード済みで該当が無ければ通知
            toast('該当案件の予定はこの月にありません', { position: 'bottom-center' });
        }

        pmIdConsumedRef.current = true;
        params.delete('pmId');
        const qs = params.toString();
        const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
    }, [events, loading]);

    // 日付配列（7列 × 6行 = 42日が基本）
    const days = useMemo(() => {
        const out: Date[] = [];
        const d = new Date(gridStart);
        while (d <= gridEnd) {
            out.push(new Date(d));
            d.setDate(d.getDate() + 1);
        }
        return out;
    }, [gridStart, gridEnd]);

    // 日付ごとのイベント分配（YYYY-MM-DD キー）
    const eventsByDate = useMemo(() => {
        const map = new Map<string, CalendarEventDTO[]>();
        for (const e of events) {
            const start = new Date(e.startAt);
            const end = new Date(e.endAt);
            // 開始日〜終了日まで全ての日付に紐付ける
            const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            while (cur <= last) {
                const key = formatDateKey(cur);
                const arr = map.get(key) ?? [];
                arr.push(e);
                map.set(key, arr);
                cur.setDate(cur.getDate() + 1);
            }
        }
        return map;
    }, [events]);

    const monthLabel = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;

    const handlePrevMonth = () =>
        setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
    const handleNextMonth = () =>
        setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    const handleToday = () => {
        const now = new Date();
        setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    };

    const handleCellClick = (date: Date) => {
        setEditingEvent(null);
        setDefaultDate(date);
        setModalOpen(true);
    };

    const handleEventClick = (e: CalendarEventDTO, mouseEvent: React.MouseEvent) => {
        mouseEvent.stopPropagation();
        if (e.isAuto) {
            toast(
                '自動生成された予定は案件マスターの編集画面から変更してください',
                { icon: 'ℹ️' },
            );
            return;
        }
        setEditingEvent(e);
        setDefaultDate(null);
        setModalOpen(true);
    };

    const handleSaved = () => {
        setModalOpen(false);
        setEditingEvent(null);
        setDefaultDate(null);
        fetchEvents();
    };

    const today = new Date();
    const todayKey = formatDateKey(today);

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* ヘッダー */}
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handlePrevMonth}
                        className="p-2 rounded-lg hover:bg-slate-100"
                        aria-label="前月"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <h2 className="text-xl font-bold text-slate-900 min-w-[7em] text-center">
                        {monthLabel}
                    </h2>
                    <button
                        type="button"
                        onClick={handleNextMonth}
                        className="p-2 rounded-lg hover:bg-slate-100"
                        aria-label="次月"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={handleToday}
                        className="ml-2 px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-slate-50"
                    >
                        今日
                    </button>
                    <button
                        type="button"
                        onClick={fetchEvents}
                        className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                        disabled={loading}
                        aria-label="再読込"
                        title="再読込"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setEditingEvent(null);
                        setDefaultDate(new Date());
                        setModalOpen(true);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700"
                >
                    <Plus className="w-4 h-4" /> 予定を追加
                </button>
            </div>

            {/* カテゴリ凡例 */}
            <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-600">
                {(Object.keys(CALENDAR_CATEGORY_LABELS) as Array<keyof typeof CALENDAR_CATEGORY_LABELS>).map(
                    (k) => (
                        <span key={k} className="flex items-center gap-1">
                            <span
                                className="inline-block w-3 h-3 rounded-sm"
                                style={{ backgroundColor: CALENDAR_CATEGORY_COLORS[k] }}
                            />
                            {CALENDAR_CATEGORY_LABELS[k]}
                        </span>
                    ),
                )}
            </div>

            {/* 曜日ヘッダー */}
            <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-t-lg overflow-hidden">
                {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (
                    <div
                        key={w}
                        className={`bg-slate-50 py-1.5 text-center text-xs font-semibold ${
                            i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : 'text-slate-700'
                        }`}
                    >
                        {w}
                    </div>
                ))}
            </div>

            {/* 日付グリッド */}
            <div className="grid grid-cols-7 gap-px bg-slate-200 border-x border-b border-slate-200 rounded-b-lg overflow-hidden flex-1 min-h-0">
                {days.map((d) => {
                    const key = formatDateKey(d);
                    const isCurrentMonth = d.getMonth() === cursor.getMonth();
                    const isToday = key === todayKey;
                    const dayEvents = eventsByDate.get(key) ?? [];
                    const dow = d.getDay();
                    return (
                        <button
                            type="button"
                            key={key}
                            onClick={() => handleCellClick(d)}
                            className={`relative bg-white min-h-[6rem] p-1.5 text-left hover:bg-sky-50/60 transition-colors flex flex-col gap-1 ${
                                !isCurrentMonth ? 'opacity-40' : ''
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span
                                    className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                        isToday
                                            ? 'bg-teal-600 text-white'
                                            : dow === 0
                                              ? 'text-red-600'
                                              : dow === 6
                                                ? 'text-blue-600'
                                                : 'text-slate-700'
                                    }`}
                                >
                                    {d.getDate()}
                                </span>
                            </div>
                            <ul className="flex flex-col gap-0.5 overflow-hidden">
                                {dayEvents.slice(0, 3).map((e) => (
                                    <li key={e.id}>
                                        <span
                                            onClick={(me) => handleEventClick(e, me)}
                                            className="block w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate cursor-pointer"
                                            style={{
                                                backgroundColor:
                                                    (e.color || CALENDAR_CATEGORY_COLORS[e.category]) +
                                                    '22',
                                                color:
                                                    e.color || CALENDAR_CATEGORY_COLORS[e.category],
                                                borderLeft: `3px solid ${
                                                    e.color || CALENDAR_CATEGORY_COLORS[e.category]
                                                }`,
                                            }}
                                            title={`${CALENDAR_CATEGORY_LABELS[e.category]}: ${e.title}`}
                                        >
                                            {e.visibility === 'private' && '🔒 '}
                                            {e.title}
                                        </span>
                                    </li>
                                ))}
                                {dayEvents.length > 3 && (
                                    <li className="text-[10px] text-slate-500">
                                        他 {dayEvents.length - 3} 件
                                    </li>
                                )}
                            </ul>
                        </button>
                    );
                })}
            </div>

            {modalOpen && (
                <CalendarEventModal
                    event={editingEvent}
                    defaultDate={defaultDate}
                    currentUserId={userId ?? null}
                    currentUserRole={userRole ?? null}
                    onClose={() => {
                        setModalOpen(false);
                        setEditingEvent(null);
                        setDefaultDate(null);
                    }}
                    onSaved={handleSaved}
                />
            )}
        </div>
    );
}

function formatDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
