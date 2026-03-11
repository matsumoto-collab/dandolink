'use client';

import React from 'react';

export type ScheduleView = 'calendar' | 'assignment';

interface ScheduleViewTabsProps {
    activeView: ScheduleView;
    onViewChange: (view: ScheduleView) => void;
}

export default function ScheduleViewTabs({ activeView, onViewChange }: ScheduleViewTabsProps) {
    const isAssignment = activeView === 'assignment';

    const toggle = () => {
        onViewChange(isAssignment ? 'calendar' : 'assignment');
    };

    return (
        <div className="flex justify-center items-center gap-2 lg:gap-3 mb-2">
            <span
                className={`text-xs lg:text-sm font-medium transition-colors duration-200 cursor-pointer ${
                    !isAssignment ? 'text-slate-700' : 'text-slate-400'
                }`}
                onClick={() => onViewChange('calendar')}
            >
                カレンダー
            </span>
            <button
                role="switch"
                aria-checked={isAssignment}
                onClick={toggle}
                className={`
                    relative inline-flex h-6 w-11 lg:h-7 lg:w-12 shrink-0 cursor-pointer
                    rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2
                    ${isAssignment ? 'bg-slate-700' : 'bg-slate-300'}
                `}
            >
                <span
                    className={`
                        pointer-events-none inline-block h-5 w-5 lg:h-6 lg:w-6
                        rounded-full bg-white shadow-md ring-0
                        transition-transform duration-200 ease-in-out
                        ${isAssignment ? 'translate-x-5 lg:translate-x-5' : 'translate-x-0'}
                    `}
                />
            </button>
            <span
                className={`text-xs lg:text-sm font-medium transition-colors duration-200 cursor-pointer ${
                    isAssignment ? 'text-slate-700' : 'text-slate-400'
                }`}
                onClick={() => onViewChange('assignment')}
            >
                手配表
            </span>
        </div>
    );
}
