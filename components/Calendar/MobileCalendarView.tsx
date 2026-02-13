'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Users, ClipboardCheck, CheckCircle, Copy, Edit3 } from 'lucide-react';
import { CalendarEvent, EmployeeRow, Project, WeekDay, EditingUser } from '@/types/calendar';
import { formatDateKey, getEventsForDate } from '@/utils/employeeUtils';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import WeekOverviewBar from './WeekOverviewBar';

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
}

interface ActionSheetState {
    isOpen: boolean;
    event: CalendarEvent | null;
    project: Project | null;
}

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
}: MobileCalendarViewProps) {
    // 選択中の日付（初期値は今日、なければ週の最初の日）
    const todayKey = formatDateKey(new Date());
    const initialDateKey = weekDays.find(d => formatDateKey(d.date) === todayKey)
        ? todayKey
        : formatDateKey(weekDays[0]?.date || new Date());
    const [selectedDateKey, setSelectedDateKey] = useState(initialDateKey);

    // 週が変わったら選択日をリセット
    useEffect(() => {
        const weekDateKeys = weekDays.map(d => formatDateKey(d.date));
        if (!weekDateKeys.includes(selectedDateKey)) {
            const today = formatDateKey(new Date());
            setSelectedDateKey(weekDateKeys.includes(today) ? today : weekDateKeys[0] || today);
        }
    }, [weekDays, selectedDateKey]);

    // アクションシート
    const [actionSheet, setActionSheet] = useState<ActionSheetState>({
        isOpen: false, event: null, project: null
    });

    const selectedDay = useMemo(
        () => weekDays.find(d => formatDateKey(d.date) === selectedDateKey),
        [weekDays, selectedDateKey]
    );

    // 選択日の前日/翌日に移動
    const goToPreviousDay = useCallback(() => {
        const currentIndex = weekDays.findIndex(d => formatDateKey(d.date) === selectedDateKey);
        if (currentIndex > 0) {
            setSelectedDateKey(formatDateKey(weekDays[currentIndex - 1].date));
        } else {
            goToPreviousWeek();
        }
    }, [weekDays, selectedDateKey, goToPreviousWeek]);

    const goToNextDay = useCallback(() => {
        const currentIndex = weekDays.findIndex(d => formatDateKey(d.date) === selectedDateKey);
        if (currentIndex < weekDays.length - 1) {
            setSelectedDateKey(formatDateKey(weekDays[currentIndex + 1].date));
        } else {
            goToNextWeek();
        }
    }, [weekDays, selectedDateKey, goToNextWeek]);

    // カードタップでアクションシート
    const handleCardTap = useCallback((event: CalendarEvent) => {
        const projectId = event.id.replace(/-assembly$|-demolition$/, '');
        const project = projects.find(p => p.id === projectId) || null;
        setActionSheet({ isOpen: true, event, project });
    }, [projects]);

    const closeActionSheet = useCallback(() => {
        setActionSheet({ isOpen: false, event: null, project: null });
    }, []);

    // 選択日の表示テキスト
    const dateLabel = selectedDay
        ? `${formatDate(selectedDay.date, 'short')}（${getDayOfWeekString(selectedDay.date, 'short')}）`
        : '';
    const isSelectedToday = selectedDateKey === todayKey;
    const isSaturday = selectedDay?.dayOfWeek === 6;
    const isSunday = selectedDay?.dayOfWeek === 0;

    // 選択日の案件数
    const selectedDayEventCount = events.filter(e => formatDateKey(e.startDate) === selectedDateKey).length;

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* ヘッダー: 週ナビゲーション */}
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
                        {weekDays.length > 0 && (
                            <>
                                {formatDate(weekDays[0].date, 'short')}〜{formatDate(weekDays[weekDays.length - 1].date, 'short')}
                            </>
                        )}
                    </button>

                    <button
                        onClick={goToNextWeek}
                        className="p-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        <ChevronRight className="w-5 h-5 text-slate-600" />
                    </button>
                </div>
            </div>

            {/* 週俯瞰バー（sticky） */}
            <div className="flex-shrink-0 sticky top-0 z-20">
                <WeekOverviewBar
                    weekDays={weekDays}
                    events={events}
                    selectedDateKey={selectedDateKey}
                    totalMembers={totalMembers}
                    getVacationEmployees={getVacationEmployees}
                    onSelectDay={setSelectedDateKey}
                />
            </div>

            {/* 選択日ヘッダー */}
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className={`text-base font-bold ${
                        isSunday ? 'text-red-600' :
                        isSaturday ? 'text-blue-600' :
                        'text-slate-800'
                    }`}>
                        {dateLabel}
                    </span>
                    {isSelectedToday && (
                        <span className="text-[10px] text-white bg-blue-500 px-1.5 py-0.5 rounded-full font-bold">
                            今日
                        </span>
                    )}
                </div>
                <span className="text-xs text-slate-500 font-medium">
                    {selectedDayEventCount}件の予定
                </span>
            </div>

            {/* 職長ごとの案件リスト */}
            <div className="flex-1 overflow-auto pb-20">
                <div className="p-3 space-y-3">
                    {employeeRows.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            表示する職長がいません
                        </div>
                    ) : (
                        employeeRows.map(row => {
                            const dayEvents = selectedDay
                                ? getEventsForDate(row, selectedDay.date)
                                : [];

                            return (
                                <div
                                    key={`${row.employeeId}-${row.rowIndex}`}
                                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
                                >
                                    {/* 職長名ヘッダー */}
                                    <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-3 py-2 flex items-center justify-between">
                                        <h3 className="text-white font-bold text-sm">
                                            {row.employeeName}
                                        </h3>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-300 text-xs">
                                                {dayEvents.reduce((sum, e) => sum + (e.estimatedHours ?? 8), 0)}h
                                            </span>
                                            <span className="text-slate-400 text-[10px]">
                                                ({dayEvents.length}件)
                                            </span>
                                        </div>
                                    </div>

                                    {/* イベントリスト */}
                                    <div className="p-2">
                                        {dayEvents.length === 0 ? (
                                            <button
                                                onClick={() => selectedDay && handleCellClick?.(row.employeeId, selectedDay.date)}
                                                className="w-full text-center py-4 text-sm text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                                disabled={isReadOnly}
                                            >
                                                {isReadOnly ? '予定なし' : '＋ タップして追加'}
                                            </button>
                                        ) : (
                                            <div className="space-y-2">
                                                {dayEvents.map((event) => {
                                                    const projectId = event.id.replace(/-assembly$|-demolition$/, '');
                                                    const project = projects.find(p => p.id === projectId);
                                                    const editingUsers = getEditingUsers(projectId);

                                                    return (
                                                        <button
                                                            key={event.id}
                                                            onClick={() => handleCardTap(event)}
                                                            className="w-full text-left p-3 rounded-lg transition-all active:scale-[0.98] relative"
                                                            style={{ backgroundColor: event.color }}
                                                        >
                                                            {/* 編集中インジケーター */}
                                                            {editingUsers.length > 0 && (
                                                                <div className="absolute top-1 right-1 flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 rounded text-[10px] text-amber-800">
                                                                    <Edit3 className="w-3 h-3 animate-pulse" />
                                                                    <span>{editingUsers.map(u => u.name).join(', ')}</span>
                                                                </div>
                                                            )}

                                                            {/* 手配確定バッジ */}
                                                            {project?.isDispatchConfirmed && (
                                                                <div className="absolute top-1 right-1 bg-green-100 text-green-700 rounded px-1.5 py-0.5 text-[10px] font-bold flex items-center gap-0.5">
                                                                    <CheckCircle className="w-3 h-3" />
                                                                    確定済
                                                                </div>
                                                            )}

                                                            {/* 案件名 */}
                                                            <div className="font-bold text-gray-900 text-sm pr-14">
                                                                {event.title}
                                                            </div>

                                                            {/* 元請名 */}
                                                            {event.customer && (
                                                                <div className="text-gray-700 text-xs mt-1">
                                                                    {event.customer}
                                                                </div>
                                                            )}

                                                            {/* 人数 + 時間 + 備考 */}
                                                            <div className="flex items-center gap-3 mt-1.5">
                                                                {event.workers && event.workers.length > 0 && (
                                                                    <span className="text-gray-700 text-xs flex items-center gap-1">
                                                                        <Users className="w-3 h-3" />
                                                                        {event.workers.length}人
                                                                    </span>
                                                                )}
                                                                {event.estimatedHours != null && (
                                                                    <span className="text-gray-700 text-xs flex items-center gap-1">
                                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                        </svg>
                                                                        {event.estimatedHours}h
                                                                    </span>
                                                                )}
                                                                {event.remarks && (
                                                                    <span className="text-gray-600 text-xs truncate">
                                                                        {event.remarks}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </button>
                                                    );
                                                })}

                                                {/* 職長セルへの追加ボタン */}
                                                {!isReadOnly && (
                                                    <button
                                                        onClick={() => selectedDay && handleCellClick?.(row.employeeId, selectedDay.date)}
                                                        className="w-full text-center py-2 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors border border-dashed border-slate-200"
                                                    >
                                                        ＋ 追加
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* 下部フローティング日付ナビ */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-30 px-4 py-2 flex items-center justify-between safe-area-bottom">
                <button
                    onClick={goToPreviousDay}
                    className="flex items-center gap-1 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-200 rounded-lg transition-colors"
                >
                    <ChevronLeft className="w-4 h-4" />
                    前日
                </button>

                <span className={`text-sm font-bold ${
                    isSunday ? 'text-red-600' :
                    isSaturday ? 'text-blue-600' :
                    'text-slate-700'
                }`}>
                    {dateLabel}
                </span>

                <button
                    onClick={goToNextDay}
                    className="flex items-center gap-1 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-200 rounded-lg transition-colors"
                >
                    翌日
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            {/* フローティング追加ボタン */}
            {!isReadOnly && selectedDay && (
                <button
                    onClick={() => handleCellClick?.('unassigned', selectedDay.date)}
                    className="fixed bottom-16 right-4 w-12 h-12 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all z-30"
                >
                    <Plus className="w-6 h-6" />
                </button>
            )}

            {/* アクションシート */}
            {actionSheet.isOpen && actionSheet.event && (
                <>
                    {/* 背景オーバーレイ */}
                    <div
                        className="fixed inset-0 bg-black/40 z-40"
                        onClick={closeActionSheet}
                    />
                    {/* シート本体 */}
                    <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 animate-slide-up safe-area-bottom">
                        {/* ハンドル */}
                        <div className="flex justify-center pt-3 pb-2">
                            <div className="w-10 h-1 bg-slate-300 rounded-full" />
                        </div>

                        {/* 案件情報 */}
                        <div className="px-4 pb-3 border-b border-slate-100">
                            <div className="flex items-start gap-3">
                                <div
                                    className="w-3 h-full min-h-[40px] rounded-full flex-shrink-0 mt-0.5"
                                    style={{ backgroundColor: actionSheet.event.color }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-800 text-base">
                                        {actionSheet.event.title}
                                    </div>
                                    {actionSheet.event.customer && (
                                        <div className="text-slate-500 text-sm mt-0.5">
                                            {actionSheet.event.customer}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-slate-500 text-xs">
                                        {actionSheet.event.workers && actionSheet.event.workers.length > 0 && (
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3 h-3" />
                                                {actionSheet.event.workers.length}人
                                            </span>
                                        )}
                                        {actionSheet.event.estimatedHours != null && (
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                {actionSheet.event.estimatedHours}h
                                            </span>
                                        )}
                                        {actionSheet.event.remarks && (
                                            <span className="truncate">{actionSheet.event.remarks}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* アクションボタン */}
                        <div className="p-2">
                            {/* 編集 */}
                            <button
                                onClick={() => {
                                    closeActionSheet();
                                    handleEventClick(actionSheet.event!.id);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                            >
                                <Edit3 className="w-5 h-5 text-slate-500" />
                                詳細を見る・編集
                            </button>

                            {/* コピー */}
                            {!isReadOnly && handleCopyEvent && (
                                <button
                                    onClick={() => {
                                        closeActionSheet();
                                        handleCopyEvent(actionSheet.event!.id);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <Copy className="w-5 h-5 text-slate-500" />
                                    別の日・職長にコピー
                                </button>
                            )}

                            {/* 手配確定 */}
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
                                        <>
                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                            手配確定済み
                                        </>
                                    ) : (
                                        <>
                                            <ClipboardCheck className="w-5 h-5 text-slate-500" />
                                            手配確定する
                                        </>
                                    )}
                                </button>
                            )}

                            {/* 閉じる */}
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
