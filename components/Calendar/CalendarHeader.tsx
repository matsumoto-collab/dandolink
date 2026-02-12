import React from 'react';
import { WeekDay } from '@/types/calendar';

interface CalendarHeaderProps {
    weekDays: WeekDay[];
    onPreviousWeek: () => void;
    onNextWeek: () => void;
    onPreviousDay: () => void;
    onNextDay: () => void;
    onToday: () => void;
}

export default function CalendarHeader({
    weekDays: _weekDays,
    onPreviousWeek,
    onNextWeek,
    onPreviousDay,
    onNextDay,
    onToday,
}: CalendarHeaderProps) {

    return (
        <div className="bg-white border-b border-slate-200 p-2">
            <div className="flex items-center justify-center gap-1 sm:gap-3">
                {/* 今週ボタン */}
                <button
                    onClick={onToday}
                    className="
              px-2 py-1.5 text-[10px] sm:px-4 sm:py-2 sm:text-xs font-medium text-white
              bg-slate-700 rounded-lg
              hover:bg-slate-600
              transition-colors duration-150
            "
                >
                    今週
                </button>

                {/* 週移動ボタン */}
                <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg overflow-hidden">
                    <button
                        onClick={onPreviousWeek}
                        className="
                px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600
                hover:bg-slate-100
                transition-colors duration-150
              "
                        aria-label="1週間前"
                        title="1週間前"
                    >
                        <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                    </button>

                    <div className="w-px h-6 bg-slate-200"></div>

                    <button
                        onClick={onNextWeek}
                        className="
                px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600
                hover:bg-slate-100
                transition-colors duration-150
              "
                        aria-label="1週間後"
                        title="1週間後"
                    >
                        <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>

                {/* 日移動ボタン */}
                <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg overflow-hidden">
                    <button
                        onClick={onPreviousDay}
                        className="
                px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600
                hover:bg-slate-100
                transition-colors duration-150
              "
                        aria-label="1日前"
                        title="1日前"
                    >
                        <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>

                    <div className="w-px h-6 bg-slate-200"></div>

                    <button
                        onClick={onNextDay}
                        className="
                px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-slate-600
                hover:bg-slate-100
                transition-colors duration-150
              "
                        aria-label="1日後"
                        title="1日後"
                    >
                        <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
