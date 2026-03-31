'use client';

import React from 'react';

export type ScheduleView = 'calendar' | 'overview' | 'assignment';

interface ScheduleViewTabsProps {
    activeView: ScheduleView;
    onViewChange: (view: ScheduleView) => void;
    onToday?: () => void;
    onPreviousWeek?: () => void;
    onNextWeek?: () => void;
    onPreviousDay?: () => void;
    onNextDay?: () => void;
}

const TABS: { key: ScheduleView; label: string }[] = [
    { key: 'calendar', label: 'カレンダー' },
    { key: 'overview', label: '一覧' },
    { key: 'assignment', label: '手配表' },
];

export default function ScheduleViewTabs({ activeView, onViewChange, onToday, onPreviousWeek, onNextWeek, onPreviousDay, onNextDay }: ScheduleViewTabsProps) {
    const showNav = onToday && onPreviousWeek && onNextWeek && onPreviousDay && onNextDay;
    const activeIndex = TABS.findIndex(t => t.key === activeView);

    return (
        <div className="flex items-center gap-1.5 sm:gap-2 mb-2 flex-nowrap overflow-x-auto">
            {/* Tabs */}
            <div className="relative inline-flex bg-slate-100 rounded-lg p-0.5 flex-shrink-0">
                {/* Sliding highlight */}
                <div
                    className="absolute top-0.5 bottom-0.5 bg-gradient-to-r from-slate-700 to-slate-600 rounded-md shadow-md transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                    style={{
                        width: `calc(${100 / TABS.length}% - 3px)`,
                        transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 3}px))`,
                    }}
                />
                {TABS.map((tab) => {
                    const isActive = activeView === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => onViewChange(tab.key)}
                            className={`
                                relative z-10 whitespace-nowrap
                                px-2.5 py-1 sm:px-4 sm:py-1.5
                                text-[11px] sm:text-sm font-medium rounded-md
                                transition-colors duration-300
                                ${isActive ? 'text-white' : 'text-slate-500 hover:text-slate-700'}
                            `}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Navigation */}
            {showNav && (
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        onClick={onToday}
                        className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white bg-slate-700 rounded-md hover:bg-slate-600 transition-colors whitespace-nowrap"
                    >
                        今週
                    </button>
                    <div className="flex items-center bg-white border border-slate-300 rounded-md overflow-hidden">
                        <button onClick={onPreviousWeek} className="px-1 py-1 sm:px-2 sm:py-1.5 text-slate-600 hover:bg-slate-100 transition-colors" aria-label="1週間前">
                            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                        </button>
                        <div className="w-px h-4 bg-slate-200"></div>
                        <button onClick={onNextWeek} className="px-1 py-1 sm:px-2 sm:py-1.5 text-slate-600 hover:bg-slate-100 transition-colors" aria-label="1週間後">
                            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                    <div className="flex items-center bg-white border border-slate-300 rounded-md overflow-hidden">
                        <button onClick={onPreviousDay} className="px-1 py-1 sm:px-2 sm:py-1.5 text-slate-600 hover:bg-slate-100 transition-colors" aria-label="1日前">
                            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        <div className="w-px h-4 bg-slate-200"></div>
                        <button onClick={onNextDay} className="px-1 py-1 sm:px-2 sm:py-1.5 text-slate-600 hover:bg-slate-100 transition-colors" aria-label="1日後">
                            <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
