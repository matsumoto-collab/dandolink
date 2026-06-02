'use client';

import React, { useState, useCallback, useRef } from 'react';
import { DndContext, DragOverlay, closestCenter, DragStartEvent, DragOverEvent, DragEndEvent, useSensor, useSensors, PointerSensor, KeyboardSensor } from '@dnd-kit/core';
import { MoveRight, X, Search } from 'lucide-react';
import { CalendarEvent, EmployeeRow, Project, WeekDay, EditingUser } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
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
    getTotalMembersForDate: (dateStr: string) => number;
    getVacationEmployees: (dateKey: string) => string[];
    getEditingUsers: (assignmentId: string) => EditingUser[];
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
    handleMoveToCell?: (event: CalendarEvent, employeeId: string, date: Date) => void;
    handleOpenSearch?: () => void;
    highlightedEventId?: string | null;
    getMemberAdjustment?: (dateKey: string) => number;
    onMemberAdjustmentChange?: (dateKey: string, delta: number) => void;
    // Navigation
    goToPreviousWeek?: () => void;
    goToNextWeek?: () => void;
    goToPreviousDay?: () => void;
    goToNextDay?: () => void;
    goToToday?: () => void;
    weekLabel?: string;
    hideRemarks?: boolean;
    hideForemanSelector?: boolean;
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
    getTotalMembersForDate,
    getVacationEmployees,
    getEditingUsers,
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
    handleMoveToCell,
    handleOpenSearch,
    highlightedEventId = null,
    getMemberAdjustment,
    onMemberAdjustmentChange,
    goToPreviousWeek,
    goToNextWeek,
    goToPreviousDay,
    goToNextDay,
    goToToday,
    weekLabel,
    hideRemarks = false,
    hideForemanSelector = false,
}: DesktopCalendarViewProps) {
    // PointerSensor を距離アクティベーション化（長押しと共存させる）
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor)
    );

    // 移動モード（モバイルと同じ：長押し → ターゲットセルクリックで移動）
    const [movingEvent, setMovingEvent] = useState<CalendarEvent | null>(null);
    // 長押し直後のクリックで即cancel/commitしないようにするクールダウン
    const moveStartedAtRef = useRef<number>(0);
    const COMMIT_COOLDOWN_MS = 350;
    const cancelMoving = useCallback(() => {
        if (Date.now() - moveStartedAtRef.current < COMMIT_COOLDOWN_MS) return;
        setMovingEvent(null);
    }, []);
    const startMoving = useCallback((event: CalendarEvent) => {
        if (isReadOnly || !handleMoveToCell) return;
        moveStartedAtRef.current = Date.now();
        setMovingEvent(event);
    }, [isReadOnly, handleMoveToCell]);
    const commitMove = useCallback((employeeId: string, date: Date) => {
        if (Date.now() - moveStartedAtRef.current < COMMIT_COOLDOWN_MS) return;
        if (!movingEvent || !handleMoveToCell) return;
        handleMoveToCell(movingEvent, employeeId, date);
        setMovingEvent(null);
    }, [movingEvent, handleMoveToCell]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={isReadOnly || movingEvent ? undefined : handleDragStart}
            onDragOver={isReadOnly || movingEvent ? undefined : handleDragOver}
            onDragEnd={isReadOnly || movingEvent ? undefined : handleDragEnd}
            onDragCancel={isReadOnly || movingEvent ? undefined : handleDragCancel}
        >
            {/* ── 移動モードバナー（fixed: レイアウトシフトしないように／上部ナビと被らないよう下中央に固定） ── */}
            {movingEvent && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-700 text-white px-4 py-2 flex items-center gap-3 rounded-xl shadow-2xl ring-1 ring-slate-900/10 max-w-[min(90vw,640px)] w-[max-content]">
                    <MoveRight className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <span className="text-sm font-bold truncate block">「{movingEvent.title}」を移動中</span>
                        <span className="text-xs text-slate-200">移動先のセルをクリック</span>
                    </div>
                    <button
                        onClick={cancelMoving}
                        className="flex items-center gap-1 bg-slate-600 hover:bg-slate-500 active:bg-slate-800 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors"
                    >
                        <X className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">キャンセル</span>
                    </button>
                </div>
            )}

            {/* ── ナビゲーション ── */}
            {goToPreviousWeek && goToNextWeek && goToToday && (
                <div className="flex-shrink-0 bg-white border border-slate-200 rounded-lg shadow-sm mb-2 px-4 py-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        <button onClick={goToPreviousWeek} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1週間前">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                        </button>
                        {goToPreviousDay && (
                            <button onClick={goToPreviousDay} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1日前">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={goToToday} className="font-bold text-sm text-slate-800 px-3 py-1 rounded-lg hover:bg-slate-100 transition-colors">
                            {weekLabel || '今週'}
                        </button>
                        {handleOpenSearch && (
                            <button
                                onClick={handleOpenSearch}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
                                aria-label="案件を検索"
                                title="案件を検索"
                            >
                                <Search className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {goToNextDay && (
                            <button onClick={goToNextDay} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1日後">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            </button>
                        )}
                        <button onClick={goToNextWeek} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" aria-label="1週間後">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                </div>
            )}

            <div className="calendar-container h-full flex flex-col bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
                <div className="flex-1 overflow-auto bg-slate-50">
                    <div className="flex flex-col min-w-full">
                        {/* ヘッダー行: 日付と曜日 + 残り人数行 を1つのstickyコンテナにまとめる */}
                        <div className="sticky top-0 z-20 shadow-md">
                            {/* 日付・曜日ヘッダー行 */}
                            <div className="flex border-b-2 border-slate-300 bg-slate-100">
                                <div className="sticky left-0 z-30 bg-slate-100 border-r-2 border-slate-300 shadow-md">
                                    <div className="w-20 lg:w-24 xl:w-32 h-8 flex items-center justify-center font-bold text-slate-700 text-xs tracking-wide">職長</div>
                                </div>
                                {weekDays.map((day, index) => {
                                    const dayOfWeekString = getDayOfWeekString(day.date, 'short');
                                    const dateString = formatDate(day.date, 'short');
                                    const isSaturday = day.dayOfWeek === 6;
                                    const isSunday = day.dayOfWeek === 0;
                                    const combinedDate = `${dateString}(${dayOfWeekString})`;

                                    return (
                                        <div key={index} className={`flex-1 min-w-[88px] lg:min-w-[100px] xl:min-w-[140px] border-r border-slate-300 h-8 flex flex-col items-center justify-center leading-none gap-0.5 ${isSaturday ? 'bg-blue-50' : isSunday ? 'bg-rose-50' : 'bg-slate-100'} ${day.isToday ? 'bg-teal-600' : ''}`}>
                                            <div className={`text-[11px] font-bold ${isSaturday ? 'text-slate-700' : isSunday ? 'text-slate-600' : 'text-slate-700'} ${day.isToday ? 'text-white' : ''}`}>{combinedDate}</div>
                                            {day.isToday && <span className="text-[8px] font-medium text-teal-100">今日</span>}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 未割り当て行 */}
                            {!hideRemarks && (
                            <div className="flex border-b-2 border-slate-400 bg-slate-100 h-9">
                                <div className="sticky left-0 z-30 bg-slate-100 border-r-2 border-slate-400 shadow-md">
                                    <div className="w-20 lg:w-24 xl:w-32 h-full flex items-center justify-center">
                                        <span className="text-[10px] lg:text-xs font-bold text-slate-700 tracking-wide truncate">残り人数</span>
                                    </div>
                                </div>
                                {weekDays.map((day, index) => {
                                    const dateKey = formatDateKey(day.date);
                                    const isSaturday = day.dayOfWeek === 6;
                                    const isSunday = day.dayOfWeek === 0;
                                    const dayEvents = events.filter(event => formatDateKey(event.startDate) === dateKey);
                                    // 職長ごとに最大人数を取り、未割当は単純加算（人数ソースは memberCount のみ）
                                    const byForeman = new Map<string, number[]>();
                                    let unassignedCount = 0;
                                    dayEvents.forEach(event => {
                                        const count = event.memberCount ?? 0;
                                        const key = event.assignedEmployeeId;
                                        if (!key || key === 'unassigned') {
                                            unassignedCount += count;
                                            return;
                                        }
                                        if (!byForeman.has(key)) byForeman.set(key, []);
                                        byForeman.get(key)!.push(count);
                                    });
                                    let assignedCount = unassignedCount;
                                    byForeman.forEach(counts => { assignedCount += Math.max(...counts); });
                                    const vacationCount = getVacationEmployees(dateKey).length;
                                    const adjustment = getMemberAdjustment ? getMemberAdjustment(dateKey) : 0;
                                    const totalCount = getTotalMembersForDate(dateKey) + adjustment;
                                    const remainingCount = totalCount - assignedCount - vacationCount;

                                    return (
                                        <div key={index} className={`flex-1 min-w-[88px] lg:min-w-[100px] xl:min-w-[140px] h-full border-r border-slate-100 p-1 flex items-center justify-center gap-1 ${isSaturday ? 'bg-slate-50/30' : isSunday ? 'bg-slate-50/30' : 'bg-white'}`}>
                                            {onMemberAdjustmentChange && (
                                                <button
                                                    onClick={() => onMemberAdjustmentChange(dateKey, -1)}
                                                    className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs font-bold leading-none"
                                                    title="人数を減らす"
                                                >
                                                    −
                                                </button>
                                            )}
                                            <span
                                                className={remainingCount === 0
                                                    ? 'inline-block px-1.5 py-0.5 text-xs font-bold text-emerald-600'
                                                    : remainingCount > 0
                                                    ? 'inline-block px-1.5 py-0.5 text-xs font-bold text-blue-600'
                                                    : 'inline-block px-1.5 py-0.5 text-xs font-bold text-red-600'}
                                                title={remainingCount < 0 ? `${Math.abs(remainingCount)}人の人手不足（過剰アサイン）` : remainingCount === 0 ? '過不足なし（ちょうど充足）' : undefined}
                                            >
                                                {remainingCount}人<span className="opacity-70">/{totalCount}人</span>
                                            </span>
                                            {onMemberAdjustmentChange && (
                                                <button
                                                    onClick={() => onMemberAdjustmentChange(dateKey, 1)}
                                                    className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs font-bold leading-none"
                                                    title="人数を増やす"
                                                >
                                                    +
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            )}
                            {!hideRemarks && <RemarksRow weekDays={weekDays} readOnly={isReadOnly} />}
                        </div>

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
                                    movingEventId={movingEvent?.id ?? null}
                                    onLongPressEvent={handleMoveToCell ? startMoving : undefined}
                                    onCommitMove={movingEvent ? commitMove : undefined}
                                    onCancelMove={cancelMoving}
                                    highlightedEventId={highlightedEventId}
                                />
                            ))}
                        </div>

                        {!hideForemanSelector && (
                            <div className="flex border-t-2 border-slate-300 bg-slate-50 p-4">
                                <ForemanSelector />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <DragOverlay>
                {activeEvent ? <div className="opacity-90"><DraggableEventCard event={activeEvent} /></div> : null}
            </DragOverlay>

            {/* 保存中オーバーレイ */}
            {isSaving && (
                <div className="fixed inset-0 lg:left-48 z-[55] flex items-center justify-center bg-black/30 pointer-events-none">
                    <div className="bg-white rounded-lg px-6 py-4 shadow-xl flex items-center gap-3 pointer-events-auto">
                        <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium text-slate-700">案件を保存中...</span>
                    </div>
                </div>
            )}
        </DndContext>
    );
}
