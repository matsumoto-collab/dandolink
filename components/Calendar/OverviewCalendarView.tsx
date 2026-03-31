'use client';

import React from 'react';
import { CalendarEvent, EmployeeRow, WeekDay } from '@/types/calendar';
import { getEventsForDate, formatDateKey } from '@/utils/employeeUtils';
import { getDayOfWeekString } from '@/utils/dateUtils';

interface OverviewCalendarViewProps {
    weekDays: WeekDay[];
    events: CalendarEvent[];
    employeeRows: EmployeeRow[];
    totalMembers: number;
    getVacationEmployees: (dateKey: string) => string[];
    getMemberAdjustment?: (dateKey: string) => number;
}

function MiniCard({ event }: { event: CalendarEvent }) {
    return (
        <div
            className="rounded px-0.5 py-px mb-px overflow-hidden max-w-full"
            style={{ backgroundColor: event.color || '#e2e8f0' }}
        >
            <div className="text-[6px] leading-[7px] font-medium text-slate-800 truncate">
                {(event as any).name || event.title}
            </div>
            <div className="text-[5px] leading-[7px] text-slate-600 truncate">
                {event.customer || ''}
            </div>
        </div>
    );
}

export default function OverviewCalendarView({
    weekDays,
    events,
    employeeRows,
    totalMembers,
    getVacationEmployees,
    getMemberAdjustment,
}: OverviewCalendarViewProps) {
    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="px-3 py-1 bg-slate-50 border-b border-slate-200 flex-shrink-0">
                <span className="text-xs text-slate-500">俯瞰ビュー（閲覧専用 / ピンチで拡大縮小）</span>
            </div>

            {/* Scrollable content - touch-action: auto allows native pinch zoom */}
            <div className="flex-1 overflow-auto" style={{ touchAction: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="w-full border-collapse table-fixed">
                    <colgroup>
                        <col style={{ width: '42px' }} />
                        {weekDays.map((_, i) => (
                            <col key={i} style={{ width: `${(100 - 4) / 7}%` }} />
                        ))}
                    </colgroup>
                    {/* Header */}
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-100">
                            <th className="text-[8px] font-bold text-slate-700 border border-slate-300 px-0 py-0.5 sticky left-0 z-20 bg-slate-100" style={{ width: '42px' }}>
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
                            <td className="text-[7px] font-bold text-slate-600 border border-slate-300 px-0 py-0.5 text-center sticky left-0 z-20 bg-white" style={{ width: '42px' }}>
                                残り
                            </td>
                            {weekDays.map((day, i) => {
                                const dateKey = formatDateKey(day.date);
                                const dayEvents = events.filter(e => formatDateKey(e.startDate) === dateKey && e.assignedEmployeeId !== 'unassigned');
                                const byForeman = new Map<string, number[]>();
                                dayEvents.forEach(e => {
                                    const key = e.assignedEmployeeId!;
                                    if (!byForeman.has(key)) byForeman.set(key, []);
                                    byForeman.get(key)!.push(e.workers?.length || e.memberCount || 0);
                                });
                                let assigned = 0;
                                byForeman.forEach(counts => { assigned += Math.max(...counts); });
                                const vacation = getVacationEmployees(dateKey).length;
                                const adj = getMemberAdjustment ? getMemberAdjustment(dateKey) : 0;
                                const remaining = totalMembers + adj - assigned - vacation;
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
                                <td className="text-[7px] font-semibold text-slate-700 border border-slate-200 px-0.5 py-0 text-center sticky left-0 z-10 bg-white whitespace-nowrap" style={{ width: '42px' }}>
                                    {row.employeeName}
                                </td>
                                {weekDays.map((day, i) => {
                                    const cellEvents = getEventsForDate(row, day.date);
                                    const isSat = day.dayOfWeek === 6;
                                    const isSun = day.dayOfWeek === 0;
                                    return (
                                        <td
                                            key={i}
                                            className={`border border-slate-200 px-px py-px align-top ${
                                                isSat ? 'bg-blue-50/30' : isSun ? 'bg-rose-50/30' : ''
                                            }`}
                                        >
                                            {cellEvents.map((event) => (
                                                <MiniCard key={event.id} event={event} />
                                            ))}
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
