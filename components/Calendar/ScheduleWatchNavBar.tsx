'use client';

import React, { useMemo } from 'react';
import { Sunrise, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { CalendarEvent } from '@/types/calendar';
import type { ScheduleWatchNavItem } from '@/lib/scheduleWatchNav';

/**
 * 「朝の見張りまとめ」通知から来たときの帯（見張りナビ）。
 * 一覧の配置は全部光らせたまま、◀ ▶ で1件ずつ該当の週へ移ってスクロールする。
 * 検索ジャンプの4秒消灯と違い、×で閉じるまで出し続ける（kei 決定）。
 *
 * 位置は DesktopCalendarView の確認トーストと同じ画面下中央。z-40 なのは
 * モバイルのアクションシート（fixed bottom-0 z-50）より下に置くため。カレンダーのレイアウトは変えない。
 */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → 'M/D(曜)'（日付だけを扱うのでタイムゾーンの影響を受けない） */
function formatShortDate(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return date;
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return `${m}/${d}(${WEEKDAYS[wd]})`;
}

interface ScheduleWatchNavBarProps {
    items: ScheduleWatchNavItem[];
    index: number;
    events: CalendarEvent[];
    /** 今の項目がカレンダーに見つからなかった */
    notFound: boolean;
    onGoTo: (index: number) => void;
    onClose: () => void;
}

export default function ScheduleWatchNavBar({ items, index, events, notFound, onGoTo, onClose }: ScheduleWatchNavBarProps) {
    const item = items[index];
    const siteName = useMemo(() => {
        if (!item) return '';
        const ev = events.find(
            (e) => e.id === item.assignmentId || e.id.replace(/-assembly$|-demolition$/, '') === item.assignmentId
        );
        return ev?.title || item.label || '';
    }, [events, item]);

    if (!item) return null;
    const canPrev = index > 0;
    const canNext = index < items.length - 1;

    return (
        <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-amber-50 border border-amber-300 text-amber-900 shadow-lg rounded-xl px-3 py-2 max-w-[min(92vw,640px)] w-[max-content]"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-center gap-2 min-w-0">
                <Sunrise className="w-4 h-4 flex-shrink-0 text-amber-600" />
                <span className="text-xs font-bold whitespace-nowrap">朝の見張り</span>
                <span className="text-xs whitespace-nowrap tabular-nums">
                    {index + 1}/{items.length}件
                </span>
                <span className="text-xs font-medium whitespace-nowrap">{formatShortDate(item.date)}</span>
                <span className="text-xs truncate min-w-0 flex-1">{siteName}</span>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => canPrev && onGoTo(index - 1)}
                        disabled={!canPrev}
                        className="p-1 rounded hover:bg-amber-100 disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="前の項目"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => canNext && onGoTo(index + 1)}
                        disabled={!canNext}
                        className="p-1 rounded hover:bg-amber-100 disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="次の項目"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded hover:bg-amber-100 ml-0.5"
                        aria-label="見張りナビを閉じる"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
            {notFound && (
                <div className="mt-0.5 pl-6 text-[11px] text-amber-700 truncate">
                    カレンダーに見つかりません（解消済み・削除済み、または浮きの表示権限なし）
                </div>
            )}
        </div>
    );
}
