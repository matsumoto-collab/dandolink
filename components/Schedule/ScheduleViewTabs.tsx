'use client';

import React from 'react';

export type ScheduleView = 'calendar' | 'overview' | 'assignment';

interface ScheduleViewTabsProps {
    activeView: ScheduleView;
    onViewChange: (view: ScheduleView) => void;
}

const TABS: { key: ScheduleView; label: string }[] = [
    { key: 'calendar', label: 'カレンダー' },
    { key: 'overview', label: '一覧' },
    { key: 'assignment', label: '手配表' },
];

export default function ScheduleViewTabs({ activeView, onViewChange }: ScheduleViewTabsProps) {
    const activeIndex = TABS.findIndex(t => t.key === activeView);

    return (
        <div className="flex justify-center mb-2">
            <div className="relative inline-flex bg-slate-100 rounded-xl p-0.5 sm:p-1">
                {/* Sliding highlight */}
                <div
                    className="absolute top-0.5 sm:top-1 bottom-0.5 sm:bottom-1 bg-gradient-to-r from-slate-700 to-slate-600 rounded-lg shadow-md transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
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
                                px-3.5 py-1.5 sm:px-5 sm:py-2
                                text-xs sm:text-sm font-medium rounded-lg
                                transition-colors duration-300
                                ${isActive ? 'text-white' : 'text-slate-500 hover:text-slate-700'}
                            `}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
