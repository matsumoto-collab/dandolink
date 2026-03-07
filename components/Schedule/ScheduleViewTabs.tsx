'use client';

import React from 'react';

export type ScheduleView = 'calendar' | 'assignment';

interface ScheduleViewTabsProps {
    activeView: ScheduleView;
    onViewChange: (view: ScheduleView) => void;
}

export default function ScheduleViewTabs({ activeView, onViewChange }: ScheduleViewTabsProps) {
    return (
        <div className="flex gap-2 mb-6 border-b border-slate-200">
            <button
                onClick={() => onViewChange('calendar')}
                className={`
                    px-6 py-3 font-medium text-sm transition-all duration-300
                    border-b-2 -mb-px rounded-t-lg
                    ${activeView === 'calendar'
                        ? 'border-slate-700 text-white bg-slate-700 shadow-sm'
                        : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                    }
                `}
            >
                <span className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    週間カレンダー
                </span>
            </button>

            <button
                onClick={() => onViewChange('assignment')}
                className={`
                    px-6 py-3 font-medium text-sm transition-all duration-300
                    border-b-2 -mb-px rounded-t-lg
                    ${activeView === 'assignment'
                        ? 'border-slate-700 text-white bg-slate-700 shadow-sm'
                        : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                    }
                `}
            >
                <span className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    手配表
                </span>
            </button>
        </div>
    );
}
