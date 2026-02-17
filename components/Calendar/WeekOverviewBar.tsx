'use client';

import React, { useMemo } from 'react';
import { CalendarEvent, WeekDay } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { getDayOfWeekString } from '@/utils/dateUtils';

interface WeekOverviewBarProps {
    weekDays: WeekDay[];
    events: CalendarEvent[];
    selectedDateKey: string;
    totalMembers: number;
    getVacationEmployees: (dateKey: string) => string[];
    onSelectDay: (dateKey: string) => void;
}

export default function WeekOverviewBar({
    weekDays,
    events,
    selectedDateKey,
    totalMembers,
    getVacationEmployees,
    onSelectDay,
}: WeekOverviewBarProps) {
    const dayStats = useMemo(() => {
        return weekDays.map(day => {
            const dateKey = formatDateKey(day.date);
            const dayEvents = events.filter(e => formatDateKey(e.startDate) === dateKey);
            const eventCount = dayEvents.length;
            // 職長ごとにグルーピングし、各職長の最大人数のみ計上（同一チームの移動を二重カウントしない）
            const byForeman = new Map<string, number[]>();
            dayEvents
                .filter(e => e.assignedEmployeeId !== 'unassigned')
                .forEach(e => {
                    const key = e.assignedEmployeeId!;
                    if (!byForeman.has(key)) byForeman.set(key, []);
                    byForeman.get(key)!.push(e.workers?.length || e.memberCount || 0);
                });
            let assignedWorkers = 0;
            byForeman.forEach(counts => { assignedWorkers += Math.max(...counts); });
            const totalHours = dayEvents
                .filter(e => e.assignedEmployeeId !== 'unassigned')
                .reduce((sum, e) => sum + (e.estimatedHours ?? 8), 0);
            const vacationCount = getVacationEmployees(dateKey).length;
            const remaining = totalMembers - assignedWorkers - vacationCount;
            const capacityHours = totalMembers * 8;
            const remainingHours = capacityHours - totalHours;
            // 充足率: 時間ベース
            const fillRate = capacityHours > 0
                ? Math.min(1, totalHours / capacityHours)
                : 0;

            return { dateKey, eventCount, remaining, remainingHours, fillRate, day };
        });
    }, [weekDays, events, totalMembers, getVacationEmployees]);

    const getFillColor = (remainingHours: number) => {
        if (remainingHours < 0) return 'bg-red-500';     // 超過
        if (remainingHours === 0) return 'bg-amber-500';  // 満員
        if (remainingHours <= 8) return 'bg-emerald-500'; // 残り少
        return 'bg-emerald-400';                          // 余裕あり
    };

    return (
        <div className="bg-white border-b border-slate-200 shadow-sm">
            <div className="grid grid-cols-7 gap-0">
                {dayStats.map(({ dateKey, eventCount, remainingHours, fillRate, day }) => {
                    const isSelected = dateKey === selectedDateKey;
                    const isSaturday = day.dayOfWeek === 6;
                    const isSunday = day.dayOfWeek === 0;
                    const dayLabel = getDayOfWeekString(day.date, 'short');
                    const dateNum = day.date.getDate();

                    return (
                        <button
                            key={dateKey}
                            onClick={() => onSelectDay(dateKey)}
                            className={`
                                flex flex-col items-center py-2 px-1 transition-all relative
                                ${isSelected
                                    ? 'bg-slate-700 text-white'
                                    : day.isToday
                                        ? 'bg-blue-50'
                                        : 'hover:bg-slate-50'
                                }
                            `}
                        >
                            {/* 曜日 */}
                            <span className={`text-[10px] font-bold ${
                                isSelected ? 'text-white' :
                                isSunday ? 'text-red-500' :
                                isSaturday ? 'text-blue-500' :
                                'text-slate-500'
                            }`}>
                                {dayLabel}
                            </span>

                            {/* 日付 */}
                            <span className={`text-sm font-bold leading-tight ${
                                isSelected ? 'text-white' :
                                isSunday ? 'text-red-600' :
                                isSaturday ? 'text-blue-600' :
                                'text-slate-800'
                            }`}>
                                {dateNum}
                            </span>

                            {/* 案件数 + 残時間 */}
                            {eventCount > 0 ? (
                                <span className={`text-[10px] font-bold mt-0.5 ${
                                    isSelected ? 'text-slate-200' : 'text-slate-500'
                                }`}>
                                    {eventCount}件
                                </span>
                            ) : null}
                            <span className={`text-[10px] font-bold ${
                                isSelected ? 'text-slate-200' :
                                remainingHours <= 0 ? 'text-red-500' :
                                remainingHours <= 8 ? 'text-amber-600' :
                                'text-emerald-600'
                            }`}>
                                {remainingHours <= 0 ? '満員' : `残${remainingHours}h`}
                            </span>

                            {/* 充足率バー */}
                            <div className={`w-full h-1 mt-0.5 rounded-full ${
                                isSelected ? 'bg-slate-500' : 'bg-slate-200'
                            }`}>
                                <div
                                    className={`h-full rounded-full transition-all ${
                                        isSelected ? 'bg-white' : getFillColor(remainingHours)
                                    }`}
                                    style={{ width: `${Math.round(fillRate * 100)}%` }}
                                />
                            </div>

                            {/* 今日インジケーター */}
                            {day.isToday && !isSelected && (
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-500" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
