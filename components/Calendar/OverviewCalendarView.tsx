'use client';

import React, { useRef } from 'react';
import { CalendarEvent, EmployeeRow, WeekDay } from '@/types/calendar';
import { getEventsForDate, formatDateKey } from '@/utils/employeeUtils';
import { getDayOfWeekString } from '@/utils/dateUtils';
import { TENTATIVE_STRIPE_BG } from './tentativeStyle';

interface OverviewCalendarViewProps {
    weekDays: WeekDay[];
    events: CalendarEvent[];
    employeeRows: EmployeeRow[];
    getTotalMembersForDate: (dateStr: string) => number;
    getVacationEmployees: (dateKey: string) => string[];
    getMemberAdjustment?: (dateKey: string) => number;
    goToPreviousWeek?: () => void;
    goToNextWeek?: () => void;
    goToPreviousDay?: () => void;
    goToNextDay?: () => void;
    goToToday?: () => void;
}

// Min row height in px — rows won't shrink below this
const MIN_ROW_HEIGHT = 32;

function MiniCard({ event }: { event: CalendarEvent }) {
    return (
        <div
            className="rounded px-0.5 overflow-hidden max-w-full"
            style={{
                backgroundColor: event.color || '#e2e8f0',
                ...(event.dateStatus === 'tentative' ? { backgroundImage: TENTATIVE_STRIPE_BG } : {}),
                marginBottom: 1,
                paddingTop: 1,
                paddingBottom: 1,
            }}
        >
            <div className="font-medium text-slate-800 truncate text-[7px] leading-[8px]">
                {event.dateStatus === 'tentative' && <span className="font-bold">[仮]</span>}
                {(event as any).name
                    ? `${(event as any).name}${(event as any).honorific || ''}${(event as any).siteShortName ? ' ' + (event as any).siteShortName : ''}`
                    : event.title}
            </div>
            {event.customer && (
                <div className="text-[7px] leading-[8px] text-slate-600 truncate">
                    {event.customer}
                </div>
            )}
        </div>
    );
}

