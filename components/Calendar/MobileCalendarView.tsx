'use client';

import React, { useState, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Users, ClipboardCheck, CheckCircle, Copy, Edit3, Plus, MoveRight, X } from 'lucide-react';
import { CalendarEvent, EmployeeRow, Project, WeekDay, EditingUser } from '@/types/calendar';
import { formatDateKey, getEventsForDate } from '@/utils/employeeUtils';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';

interface MobileCalendarViewProps {
    weekDays: WeekDay[];
    events: CalendarEvent[];
    employeeRows: EmployeeRow[];
    projects: Project[];
    isReadOnly: boolean;
    canDispatch: boolean;
    isSaving: boolean;
    totalMembers: number;
    getVacationEmployees: (dateKey: string) => string[];
    getEditingUsers: (assignmentId: string) => EditingUser[];
    // Navigation
    goToPreviousWeek: () => void;
    goToNextWeek: () => void;
    goToToday: () => void;
    // Event handlers
    handleEventClick: (eventId: string) => void;
    handleCellClick?: (employeeId: string, date: Date) => void;
    handleMoveEvent?: (eventId: string, direction: 'up' | 'down') => void;
    handleOpenDispatchModal?: (projectId: string) => void;
    handleCopyEvent?: (eventId: string) => void;
    handleMoveToCell?: (eventId: string, employeeId: string, date: Date) => void;
}

interface ActionSheetState {
    isOpen: boolean;
    event: CalendarEvent | null;
    project: Project | null;
}

const LABEL_W = 64;   // 職長名列の幅（px）
const COL_W = 90;     // 日付列の幅（px）
const LONG_PRESS_MS = 500; // 長押し判定時間（ms）

