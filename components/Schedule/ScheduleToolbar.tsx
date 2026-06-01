'use client';

import React from 'react';
import { Search, History } from 'lucide-react';
import { ScheduleView } from './ScheduleViewTabs';

interface ScheduleToolbarProps {
    activeView: ScheduleView;
    onViewChange: (view: ScheduleView) => void;
    onPrevWeek?: () => void;
    onNextWeek?: () => void;
    onPrevDay?: () => void;
    onNextDay?: () => void;
    onToday?: () => void;
    onOpenSearch?: () => void;
    onOpenHistory?: () => void;
    weekLabel?: string;
}

const TABS: { key: ScheduleView; label: string }[] = [
    { key: 'calendar', label: 'カレンダー' },
    { key: 'overview', label: '一覧' },
    { key: 'assignment', label: '手配表' },
];

export default function ScheduleToolbar({
    activeView,
    onViewChange,
    onPrevWeek,
    onNextWeek,
    onPrevDay,
    onNextDay,
    onToday,
    onOpenSearch,
    onOpenHistory,
    weekLabel,
}: ScheduleToolbarProps) {
    // 日付ナビは calendar / overview のときだけ意味がある
    const showDateNav = activeView !== 'assignment' && !!onPrevWeek && !!onNextWeek && !!onToday;

    return (
        <div className="flex-shrink-0 mb-1 flex items-center justify-between gap-2">
            {/* 左: ビュータブ */}
            <div className="inline-flex bg-slate-100 rounded-xl p-0.5 sm:p-1 gap-0.5 flex-shrink-0">
                {TABS.map((tab) => {
                    const isActive = activeView === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => onViewChange(tab.key)}
                            className={`
                                whitespace-nowrap
                                px-3 py-1 sm:px-5 sm:py-2
                                text-xs sm:text-sm font-medium rounded-lg
                                transition-all duration-300
                                ${isActive
                                    ? 'bg-slate-700 text-white shadow-md'
                                    : 'text-slate-500 hover:text-slate-700'}
                            `}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* 中央: 日付ナビ (デスクトップのみ。モバイルは MobileCalendarView の内蔵ナビを使う) */}
            {showDateNav ? (
                <div className="hidden lg:flex items-center gap-1 bg-white border border-slate-200 rounded-xl shadow-sm px-2 py-1">
                    <button onClick={onPrevWeek} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1週間前">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                    </button>
                    {onPrevDay && (
                        <button onClick={onPrevDay} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1日前">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                    )}
                    <button onClick={onToday} className="font-bold text-sm text-slate-800 px-3 py-1 rounded-lg hover:bg-slate-100 transition-colors">
                        {weekLabel || '今週'}
                    </button>
                    {onNextDay && (
                        <button onClick={onNextDay} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1日後">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    )}
                    <button onClick={onNextWeek} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1週間後">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                    </button>
                </div>
            ) : (
                <div className="hidden lg:block" />
            )}

            {/* 右: 検索 + 変更履歴 */}
            <div className="flex items-center gap-1 flex-shrink-0">
                {onOpenSearch && (
                    <button
                        onClick={onOpenSearch}
                        className="hidden lg:flex items-center gap-1 p-2 rounded-xl bg-white border border-slate-200 shadow-sm hover:bg-slate-50 text-slate-600 transition-colors"
                        aria-label="案件を検索"
                        title="案件を検索"
                    >
                        <Search className="w-4 h-4" />
                    </button>
                )}
                {onOpenHistory && (
                    <button
                        onClick={onOpenHistory}
                        className="flex items-center gap-1 p-2 rounded-xl bg-white border border-slate-200 shadow-sm hover:bg-slate-50 text-slate-600 transition-colors"
                        aria-label="変更履歴"
                        title="スケジュール変更履歴"
                    >
                        <History className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