export default function OverviewCalendarView({
    weekDays,
    events,
    employeeRows,
    getTotalMembersForDate,
    getVacationEmployees,
    getMemberAdjustment,
    goToPreviousWeek,
    goToNextWeek,
    goToPreviousDay,
    goToNextDay,
    goToToday: _goToToday,
}: OverviewCalendarViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    // ナビ系 props はもう ScheduleToolbar に集約されたため使わない（互換のため受け取りはする）
    void goToPreviousWeek; void goToNextWeek; void goToPreviousDay; void goToNextDay;

    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
            {/* Table content — fills remaining space */}
            <div
                ref={containerRef}
                className="flex-1 overflow-auto"
            >
                <table className="w-full border-collapse table-fixed">
                    <colgroup>
                        <col style={{ width: '60px' }} />
                        {weekDays.map((_, i) => (
                            <col key={i} />
                        ))}
                    </colgroup>
                    {/* Header */}
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-100">
                            <th className="text-[8px] font-bold text-slate-700 border border-slate-300 px-0 py-0.5 sticky left-0 z-20 bg-slate-100" style={{ width: '60px' }}>
                                職長
                            </th>
                            {weekDays.map((day, i) => {
                                const dayStr = getDayOfWeekString(day.date, 'short');
                                const d = day.date.getDate();
                                const isSat = day.dayOfWeek === 6;
                                const isSun = day.dayOfWeek === 0;
                                return (
                                    <th
                                        key={i}
                                        className={`text-[8px] font-bold border border-slate-300 px-0 py-0.5 ${
                                            day.isToday ? 'bg-teal-600 text-white' :
                                            isSat ? 'bg-blue-50 text-blue-700' :
                                            isSun ? 'bg-rose-50 text-rose-700' :
                                            'text-slate-700'
                                        }`}
                                    >
                                        {d}({dayStr})
                                    </th>
                                );
                            })}
                        </tr>
                        {/* Remaining members row */}
                        <tr className="bg-white">
                            <td className="text-[7px] font-bold text-slate-600 border border-slate-300 px-0 py-0.5 text-center sticky left-0 z-20 bg-white" style={{ width: '60px' }}>
                                残り
                            </td>
                            {weekDays.map((day, i) => {
                                const dateKey = formatDateKey(day.date);
                                const dayEvents = events.filter(e => formatDateKey(e.startDate) === dateKey);
                                const byForeman = new Map<string, number[]>();
                                let unassignedCount = 0;
                                dayEvents.forEach(e => {
                                    const count = e.memberCount ?? 0;
                                    const key = e.assignedEmployeeId;
                                    if (!key || key === 'unassigned') {
                                        unassignedCount += count;
                                        return;
                                    }
                                    if (!byForeman.has(key)) byForeman.set(key, []);
                                    byForeman.get(key)!.push(count);
                                });
                                let assigned = unassignedCount;
                                byForeman.forEach(counts => { assigned += Math.max(...counts); });
                                const vacation = getVacationEmployees(dateKey).length;
                                const adj = getMemberAdjustment ? getMemberAdjustment(dateKey) : 0;
                                const remaining = getTotalMembersForDate(dateKey) + adj - assigned - vacation;
                                return (
                                    <td key={i} className="text-center border border-slate-300 px-0 py-0.5">
                                        <span className={`text-[8px] font-bold ${remaining > 0 ? 'text-blue-600' : remaining === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {remaining}人
                                        </span>
                                    </td>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {employeeRows.map((row) => (
                            <tr key={row.employeeId} className="border-b border-slate-200">
                                <td
                                    className="text-[7px] font-semibold text-slate-700 border border-slate-200 px-0.5 py-0 text-center sticky left-0 z-10 bg-white whitespace-nowrap overflow-hidden"
                                    style={{ width: '60px', minHeight: MIN_ROW_HEIGHT }}
                                >
                                    {row.employeeName}
                                </td>
                                {weekDays.map((day, i) => {
                                    const cellEvents = getEventsForDate(row, day.date);
                                    const isSat = day.dayOfWeek === 6;
                                    const isSun = day.dayOfWeek === 0;
                                    return (
                                        <td
                                            key={i}
                                            className={`border border-slate-200 px-px align-top overflow-hidden ${
                                                isSat ? 'bg-blue-50/30' : isSun ? 'bg-rose-50/30' : ''
                                            }`}
                                            style={{ minHeight: MIN_ROW_HEIGHT }}
                                        >
                                            <div>
                                                {cellEvents.map((event) => (
                                                    <MiniCard key={event.id} event={event} />
                                                ))}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                        {/* 浮いている行（班未定の配置）。存在する週だけ表示 */}
                        {events.some(e => e.assignedEmployeeId === 'unassigned') && (
                            <tr className="border-b border-red-200 bg-red-50/40">
                                <td
                                    className="text-[7px] font-bold text-red-700 border border-red-200 px-0.5 py-0 text-center sticky left-0 z-10 bg-red-50 whitespace-nowrap overflow-hidden"
                                    style={{ width: '60px', minHeight: MIN_ROW_HEIGHT }}
                                >
                                    浮いている
                                </td>
                                {weekDays.map((day, i) => {
                                    const dateKey = formatDateKey(day.date);
                                    const cellEvents = events
                                        .filter(e => e.assignedEmployeeId === 'unassigned' && formatDateKey(e.startDate) === dateKey)
                                        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                                    return (
                                        <td key={i} className="border border-red-100 px-px align-top overflow-hidden" style={{ minHeight: MIN_ROW_HEIGHT }}>
                                            <div>
                                                {cellEvents.map((event) => (
                                                    <MiniCard key={event.id} event={event} />
                                                ))}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
