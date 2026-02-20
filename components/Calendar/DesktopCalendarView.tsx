'use client';

import React from 'react';
import { DndContext, DragOverlay, closestCenter, DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import { CalendarEvent, EmployeeRow, Project, WeekDay, EditingUser } from '@/types/calendar';
import { unassignedEmployee } from '@/data/mockEmployees';
import { formatDateKey } from '@/utils/employeeUtils';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import CalendarHeader from './CalendarHeader';
import EmployeeRowComponent from './EmployeeRowComponent';
import DraggableEventCard from './DraggableEventCard';
import RemarksRow from './RemarksRow';
import ForemanSelector from './ForemanSelector';

interface DesktopCalendarViewProps {
    weekDays: WeekDay[];
    events: CalendarEvent[];
    employeeRows: EmployeeRow[];
    projects: Project[];
    activeEvent: CalendarEvent | null;
    isReadOnly: boolean;
    canDispatch: boolean;
    isSaving: boolean;
    totalMembers: number;
    getVacationEmployees: (dateKey: string) => string[];
    getEditingUsers: (assignmentId: string) => EditingUser[];
    // Navigation
    goToPreviousWeek: () => void;
    goToNextWeek: () => void;
    goToPreviousDay: () => void;
    goToNextDay: () => void;
    goToToday: () => void;
    // DnD
    handleDragStart: (event: DragStartEvent) => void;
    handleDragOver: (event: DragOverEvent) => void;
    handleDragEnd: (event: DragEndEvent) => void;
    handleDragCancel: () => void;
    // Event handlers
    handleEventClick: (eventId: string) => void;
    handleCellClick?: (employeeId: string, date: Date) => void;
    handleMoveEvent?: (eventId: string, direction: 'up' | 'down') => void;
    removeForeman?: (employeeId: string) => void;
    moveForeman?: (employeeId: string, direction: 'up' | 'down') => void;
    handleOpenDispatchModal?: (projectId: string) => void;
    handleCopyEvent?: (eventId: string) => void;
}

export default function DesktopCalendarView({
    weekDays,
    events,
    employeeRows,
    projects,
    activeEvent,
    isReadOnly,
    canDispatch,
    isSaving,
    totalMembers,
    getVacationEmployees,
    getEditingUsers,
    goToPreviousWeek,
    goToNextWeek,
    goToPreviousDay,
    goToNextDay,
    goToToday,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    handleEventClick,
    handleCellClick,
    handleMoveEvent,
    removeForeman,
    moveForeman,
    handleOpenDispatchModal,
    handleCopyEvent,
}: DesktopCalendarViewProps) {
    return (
        <DndContext
            collisionDetection={closestCenter}
            onDragStart={isReadOnly ? undefined : handleDragStart}
            onDragOver={isReadOnly ? undefined : handleDragOver}
            onDragEnd={isReadOnly ? undefined : handleDragEnd}
            onDragCancel={isReadOnly ? undefined : handleDragCancel}
        >
            <div className="calendar-container h-full flex flex-col bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
                <CalendarHeader
                    weekDays={weekDays}
                    onPreviousWeek={goToPreviousWeek}
                    onNextWeek={goToNextWeek}
                    onPreviousDay={goToPreviousDay}
                    onNextDay={goToNextDay}
                    onToday={goToToday}
                />

                <div className="flex-1 overflow-auto bg-gradient-to-br from-slate-50 via-white to-slate-50">
                    <div className="flex flex-col min-w-full">
                        {/* ヘッダー行: 日付と曜日 + 残り人数行 を1つのstickyコンテナにまとめる */}
                        <div className="sticky top-0 z-20 shadow-md">
                            {/* 日付・曜日ヘッダー行 */}
                            <div className="flex border-b-2 border-slate-300 bg-gradient-to-r from-slate-100 to-slate-50">
                                <div className="sticky left-0 z-30 bg-gradient-to-r from-slate-100 to-slate-50 border-r-2 border-slate-300 shadow-md">
                                    <div className="w-32 h-8 flex items-center justify-center font-bold text-slate-700 text-xs tracking-wide">職長</div>
                                </div>
                                {weekDays.map((day, index) => {
                                    const dayOfWeekString = getDayOfWeekString(day.date, 'short');
                                    const dateString = formatDate(day.date, 'short');
                                    const isSaturday = day.dayOfWeek === 6;
                                    const isSunday = day.dayOfWeek === 0;
                                    const combinedDate = `${dateString}(${dayOfWeekString})`;

                                    return (
                                        <div key={index} className={`flex-1 min-w-[140px] border-r border-slate-300 h-8 flex items-center justify-center ${isSaturday ? 'bg-gradient-to-b from-blue-100 to-blue-50' : isSunday ? 'bg-gradient-to-b from-rose-100 to-rose-50' : 'bg-gradient-to-b from-slate-100 to-slate-50'} ${day.isToday ? 'bg-gradient-to-r from-slate-700 to-slate-600' : ''}`}>
                                            <div className={`text-[11px] font-bold ${isSaturday ? 'text-slate-700' : isSunday ? 'text-slate-600' : 'text-slate-700'} ${day.isToday ? 'text-white' : ''}`}>{combinedDate}</div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 未割り当て行 */}
                            <div className="flex border-b-2 border-slate-400 bg-gradient-to-r from-slate-100 to-slate-50 h-9">
                                <div className="sticky left-0 z-30 bg-gradient-to-r from-slate-100 to-slate-50 border-r-2 border-slate-400 shadow-md">
                                    <div className="w-32 h-full flex items-center justify-center">
                                        <span className="text-xs font-bold text-slate-700 tracking-wide truncate">{unassignedEmployee.name}</span>
                                    </div>
                                </div>
                                {weekDays.map((day, index) => {
                                    const dateKey = formatDateKey(day.date);
                                    const isSaturday = day.dayOfWeek === 6;
                                    const isSunday = day.dayOfWeek === 0;
                                    const dayEvents = events.filter(event => formatDateKey(event.startDate) === dateKey && event.assignedEmployeeId !== 'unassigned');
                                    // 職長ごとに最大人数のみ計上
                                    const byForeman = new Map<string, number[]>();
                                    dayEvents.forEach(event => {
                                        const key = event.assignedEmployeeId!;
                                        if (!byForeman.has(key)) byForeman.set(key, []);
                                        byForeman.get(key)!.push(event.workers?.length || event.memberCount || 0);
                                    });
                                    let assignedCount = 0;
                                    byForeman.forEach(counts => { assignedCount += Math.max(...counts); });
                                    const vacationCount = getVacationEmployees(dateKey).length;
                                    const remainingCount = totalMembers - assignedCount - vacationCount;

                                    return (
                                        <div key={index} className={`flex-1 min-w-[140px] h-full border-r border-gray-100 p-1 flex items-center justify-center gap-1.5 ${isSaturday ? 'bg-slate-50/30' : isSunday ? 'bg-slate-50/30' : 'bg-white'}`}>
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold shadow-sm text-white ${remainingCount > 0 ? 'bg-slate-600' : remainingCount === 0 ? 'bg-slate-400' : 'bg-slate-700'}`}>{remainingCount}人</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {!isReadOnly && <RemarksRow weekDays={weekDays} />}

                        <div className="flex-1 flex flex-col">
                            {employeeRows.map((row, index) => (
                                <EmployeeRowComponent
                                    key={row.employeeId}
                                    row={row}
                                    weekDays={weekDays}
                                    showEmployeeName={true}
                                    onEventClick={handleEventClick}
                                    onCellClick={isReadOnly ? undefined : handleCellClick}
                                    onMoveEvent={isReadOnly ? undefined : handleMoveEvent}
                                    onRemoveForeman={isReadOnly ? undefined : removeForeman}
                                    onMoveForeman={isReadOnly ? undefined : moveForeman}
                                    isFirst={index === 0}
                                    isLast={index === employeeRows.length - 1}
                                    onDispatch={isReadOnly ? undefined : handleOpenDispatchModal}
                                    canDispatch={isReadOnly ? false : canDispatch}
                                    projects={projects}
                                    isReadOnly={isReadOnly}
                                    onCopyEvent={isReadOnly ? undefined : handleCopyEvent}
                                    getEditingUsers={getEditingUsers}
                                />
                            ))}
                        </div>

                        <div className="flex border-t-2 border-slate-300 bg-gradient-to-r from-slate-50 to-white p-4">
                            <ForemanSelector />
                        </div>
                    </div>
                </div>
            </div>

            <DragOverlay>
                {activeEvent ? <div className="opacity-90"><DraggableEventCard event={activeEvent} /></div> : null}
            </DragOverlay>

            {/* 保存中オーバーレイ */}
            {isSaving && (
                <div className="fixed inset-0 lg:left-64 z-[55] flex items-center justify-center bg-black/30 pointer-events-none">
                    <div className="bg-white rounded-lg px-6 py-4 shadow-xl flex items-center gap-3 pointer-events-auto">
                        <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium text-gray-700">案件を保存中...</span>
                    </div>
                </div>
            )}
        </DndContext>
    );
}
