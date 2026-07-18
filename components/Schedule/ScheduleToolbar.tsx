'use client';

import React from 'react';
import { Search, History, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CalendarDays, Sparkles } from 'lucide-react';
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
    /** AI照会モーダル（班別空き・仮予定・浮き）を開く。社員のみ渡す（partner系には渡さない） */
    onOpenAiAssistant?: () => void;
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
    onOpenAiAssistant,
    weekLabel,
}: ScheduleToolbarProps) {
    // 日付ナビは calendar / overview のときだけ意味がある
    const showDateNav = activeView !== 'assignment' && !!onPrevWeek && !!onNextWeek && !!onToday;

    // 週移動セグメント内の矢印ボタン共通クラス
    const navArrow = 'h-10 grid place-items-center text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors';

    return (
        <div className="flex-shrink-0 mb-1 flex items-center justify-between gap-2">
            {/* 左: ビュータブ（セグメンテッドコントロール。選択＝白カード、濃色は「今日」専用に譲る） */}
            <div className="inline-flex items-center bg-slate-100 rounded-xl p-1 gap-1 flex-shrink-0">
                {TABS.map((tab) => {
                    const isActive = activeView === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => onViewChange(tab.key)}
                            className={`
                                whitespace-nowrap
                                px-3 py-1.5 sm:px-5 sm:py-2
                                text-xs sm:text-sm rounded-lg
                                transition-all duration-200
                                ${isActive
                                    ? 'bg-white text-slate-900 font-semibold shadow-sm ring-1 ring-slate-900/5'
                                    : 'text-slate-500 font-medium hover:text-slate-900'}
                            `}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* 中央: 日付ナビ（デスクトップのみ。一体型セグメント。モバイルは MobileCalendarView の内蔵ナビを使う） */}
            {showDateNav ? (
                <div className="hidden lg:inline-flex items-center rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden divide-x divide-slate-100">
                    <button onClick={onPrevWeek} className={`${navArrow} px-3`} aria-label="1週間前" title="1週間前">
                        <ChevronsLeft className="w-4 h-4" />
                    </button>
                    {onPrevDay && (
                        <button onClick={onPrevDay} className={`${navArrow} px-2.5`} aria-label="1日前" title="1日前">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                    )}
                    <button onClick={onToday} className="h-10 px-5 inline-flex items-center gap-2 text-slate-800 hover:bg-slate-50 transition-colors">
                        <CalendarDays className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-semibold tracking-tight">{weekLabel || '今週'}</span>
                    </button>
                    {onNextDay && (
                        <button onClick={onNextDay} className={`${navArrow} px-2.5`} aria-label="1日後" title="1日後">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    )}
                    <button onClick={onNextWeek} className={`${navArrow} px-3`} aria-label="1週間後" title="1週間後">
                        <ChevronsRight className="w-4 h-4" />
                    </button>
                </div>
            ) : (
                <div className="hidden lg:block" />
            )}

            {/* 右: AI照会 + 検索 + 変更履歴（lg+ はラベル併記、モバイル/タブレットはアイコンのみ） */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
                {onOpenAiAssistant && (
                    <button
                        onClick={onOpenAiAssistant}
                        className="inline-flex items-center gap-1.5 h-10 px-2.5 lg:px-3.5 rounded-xl bg-white border border-teal-200 shadow-sm text-teal-600 hover:text-teal-800 hover:bg-teal-50 transition-colors"
                        aria-label="AI照会"
                        title="AI照会（空き・仮予定・浮き）"
                    >
                        <Sparkles className="w-4 h-4" />
                        <span className="hidden lg:inline text-sm font-medium">AI照会</span>
                    </button>
                )}
                {onOpenSearch && (
                    <button
                        onClick={onOpenSearch}
                        className="hidden lg:inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                        aria-label="案件を検索"
                        title="案件を検索"
                    >
                        <Search className="w-4 h-4" />
                        <span className="text-sm font-medium">検索</span>
                    </button>
                )}
                {onOpenHistory && (
                    <button
                        onClick={onOpenHistory}
                        className="inline-flex items-center gap-1.5 h-10 px-2.5 lg:px-3.5 rounded-xl bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                        aria-label="変更履歴"
                        title="スケジュール変更履歴"
                    >
                        <History className="w-4 h-4" />
                        <span className="hidden lg:inline text-sm font-medium">履歴</span>
                    </button>
                )}
            </div>
        </div>
    );
}
