'use client';

import React from 'react';

export type ScheduleView = 'calendar' | 'assignment';

interface ScheduleViewTabsProps {
    activeView: ScheduleView;
    onViewChange: (view: ScheduleView) => void;
    onToday?: () => void;
    onPreviousWeek?: () => void;
    onNextWeek?: () => void;
    onPreviousDay?: () => void;
    onNextDay?: () => void;
}

// Calendar icon (mini)
function CalendarIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="1em" height="1em">
            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
    );
}

// List/clipboard icon (mini)
function ClipboardIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="1em" height="1em">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
        </svg>
    );
}

export default function ScheduleViewTabs({ activeView, onViewChange, onToday, onPreviousWeek, onNextWeek, onPreviousDay, onNextDay }: ScheduleViewTabsProps) {
    const isAssignment = activeView === 'assignment';
    const showNav = onToday && onPreviousWeek && onNextWeek && onPreviousDay && onNextDay;

    return (
        <div className="flex items-center justify-between mb-2">
            {/* Left: tabs */}
            <div className="relative inline-flex bg-slate-100 rounded-xl p-1 lg:p-1.5">
                {/* Sliding highlight */}
                <div
                    className={`
                        absolute top-1 lg:top-1.5 bottom-1 lg:bottom-1.5
                        w-[calc(50%-4px)] lg:w-[calc(50%-6px)]
                        bg-gradient-to-r from-slate-700 to-slate-600 rounded-lg shadow-md
                        transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]
                        ${isAssignment ? 'translate-x-[calc(100%+4px)] lg:translate-x-[calc(100%+6px)]' : 'translate-x-0'}
                    `}
                />
                {/* Calendar button */}
                <button
                    onClick={() => onViewChange('calendar')}
                    className={`
                        relative z-10 flex items-center gap-1.5 lg:gap-2
                        px-3.5 py-1.5 lg:px-5 lg:py-2
                        text-xs lg:text-sm font-medium rounded-lg
                        transition-colors duration-300
                        ${!isAssignment ? 'text-white' : 'text-slate-500 hover:text-slate-700'}
                    `}
                >
                    <CalendarIcon className="text-[14px] lg:text-[16px]" />
                    カレンダー
                </button>
                {/* Assignment button */}
                <button
                    onClick={() => onViewChange('assignment')}
                    className={`
                        relative z-10 flex items-center gap-1.5 lg:gap-2
                        px-3.5 py-1.5 lg:px-5 lg:py-2
                        text-xs lg:text-sm font-medium rounded-lg
                        transition-colors duration-300
                        ${isAssignment ? 'text-white' : 'text-slate-500 hover:text-slate-700'}
                    `}
                >
                    <ClipboardIcon className="text-[14px] lg:text-[16px]" />
                    手配表
                </button>
            </div>

            {/* Right: navigation buttons */}
            {showNav && (
                <div className="flex items-center gap-1 sm:gap-3">
                    <button
                        onClick={onToday}
                        className="px-2 py-1.5 text-[10px] sm:px-4 sm:py-2 sm:text-xs font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors duration-150"
                    >
                        今週
                    </button>
                    <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg overflow-hidden">
                        <button onClick={onPreviousWeek} className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600 hover:bg-slate-100 transition-colors duration-150" aria-label="1週間前" title="1週間前">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                        </button>
                        <div className="w-px h-6 bg-slate-200"></div>
                        <button onClick={onNextWeek} className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600 hover:bg-slate-100 transition-colors duration-150" aria-label="1週間後" title="1週間後">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                    <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg overflow-hidden">
                        <button onClick={onPreviousDay} className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600 hover:bg-slate-100 transition-colors duration-150" aria-label="1日前" title="1日前">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        <div className="w-px h-6 bg-slate-200"></div>
                        <button onClick={onNextDay} className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600 hover:bg-slate-100 transition-colors duration-150" aria-label="1日後" title="1日後">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
