'use client';

import React from 'react';

export type ScheduleView = 'calendar' | 'assignment';

interface ScheduleViewTabsProps {
    activeView: ScheduleView;
    onViewChange: (view: ScheduleView) => void;
}

export default function ScheduleViewTabs({ activeView, onViewChange }: ScheduleViewTabsProps) {
    return (
        <div className="flex justify-center mb-2">
            <div className="inline-flex bg-slate-100 rounded-full p-0.5">
                <button
                    onClick={() => onViewChange('calendar')}
                    className={`
                        px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200
                        ${activeView === 'calendar'
                            ? 'bg-slate-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }
                    `}
                >
                    カレンダー
                </button>
                <button
                    onClick={() => onViewChange('assignment')}
                    className={`
                        px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200
                        ${activeView === 'assignment'
                            ? 'bg-slate-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }
                    `}
                >
                    手配表
                </button>
            </div>
        </div>
    );
}
