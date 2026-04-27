'use client';

import React, { useRef } from 'react';
import { CalendarEvent, EmployeeRow, WeekDay } from '@/types/calendar';
import { getEventsForDate, formatDateKey } from '@/utils/employeeUtils';
import { getDayOfWeekString } from '@/utils/dateUtils';

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
// Fixed heights for header area (nav bar + thead rows)
const NAV_HEIGHT = 36;

function MiniCard({ event }: { event: CalendarEvent }) {
    return (
        <div
            className="rounded px-0.5 overflow-hidden max-w-full"
            style={{
                backgroundColor: event.color || '#e2e8f0',
                marginBottom: 1,
                paddingTop: 1,
                paddingBottom: 1,
            }}
        >
            <div className="font-medium text-slate-800 truncate text-[7px] leading-[8px]">
                {(event as any).name ? `${(event as any).name}${(event as any).honorific || ''}` : event.title}
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

    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
            {/* Header with nav */}
            <div className="px-2 py-1 bg-slate-50 border-b border-slate-200 flex-shrink-0 flex items-center justify-between" style={{ height: NAV_HEIGHT }}>
                {goToPreviousWeek && goToPreviousDay ? (
                    <div className="flex items-center">
                        <button onClick={goToPreviousWeek} className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors" aria-label="1週間前">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                        </button>
                        <button onClick={goToPreviousDay} className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors" aria-label="1日前">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                    </div>
                ) : <div />}
                <span className="text-xs text-slate-500">俯瞰ビュー</span>
                {goToNextDay && goToNextWeek ? (
                    <div className="flex items-center">
                        <button onClick={goToNextDay} className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors" aria-label="1日後">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                        <button onClick={goToNextWeek} className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors" aria-label="1週間後">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                ) : <div />}
            </div>

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
                                            day.isToday ? 'bg-slate-700 text-white' :
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
                                const dayEvents = events.filter(e => formatDateKey(e.startDate) === dateKey && e.assignedEmployeeId !== 'unassigned');
                                const byForeman = new Map<string, number[]>();
                                dayEvents.forEach(e => {
                                    const key = e.assignedEmployeeId!;
                                    if (!byForeman.has(key)) byForeman.set(key, []);
                                    byForeman.get(key)!.push((e.memberCount ?? 0) > 0 ? e.memberCount! : (e.workers?.length || 0));
                                });
                                let assigned = 0;
                                byForeman.forEach(counts => { assigned += Math.max(...counts); });
                                const vacation = getVacationEmployees(dateKey).length;
                                const adj = getMemberAdjustment ? getMemberAdjustment(dateKey) : 0;
                                const remaining = getTotalMembersForDate(dateKey) + adj - assigned - vacation;
                                return (
                                    <td key={i} className="text-center border border-slate-300 px-0 py-0.5">
                                        <span className={`text-[8px] font-bold ${remaining > 0 ? 'text-slate-700' : remaining === 0 ? 'text-slate-400' : 'text-red-600'}`}>
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
                    </tbody>
                </table>
            </div>
        </div>
    );
}