export default function MobileCalendarView({
    weekDays,
    events,
    employeeRows,
    projects,
    isReadOnly,
    canDispatch,
    isSaving,
    totalMembers,
    getVacationEmployees,
    getEditingUsers,
    goToPreviousWeek,
    goToNextWeek,
    goToToday,
    handleEventClick,
    handleCellClick,
    handleMoveEvent: _handleMoveEvent,
    handleOpenDispatchModal,
    handleCopyEvent,
    handleMoveToCell,
}: MobileCalendarViewProps) {
    const todayKey = formatDateKey(new Date());

    // ── アクションシート ──
    const [actionSheet, setActionSheet] = useState<ActionSheetState>({
        isOpen: false, event: null, project: null,
    });

    const openActionSheet = useCallback((event: CalendarEvent) => {
        const projectId = event.id.replace(/-assembly$|-demolition$/, '');
        const project = projects.find(p => p.id === projectId) || null;
        setActionSheet({ isOpen: true, event, project });
    }, [projects]);

    const closeActionSheet = useCallback(() => {
        setActionSheet({ isOpen: false, event: null, project: null });
    }, []);

    // ── 移動モード ──
    const [movingEvent, setMovingEvent] = useState<CalendarEvent | null>(null);

    const cancelMoving = useCallback(() => setMovingEvent(null), []);

    const commitMove = useCallback((employeeId: string, date: Date) => {
        if (!movingEvent || !handleMoveToCell) return;
        handleMoveToCell(movingEvent.id, employeeId, date);
        setMovingEvent(null);
    }, [movingEvent, handleMoveToCell]);

    // ── スクロール vs タップ判定 ──
    const touchMoved = useRef(false);
    const touchStart = useRef({ x: 0, y: 0 });

    // ── 長押しタイマー ──
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const onScrollAreaTouchStart = useCallback((e: React.TouchEvent) => {
        touchMoved.current = false;
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, []);

    const onScrollAreaTouchMove = useCallback((e: React.TouchEvent) => {
        const dx = Math.abs(e.touches[0].clientX - touchStart.current.x);
        const dy = Math.abs(e.touches[0].clientY - touchStart.current.y);
        if (dx > 6 || dy > 6) {
            touchMoved.current = true;
            if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
        }
    }, []);

    const onCardTouchStart = useCallback((event: CalendarEvent) => {
        if (isReadOnly || !handleMoveToCell) return;
        longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            if (touchMoved.current) return; // スクロール中なら無視
            navigator.vibrate?.(60);
            touchMoved.current = true; // 長押し確定後はタップ判定させない
            setMovingEvent(event);
        }, LONG_PRESS_MS);
    }, [isReadOnly, handleMoveToCell]);

    const onCardTouchEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    // ── ラベル ──
    const weekLabel = weekDays.length > 0
        ? `${formatDate(weekDays[0].date, 'short')}〜${formatDate(weekDays[weekDays.length - 1].date, 'short')}`
        : '';

    const totalGridWidth = LABEL_W + COL_W * weekDays.length;

    return (
        <div className="h-full flex flex-col bg-white overflow-hidden">

            {/* ── 週ナビゲーション ── */}
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between">
                    <button
                        onClick={goToPreviousWeek}
                        className="p-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5 text-slate-600" />
                    </button>
                    <button
                        onClick={goToToday}
                        className="text-sm font-bold text-slate-800 px-3 py-1 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        {weekLabel}
                    </button>
                    <button
                        onClick={goToNextWeek}
                        className="p-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        <ChevronRight className="w-5 h-5 text-slate-600" />
                    </button>
                </div>
            </div>

            {/* ── 移動モードバナー ── */}
            {movingEvent && (
                <div className="flex-shrink-0 bg-blue-600 text-white px-3 py-2 flex items-center gap-2">
                    <MoveRight className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold truncate block">「{movingEvent.title}」を移動中</span>
                        <span className="text-[10px] text-blue-200">移動先のセルをタップ</span>
                    </div>
                    <button
                        onClick={cancelMoving}
                        className="flex items-center gap-1 bg-blue-500 hover:bg-blue-400 active:bg-blue-700 rounded-lg px-2.5 py-1.5 flex-shrink-0 transition-colors"
                    >
                        <X className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">キャンセル</span>
                    </button>
                </div>
            )}

            {/* ── グリッド本体（縦横スクロール） ── */}
            <div
                className="flex-1 overflow-auto"
                onTouchStart={onScrollAreaTouchStart}
                onTouchMove={onScrollAreaTouchMove}
            >
                <div style={{ minWidth: totalGridWidth }}>

                    {/* 日付ヘッダー行（sticky top） */}
                    <div className="flex sticky top-0 z-20 border-b-2 border-slate-300 shadow-sm" style={{ height: 40 }}>
                        <div
                            className="sticky left-0 z-30 bg-gradient-to-r from-slate-100 to-slate-50 border-r-2 border-slate-300 flex items-center justify-center flex-shrink-0"
                            style={{ width: LABEL_W }}
                        >
                            <span className="text-[10px] font-bold text-slate-600 tracking-wide">職長</span>
                        </div>
                        {weekDays.map((day) => {
                            const dateKey = formatDateKey(day.date);
                            const isToday = dateKey === todayKey;
                            const isSat = day.dayOfWeek === 6;
                            const isSun = day.dayOfWeek === 0;
                            return (
                                <div
                                    key={dateKey}
                                    className={`flex-shrink-0 border-r border-slate-200 flex flex-col items-center justify-center ${
                                        isToday ? 'bg-gradient-to-b from-slate-700 to-slate-600'
                                        : isSat ? 'bg-gradient-to-b from-blue-100 to-blue-50'
                                        : isSun ? 'bg-gradient-to-b from-rose-100 to-rose-50'
                                        : 'bg-gradient-to-b from-slate-100 to-slate-50'
                                    }`}
                                    style={{ width: COL_W }}
                                >
                                    <span className={`text-[11px] font-bold ${
                                        isToday ? 'text-white' : isSat ? 'text-blue-700' : isSun ? 'text-rose-700' : 'text-slate-700'
                                    }`}>
                                        {formatDate(day.date, 'short')}({getDayOfWeekString(day.date, 'short')})
                                    </span>
                                    {isToday && <span className="text-[8px] text-slate-300">今日</span>}
                                </div>
                            );
                        })}
                    </div>

                    {/* 空き人数行（sticky: ヘッダー直下） */}
                    <div
                        className="flex sticky top-[40px] z-[15] border-b-2 border-slate-300 bg-gradient-to-r from-slate-100 to-slate-50 shadow-sm"
                        style={{ height: 28 }}
                    >
                        <div
                            className="sticky left-0 z-20 bg-gradient-to-r from-slate-100 to-slate-50 border-r-2 border-slate-300 flex items-center justify-center flex-shrink-0"
                            style={{ width: LABEL_W }}
                        >
                            <span className="text-[9px] font-bold text-slate-500">空き</span>
                        </div>
                        {weekDays.map((day) => {
                            const dateKey = formatDateKey(day.date);
                            const isSat = day.dayOfWeek === 6;
                            const isSun = day.dayOfWeek === 0;
                            const dayEvts = events.filter(e =>
                                formatDateKey(e.startDate) === dateKey && e.assignedEmployeeId !== 'unassigned'
                            );
                            const byForeman = new Map<string, number[]>();
                            dayEvts.forEach(e => {
                                const key = e.assignedEmployeeId!;
                                if (!byForeman.has(key)) byForeman.set(key, []);
                                byForeman.get(key)!.push(e.workers?.length || e.memberCount || 0);
                            });
                            let assignedCount = 0;
                            byForeman.forEach(counts => { assignedCount += Math.max(...counts); });
                            const vacationCount = getVacationEmployees(dateKey).length;
                            const remaining = totalMembers - assignedCount - vacationCount;
                            return (
                                <div
                                    key={dateKey}
                                    className={`flex-shrink-0 border-r border-slate-200 flex items-center justify-center ${
                                        isSat ? 'bg-blue-50/30' : isSun ? 'bg-rose-50/30' : ''
                                    }`}
                                    style={{ width: COL_W }}
                                >
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white ${
                                        remaining > 0 ? 'bg-slate-500' : remaining === 0 ? 'bg-slate-400' : 'bg-slate-700'
                                    }`}>
                                        {remaining}人
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* 職長行 */}
                    {employeeRows.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 text-sm">表示する職長がいません</div>
                    ) : (
                        employeeRows.map((row) => (
                            <div
                                key={`${row.employeeId}-${row.rowIndex}`}
                                className="flex border-b border-slate-200 min-h-[80px]"
                            >
                                {/* 職長名（左固定） */}
                                <div
                                    className="sticky left-0 z-10 bg-white border-r-2 border-slate-200 flex items-center justify-center px-1 flex-shrink-0 shadow-sm"
                                    style={{ width: LABEL_W }}
                                >
                                    <span className="text-[10px] font-semibold text-slate-700 text-center leading-tight break-all">
                                        {row.employeeName}
                                    </span>
                                </div>

                                {/* 各日セル */}
                                {weekDays.map((day) => {
                                    const dateKey = formatDateKey(day.date);
                                    const isToday = dateKey === todayKey;
                                    const isSat = day.dayOfWeek === 6;
                                    const isSun = day.dayOfWeek === 0;
                                    const cellEvents = getEventsForDate(row, day.date);
                                    const isEmpty = cellEvents.length === 0;
                                    const isMovingSource = movingEvent
                                        ? cellEvents.some(e => e.id === movingEvent.id)
                                        : false;

                                    return (
                                        <div
                                            key={dateKey}
                                            onClick={() => {
                                                if (touchMoved.current) return;
                                                if (movingEvent) {
                                                    commitMove(row.employeeId, day.date);
                                                    return;
                                                }
                                                if (!isReadOnly && isEmpty) {
                                                    handleCellClick?.(row.employeeId, day.date);
                                                }
                                            }}
                                            className={`flex-shrink-0 border-r border-slate-200 p-1 transition-colors ${
                                                isMovingSource
                                                    ? 'bg-blue-100/60 ring-2 ring-inset ring-blue-400'
                                                    : movingEvent
                                                    ? 'cursor-pointer bg-blue-50/30 hover:bg-blue-100/50 active:bg-blue-200/50'
                                                    : isToday ? 'bg-blue-50/20'
                                                    : isSat ? 'bg-blue-50/10'
                                                    : isSun ? 'bg-rose-50/10'
                                                    : ''
                                            } ${!isReadOnly && isEmpty && !movingEvent ? 'cursor-pointer hover:bg-slate-50 active:bg-slate-100' : ''}`}
                                            style={{ width: COL_W }}
                                        >
                                            {isEmpty ? (
                                                movingEvent ? (
                                                    // 移動モード: 空きセルは移動先候補として点線丸を表示
                                                    <div className="h-full min-h-[72px] flex items-center justify-center pointer-events-none">
                                                        <div className="w-8 h-8 rounded-full border-2 border-dashed border-blue-400 flex items-center justify-center">
                                                            <Plus className="w-4 h-4 text-blue-400" />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    !isReadOnly && (
                                                        <div className="h-full min-h-[72px] flex items-center justify-center pointer-events-none">
                                                            <Plus className="w-4 h-4 text-slate-200" />
                                                        </div>
                                                    )
                                                )
                                            ) : (
                                                <div className="space-y-1 py-0.5">
                                                    {cellEvents.map((event) => {
                                                        const projectId = event.id.replace(/-assembly$|-demolition$/, '');
                                                        const editingUsers = getEditingUsers(projectId);
                                                        const project = projects.find(p => p.id === projectId);
                                                        const isThisMoving = movingEvent?.id === event.id;

                                                        return (
                                                            <button
                                                                key={event.id}
                                                                onTouchStart={() => onCardTouchStart(event)}
                                                                onTouchEnd={onCardTouchEnd}
                                                                onTouchCancel={onCardTouchEnd}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (touchMoved.current) return;
                                                                    if (movingEvent) {
                                                                        // 移動元と同じカードをタップ → キャンセル
                                                                        if (isThisMoving) {
                                                                            cancelMoving();
                                                                        } else {
                                                                            // 別カードのあるセルをタップ → そこに移動
                                                                            commitMove(row.employeeId, day.date);
                                                                        }
                                                                        return;
                                                                    }
                                                                    openActionSheet(event);
                                                                }}
                                                                className={`w-full text-left rounded p-1 transition-all relative select-none ${
                                                                    isThisMoving
                                                                        ? 'ring-2 ring-white ring-offset-1 ring-offset-blue-400 opacity-70 scale-95'
                                                                        : 'active:brightness-90'
                                                                }`}
                                                                style={{ backgroundColor: event.color }}
                                                            >
                                                                {editingUsers.length > 0 && (
                                                                    <Edit3 className="absolute top-0.5 right-0.5 w-2.5 h-2.5 text-amber-700 animate-pulse" />
                                                                )}
                                                                {!editingUsers.length && project?.isDispatchConfirmed && (
                                                                    <CheckCircle className="absolute top-0.5 right-0.5 w-2.5 h-2.5 text-green-700" />
                                                                )}
                                                                <div className="text-[10px] font-bold text-gray-800 leading-tight truncate pr-3">
                                                                    {event.title}
                                                                </div>
                                                                {event.customer && (
                                                                    <div className="text-[9px] text-gray-600 leading-tight truncate">
                                                                        {event.customer}
                                                                    </div>
                                                                )}
                                                                {(event.workers && event.workers.length > 0 || event.estimatedHours != null) && (
                                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                                        {event.workers && event.workers.length > 0 && (
                                                                            <span className="flex items-center gap-0.5">
                                                                                <Users className="w-2.5 h-2.5 text-gray-500" />
                                                                                <span className="text-[9px] text-gray-600">{event.workers.length}人</span>
                                                                            </span>
                                                                        )}
                                                                        {event.estimatedHours != null && (
                                                                            <span className="text-[9px] text-gray-600">{event.estimatedHours}h</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </button>
                                                        );
                                                    })}

                                                    {/* 移動モード中: 既存イベントがあるセルにも追加できるよう点線ボタン */}
                                                    {movingEvent && !isMovingSource && (
                                                        <div className="pointer-events-none flex items-center justify-center py-1 border border-dashed border-blue-400 text-blue-400 rounded">
                                                            <Plus className="w-3 h-3" />
                                                        </div>
                                                    )}

                                                    {/* 通常モード: 追加ボタン */}
                                                    {!isReadOnly && !movingEvent && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!touchMoved.current) handleCellClick?.(row.employeeId, day.date);
                                                            }}
                                                            className="w-full flex items-center justify-center py-0.5 text-slate-300 hover:text-slate-400 hover:bg-slate-50 rounded transition-colors"
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── アクションシート ── */}
            {actionSheet.isOpen && actionSheet.event && (
                <>
                    <div className="fixed inset-0 bg-black/40 z-40" onClick={closeActionSheet} />
                    <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 animate-slide-up safe-area-bottom">
                        <div className="flex justify-center pt-3 pb-2">
                            <div className="w-10 h-1 bg-slate-300 rounded-full" />
                        </div>

                        <div className="px-4 pb-3 border-b border-slate-100">
                            <div className="flex items-start gap-3">
                                <div
                                    className="w-3 min-h-[40px] rounded-full flex-shrink-0 mt-0.5"
                                    style={{ backgroundColor: actionSheet.event.color }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-800 text-base">{actionSheet.event.title}</div>
                                    {actionSheet.event.customer && (
                                        <div className="text-slate-500 text-sm mt-0.5">{actionSheet.event.customer}</div>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-slate-500 text-xs">
                                        {actionSheet.event.workers && actionSheet.event.workers.length > 0 && (
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3 h-3" />{actionSheet.event.workers.length}人
                                            </span>
                                        )}
                                        {actionSheet.event.estimatedHours != null && (
                                            <span>{actionSheet.event.estimatedHours}h</span>
                                        )}
                                        {actionSheet.event.remarks && (
                                            <span className="truncate">{actionSheet.event.remarks}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-2">
                            <button
                                onClick={() => { closeActionSheet(); handleEventClick(actionSheet.event!.id); }}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                            >
                                <Edit3 className="w-5 h-5 text-slate-500" />
                                詳細を見る・編集
                            </button>

                            {!isReadOnly && handleMoveToCell && (
                                <button
                                    onClick={() => {
                                        const ev = actionSheet.event!;
                                        closeActionSheet();
                                        setMovingEvent(ev);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <MoveRight className="w-5 h-5 text-slate-500" />
                                    別の日・職長に移動
                                </button>
                            )}

                            {!isReadOnly && handleCopyEvent && (
                                <button
                                    onClick={() => { closeActionSheet(); handleCopyEvent(actionSheet.event!.id); }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <Copy className="w-5 h-5 text-slate-500" />
                                    別の日・職長にコピー
                                </button>
                            )}

                            {!isReadOnly && canDispatch && handleOpenDispatchModal && (
                                <button
                                    onClick={() => {
                                        closeActionSheet();
                                        const projectId = actionSheet.event!.id.replace(/-assembly$|-demolition$/, '');
                                        handleOpenDispatchModal(projectId);
                                    }}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm rounded-lg transition-colors ${
                                        actionSheet.project?.isDispatchConfirmed
                                            ? 'text-green-700 hover:bg-green-50'
                                            : 'text-slate-700 hover:bg-slate-50 active:bg-slate-100'
                                    }`}
                                >
                                    {actionSheet.project?.isDispatchConfirmed ? (
                                        <><CheckCircle className="w-5 h-5 text-green-500" />手配確定済み</>
                                    ) : (
                                        <><ClipboardCheck className="w-5 h-5 text-slate-500" />手配確定する</>
                                    )}
                                </button>
                            )}

                            <button
                                onClick={closeActionSheet}
                                className="w-full mt-1 py-3 text-center text-sm text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                            >
                                閉じる
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* 保存中オーバーレイ */}
            {isSaving && (
                <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 pointer-events-none">
                    <div className="bg-white rounded-lg px-6 py-4 shadow-xl flex items-center gap-3 pointer-events-auto">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium text-gray-700">保存中...</span>
                    </div>
                </div>
            )}
        </div>
    );
}
