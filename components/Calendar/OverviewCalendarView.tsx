'use client';

import React, { useRef, useEffect, useState } from 'react';
import { CalendarEvent, EmployeeRow, WeekDay } from '@/types/calendar';
import { getEventsForDate, formatDateKey } from '@/utils/employeeUtils';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';

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
            className="rounded px-0.5 py-px mb-px overflow-hidden"
            style={{ backgroundColor: event.color || '#e2e8f0' }}
        >
            <div className="text-[7px] leading-[9px] font-medium text-slate-800 truncate">
                {(event as any).name || event.title}
            </div>
            <div className="text-[6px] leading-[8px] text-slate-600 truncate">
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
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const [origin, setOrigin] = useState({ x: 0, y: 0 });

    // Pinch zoom handling
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let startDistance = 0;
        let startScale = 1;

        const getDistance = (touches: TouchList) => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const getMidpoint = (touches: TouchList) => {
            const rect = container.getBoundingClientRect();
            return {
                x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left + container.scrollLeft,
                y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top + container.scrollTop,
            };
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                startDistance = getDistance(e.touches);
                startScale = scale;
                const mid = getMidpoint(e.touches);
                setOrigin(mid);
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const currentDistance = getDistance(e.touches);
                const newScale = Math.max(0.3, Math.min(3, startScale * (currentDistance / startDistance)));
                setScale(newScale);
            }
        };

        // Wheel zoom for desktop
        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const rect = container.getBoundingClientRect();
                const x = e.clientX - rect.left + container.scrollLeft;
                const y = e.clientY - rect.top + container.scrollTop;
                setOrigin({ x, y });
                setScale(prev => Math.max(0.3, Math.min(3, prev - e.deltaY * 0.002)));
            }
        };

        container.addEventListener('touchstart', onTouchStart, { passive: false });
        container.addEventListener('touchmove', onTouchMove, { passive: false });
        container.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('wheel', onWheel);
        };
    }, [scale]);

    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
            {/* Zoom controls */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex-shrink-0">
                <span className="text-xs text-slate-500">俯瞰ビュー（閲覧専用）</span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setScale(prev => Math.max(0.3, prev - 0.1))}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs font-bold"
                    >
                        −
                    </button>
                    <span className="text-xs text-slate-600 min-w-[3em] text-center">{Math.round(scale * 100)}%</span>
                    <button
                        onClick={() => setScale(prev => Math.min(3, prev + 0.1))}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs font-bold"
                    >
                        +
                    </button>
                    <button
                        onClick={() => setScale(1)}
                        className="px-2 h-6 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-600 text-[10px]"
                    >
                        リセット
                    </button>
                </div>
            </div>

            {/* Zoomable content */}
            <div ref={containerRef} className="flex-1 overflow-auto">
                <div
                    ref={contentRef}
                    style={{
                        transform: `scale(${scale})`,
                        transformOrigin: `${origin.x}px ${origin.y}px`,
                        minWidth: scale < 1 ? `${100 / scale}%` : '100%',
                    }}
                >
                    <table className="w-full border-collapse table-fixed" style={{ minWidth: '700px' }}>
                        <colgroup>
                            <col className="w-[60px]" />
                            {weekDays.map((_, i) => (
                                <col key={i} />
                            ))}
                        </colgroup>
                        {/* Header */}
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-slate-100">
                                <th className="text-[9px] font-bold text-slate-700 border border-slate-300 px-1 py-0.5 sticky left-0 z-20 bg-slate-100">
                                    職長
                                </th>
                                {weekDays.map((day, i) => {
                                    const dayStr = getDayOfWeekString(day.date, 'short');
                                    const dateStr = formatDate(day.date, 'short');
                                    const isSat = day.dayOfWeek === 6;
                                    const isSun = day.dayOfWeek === 0;
                                    return (
                                        <th
                                            key={i}
                                            className={`text-[9px] font-bold border border-slate-300 px-1 py-0.5 ${
                                                day.isToday ? 'bg-slate-700 text-white' :
                                                isSat ? 'bg-blue-50 text-blue-700' :
                                                isSun ? 'bg-rose-50 text-rose-700' :
                                                'text-slate-700'
                                            }`}
                                        >
                                            {dateStr}({dayStr})
                                        </th>
                                    );
                                })}
                            </tr>
                            {/* Remaining members row */}
                            <tr className="bg-white">
                                <td className="text-[8px] font-bold text-slate-600 border border-slate-300 px-1 py-0.5 text-center sticky left-0 z-20 bg-white">
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
                                        <td key={i} className="text-center border border-slate-300 px-1 py-0.5">
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
                                    <td className="text-[8px] font-semibold text-slate-700 border border-slate-200 px-1 py-0.5 text-center sticky left-0 z-10 bg-white whitespace-nowrap">
                                        {row.employeeName}
                                    </td>
                                    {weekDays.map((day, i) => {
                                        const cellEvents = getEventsForDate(row, day.date);
                                        const isSat = day.dayOfWeek === 6;
                                        const isSun = day.dayOfWeek === 0;
                                        return (
                                            <td
                                                key={i}
                                                className={`border border-slate-200 px-0.5 py-0.5 align-top ${
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
        </div>
    );
}
