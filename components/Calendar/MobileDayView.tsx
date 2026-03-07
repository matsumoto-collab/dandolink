'use client';

import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Plus } from 'lucide-react';
import { CalendarEvent, Employee } from '@/types/calendar';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import { formatDateKey } from '@/utils/employeeUtils';

interface MobileDayViewProps {
    currentDate: Date;
    events: CalendarEvent[];
    employees: Employee[];
    onPreviousDay: () => void;
    onNextDay: () => void;
    onToday: () => void;
    onEventClick: (eventId: string) => void;
    onAddEvent?: () => void;
    isReadOnly?: boolean;
}

export default function MobileDayView({
    currentDate,
    events,
    employees,
    onPreviousDay,
    onNextDay,
    onToday,
    onEventClick,
    onAddEvent,
    isReadOnly = false,
}: MobileDayViewProps) {
    const dateKey = formatDateKey(currentDate);
    const dayOfWeek = getDayOfWeekString(currentDate, 'short');
    const dateString = formatDate(currentDate, 'full');
    const isToday = formatDateKey(new Date()) === dateKey;
    const isSaturday = currentDate.getDay() === 6;
    const isSunday = currentDate.getDay() === 0;

    // この日のイベントを職長ごとにグループ化
    const eventsByEmployee = useMemo(() => {
        const dayEvents = events.filter(e => formatDateKey(e.startDate) === dateKey);
        const grouped: Record<string, CalendarEvent[]> = {};

        employees.forEach(emp => {
            grouped[emp.id] = dayEvents
                .filter(e => e.assignedEmployeeId === emp.id)
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        });

        return grouped;
    }, [events, employees, dateKey]);

    // 工事種別ごとの色
    const getConstructionTypeLabel = (type?: string) => {
        switch (type) {
            case 'assembly': return '組立';
            case 'demolition': return '解体';
            default: return 'その他';
        }
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* ヘッダー: 日付ナビゲーション */}
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between">
                    <button
                        onClick={onPreviousDay}
                        className="p-2 rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        <ChevronLeft className="w-6 h-6 text-slate-700" />
                    </button>

                    <div className="flex flex-col items-center">
                        <span className={`text-lg font-bold ${isSaturday ? 'text-slate-600' :
                            isSunday ? 'text-slate-600' :
                                'text-slate-800'
                            }`}>
                            {dateString}（{dayOfWeek}）
                        </span>
                        {isToday && (
                            <span className="text-xs text-white bg-slate-700 px-2 py-0.5 rounded-full mt-1">
                                今日
                            </span>
                        )}
                    </div>

                    <button
                        onClick={onNextDay}
                        className="p-2 rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        <ChevronRight className="w-6 h-6 text-slate-700" />
                    </button>
                </div>

                {/* 今日ボタン */}
                {!isToday && (
                    <button
                        onClick={onToday}
                        className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                        <Calendar className="w-4 h-4" />
                        今日に戻る
                    </button>
                )}
            </div>

            {/* 職長ごとのイベント一覧 */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {employees.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                        表示する職長がいません
                    </div>
                ) : (
                    employees.map(employee => {
                        const employeeEvents = eventsByEmployee[employee.id] || [];

                        return (
                            <div
                                key={employee.id}
                                className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
                            >
                                {/* 職長名ヘッダー */}
                                <div className="bg-slate-700 px-4 py-2">
                                    <h3 className="text-white font-medium text-sm">
                                        {employee.name}
                                    </h3>
                                </div>

                                {/* イベントリスト */}
                                <div className="p-3">
                                    {employeeEvents.length === 0 ? (
                                        <div className="text-sm text-slate-400 text-center py-4">
                                            予定なし
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {employeeEvents.map(event => (
                                                <button
                                                    key={event.id}
                                                    onClick={() => onEventClick(event.id)}
                                                    className="w-full text-left p-3 rounded-lg transition-all active:scale-[0.98]"
                                                    style={{ backgroundColor: event.color }}
                                                >
                                                    {/* 案件名 */}
                                                    <div className="font-medium text-white text-sm truncate">
                                                        {event.title}
                                                    </div>

                                                    {/* 元請名 */}
                                                    {event.customer && (
                                                        <div className="text-white/90 text-xs mt-1 truncate">
                                                            {event.customer}
                                                        </div>
                                                    )}

                                                    {/* 工事種別・人数 */}
                                                    <div className="flex items-center gap-3 mt-2">
                                                        <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded">
                                                            {getConstructionTypeLabel(event.constructionType)}
                                                        </span>
                                                        {event.workers && event.workers.length > 0 && (
                                                            <span className="text-white/90 text-xs flex items-center gap-1">
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                                </svg>
                                                                {event.workers.length}人
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* 備考 */}
                                                    {event.remarks && (
                                                        <div className="text-white/80 text-xs mt-2 line-clamp-2">
                                                            📝 {event.remarks}
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* フローティング追加ボタン */}
            {!isReadOnly && onAddEvent && (
                <button
                    onClick={onAddEvent}
                    className="fixed bottom-6 right-6 w-14 h-14 bg-slate-800 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-slate-700 active:scale-95 transition-all z-50"
                >
                    <Plus className="w-7 h-7" />
                </button>
            )}
        </div>
    );
}
