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
    return (
        <div className="flex justify-center mb-2">
            <div className="inline-flex bg-slate-100 rounded-xl p-0.5 sm:p-1 gap-0.5">
                {TABS.map((tab) => {
                    const isActive = activeView === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => onViewChange(tab.key)}
                            className={`
                                whitespace-nowrap
                                px-4 py-1.5 sm:px-5 sm:py-2
                                text-xs sm:text-sm font-medium rounded-lg
                                transition-all duration-300
                                ${isActive
                                    ? 'bg-gradient-to-r from-slate-700 to-slate-600 text-white shadow-md'
                                    : 'text-slate-500 hover:text-slate-700'}
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
