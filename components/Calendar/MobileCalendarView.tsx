'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowUpDown, Users, ClipboardCheck, CheckCircle, Copy, Edit3, Plus, MoveRight, X, Pencil, Check, MessageSquare, Search, Truck } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CalendarEvent, EmployeeRow, Project, WeekDay, EditingUser } from '@/types/calendar';
import { formatDateKey, getEventsForDate } from '@/utils/employeeUtils';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import { useVacation } from '@/hooks/useVacation';
import { useCalendarStore } from '@/stores/calendarStore';
import { useMasterStore, selectConstructionTypes, selectVehicles } from '@/stores/masterStore';
import { resolveEventVehicleNames } from './vehicleNames';
import VacationSelector from './VacationSelector';
import { TENTATIVE_STRIPE_BG, TentativeBadge } from './tentativeStyle';
import FloatingLane, { getFloatingSummaryForDate } from './FloatingLane';
import dynamic from 'next/dynamic';

const ProjectChatModal = dynamic(() => import('@/components/Chat/ProjectChatModal'), { ssr: false });

interface MobileCalendarViewProps {
    weekDays: WeekDay[];
    events: CalendarEvent[];
    employeeRows: EmployeeRow[];
    projects: Project[];
    isReadOnly: boolean;
    canDispatch: boolean;
    isSaving: boolean;
    getTotalMembersForDate: (dateStr: string) => number;
    getVacationEmployees: (dateKey: string) => string[];
    getEditingUsers: (assignmentId: string) => EditingUser[];
    // Navigation
    goToPreviousWeek: () => void;
    goToNextWeek: () => void;
    goToPreviousDay: () => void;
    goToNextDay: () => void;
    goToToday: () => void;
    /** 週送り/日送りの可否（協力会社モードの閲覧範囲制限）。false でボタンを無効表示にする */
    canGoPrevWeek?: boolean;
    canGoNextWeek?: boolean;
    canGoPrevDay?: boolean;
    canGoNextDay?: boolean;
    // Event handlers
    handleEventClick: (eventId: string) => void;
    handleCellClick?: (employeeId: string, date: Date) => void;
    handleMoveEvent?: (eventId: string, direction: 'up' | 'down') => void;
    handleOpenDispatchModal?: (projectId: string) => void;
    handleCopyEvent?: (eventId: string) => void;
    handleMoveToCell?: (event: CalendarEvent, employeeId: string, date: Date) => void;
    handleOpenSearch?: () => void;
    highlightedEventId?: string | null;
    getMemberAdjustment?: (dateKey: string) => number;
    onMemberAdjustmentChange?: (dateKey: string, delta: number) => void;
    hideRemarks?: boolean;
    // 浮き（班未定）レーン・降格
    handleFloatingEventClick?: (eventId: string) => void;
    handleFloatingCellClick?: (date: Date) => void;
    /**
     * 浮きレーンをこの職長行の直前に挟む。null/未指定なら職長行の一番下。
     * 位置はPCの▲▼で決めた全社共通の設定（lib/floatingLaneOrder.ts）を共有する。
     */
    floatingLaneAnchorId?: string | null;
    /**
     * 浮き（班未定）を一切見せない。kei指示（2026-07-21）で管理者・マネージャー限定にしたため、
     * レーン本体と日付ヘッダーの赤バッジをまとめて隠す。判定は WeeklyCalendar 側。
     */
    hideFloatingLane?: boolean;
}

interface ActionSheetState {
    isOpen: boolean;
    event: CalendarEvent | null;
    project: Project | null;
}

const LABEL_W_NORMAL = 64;   // 職長名列の幅（px）
const COL_W_NORMAL = 90;     // 日付列の幅（px）
const LABEL_W_LANDSCAPE = 52;
const COL_W_LANDSCAPE = 80;
const LONG_PRESS_MS = 500; // 長押し判定時間（ms）

interface MobileForemanRowProps {
    row: EmployeeRow;
    weekDays: WeekDay[];
    todayKey: string;
    isLandscape: boolean | null; // useMediaQuery の戻り値。null は falsy として従来どおり縦向き扱い
    colW: number;
    labelW: number;
    // movingEvent はオブジェクトではなくIDだけ渡す（参照変化での無駄な再レンダー防止）
    movingEventId: string | null;
    touchMovedRef: React.MutableRefObject<boolean>;
    isReadOnly: boolean;
    cellRemarks: Record<string, string>;
    projects: Project[];
    vehicleMaster: ReturnType<typeof selectVehicles>;
    highlightedEventId: string | null;
    getEditingUsers: (assignmentId: string) => EditingUser[];
    handleCellClick?: (employeeId: string, date: Date) => void;
    commitMove: (employeeId: string, date: Date) => void;
    cancelMoving: () => void;
    openActionSheet: (event: CalendarEvent) => void;
    startEditCellMemo: (foremanId: string, dateKey: string) => void;
    onCardTouchStart: (event: CalendarEvent, employeeId: string, date: Date, cellCount: number) => void;
    onCardTouchEnd: () => void;
}

// 職長行を React.memo で切り出す。ストア更新や親 state 変化で本体が再レンダーされても、
// props が不変な行の再構築（約105セル＋100超カード）をスキップする（発熱対策）。
const MobileForemanRow = React.memo(function MobileForemanRow({
    row,
    weekDays,
    todayKey,
    isLandscape,
    colW,
    labelW,
    movingEventId,
    touchMovedRef,
    isReadOnly,
    cellRemarks,
    projects,
    vehicleMaster,
    highlightedEventId,
    getEditingUsers,
    handleCellClick,
    commitMove,
    cancelMoving,
    openActionSheet,
    startEditCellMemo,
    onCardTouchStart,
    onCardTouchEnd,
}: MobileForemanRowProps) {
    return (
                            <div
                                className={`flex border-b border-slate-200 ${isLandscape ? 'min-h-[52px]' : 'min-h-[80px]'}`}
                            >
                                {/* 職長名（左固定） */}
                                <div
                                    className="sticky left-0 z-10 bg-white border-r-2 border-slate-200 flex items-center justify-center px-1 flex-shrink-0 shadow-sm"
                                    style={{ width: labelW }}
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
                                    const isMovingSource = movingEventId !== null
                                        ? cellEvents.some(e => e.id === movingEventId)
                                        : false;

                                    return (
                                        <div
                                            key={dateKey}
                                            onClick={() => {
                                                if (touchMovedRef.current) return;
                                                if (movingEventId !== null) {
                                                    commitMove(row.employeeId, day.date);
                                                    return;
                                                }
                                                if (!isReadOnly && isEmpty) {
                                                    handleCellClick?.(row.employeeId, day.date);
                                                }
                                            }}
                                            className={`grow flex-shrink-0 border-r border-slate-200 p-1 transition-colors ${
                                                isMovingSource
                                                    ? 'bg-slate-100/60 ring-2 ring-inset ring-slate-400'
                                                    : movingEventId !== null
                                                    ? 'cursor-pointer bg-slate-50/30 hover:bg-slate-100/50 active:bg-slate-200/50'
                                                    : isToday ? 'bg-slate-50/20'
                                                    : isSat ? 'bg-slate-50/10'
                                                    : isSun ? 'bg-slate-50/10'
                                                    : ''
                                            } ${!isReadOnly && isEmpty && movingEventId === null ? 'cursor-pointer hover:bg-slate-50 active:bg-slate-100' : ''}`}
                                            style={{ width: colW }}
                                        >
                                            {isEmpty ? (
                                                <div className={`flex flex-col h-full ${isLandscape ? 'min-h-[44px]' : 'min-h-[72px]'}`}>
                                                    <div className="flex-1 flex items-center justify-center pointer-events-none">
                                                        {movingEventId !== null ? (
                                                            <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-400 flex items-center justify-center">
                                                                <Plus className="w-4 h-4 text-slate-400" />
                                                            </div>
                                                        ) : !isReadOnly ? (
                                                            <Plus className="w-4 h-4 text-slate-200" />
                                                        ) : null}
                                                    </div>
                                                    {/* 空セルのメモ */}
                                                    {(() => {
                                                        const memo = cellRemarks[`${row.employeeId}-${dateKey}`] || '';
                                                        return memo ? (
                                                            <div
                                                                onClick={(e) => { e.stopPropagation(); startEditCellMemo(row.employeeId, dateKey); }}
                                                                className="w-full text-[8px] px-1 py-0.5 rounded bg-amber-50 text-slate-700 border-l-2 border-amber-400 mt-auto whitespace-pre-wrap break-words leading-tight"
                                                            >
                                                                {memo}
                                                            </div>
                                                        ) : !isReadOnly && movingEventId === null ? (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); startEditCellMemo(row.employeeId, dateKey); }}
                                                                className="w-full flex items-center justify-center py-0.5 text-slate-200 hover:text-slate-400 transition-colors mt-auto"
                                                            >
                                                                <Pencil className="w-2.5 h-2.5" />
                                                            </button>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            ) : (
                                                <div className="space-y-1 py-0.5">
                                                    {cellEvents.map((event) => {
                                                        const projectId = event.id.replace(/-assembly$|-demolition$/, '');
                                                        const editingUsers = getEditingUsers(projectId);
                                                        const project = projects.find(p => p.id === projectId);
                                                        const isThisMoving = movingEventId === event.id;

                                                        return (
                                                            <button
                                                                key={event.id}
                                                                data-project-id={projectId}
                                                                onTouchStart={() => onCardTouchStart(event, row.employeeId, day.date, cellEvents.length)}
                                                                onTouchEnd={onCardTouchEnd}
                                                                onTouchCancel={onCardTouchEnd}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (touchMovedRef.current) return;
                                                                    if (movingEventId !== null) {
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
                                                                        : highlightedEventId !== null && (event.id === highlightedEventId || projectId === highlightedEventId)
                                                                        ? 'ring-4 ring-amber-400 ring-offset-2 animate-pulse'
                                                                        : 'active:brightness-90'
                                                                }`}
                                                                style={{
                                                                    backgroundColor: event.color,
                                                                    ...(event.dateStatus === 'tentative' ? { backgroundImage: TENTATIVE_STRIPE_BG } : {}),
                                                                }}
                                                            >
                                                                {editingUsers.length > 0 && (
                                                                    <Edit3 className="absolute top-0.5 right-0.5 w-2.5 h-2.5 text-slate-600 animate-pulse" />
                                                                )}
                                                                {!editingUsers.length && project?.isDispatchConfirmed && (
                                                                    <CheckCircle className="absolute top-0.5 right-0.5 w-2.5 h-2.5 text-slate-700" />
                                                                )}
                                                                <div className="text-[10px] font-bold text-slate-800 leading-tight truncate pr-3">
                                                                    {event.dateStatus === 'tentative' && <TentativeBadge />}
                                                                    {event.title}
                                                                </div>
                                                                {event.customer && (
                                                                    <div className="text-[10px] text-slate-600 leading-tight truncate">
                                                                        {event.customer}
                                                                    </div>
                                                                )}
                                                                {((event.memberCount ?? 0) > 0 || event.estimatedHours != null) && (
                                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                                        {(event.memberCount ?? 0) > 0 && (
                                                                            <span className="flex items-center gap-0.5">
                                                                                <Users className="w-2.5 h-2.5 text-slate-500" />
                                                                                <span className="text-[9px] text-slate-600">{event.memberCount ?? 0}人</span>
                                                                            </span>
                                                                        )}
                                                                        {event.estimatedHours != null && (
                                                                            <span className="text-[9px] text-slate-600">{event.estimatedHours}h</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {(() => {
                                                                    const vehicleNames = resolveEventVehicleNames(project ?? event, vehicleMaster);
                                                                    return vehicleNames.length > 0 ? (
                                                                        <div className="flex items-start gap-0.5 mt-0.5 text-slate-700">
                                                                            <Truck className="w-2.5 h-2.5 flex-shrink-0 mt-0.5 text-slate-500" />
                                                                            <span className="text-[9px] leading-tight truncate">{vehicleNames.join('・')}</span>
                                                                        </div>
                                                                    ) : null;
                                                                })()}
                                                                {event.remarks && (
                                                                    <div className="flex items-start gap-0.5 mt-0.5 text-slate-700">
                                                                        <MessageSquare className="w-2.5 h-2.5 flex-shrink-0 mt-0.5 text-slate-500" />
                                                                        <span className="text-[9px] leading-tight truncate">{event.remarks}</span>
                                                                    </div>
                                                                )}
                                                            </button>
                                                        );
                                                    })}

                                                    {/* 移動モード中: 既存イベントがあるセルにも追加できるよう点線ボタン */}
                                                    {movingEventId !== null && !isMovingSource && (
                                                        <div className="pointer-events-none flex items-center justify-center py-1 border border-dashed border-slate-400 text-slate-400 rounded">
                                                            <Plus className="w-3 h-3" />
                                                        </div>
                                                    )}

                                                    {/* 通常モード: 追加ボタン */}
                                                    {!isReadOnly && movingEventId === null && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!touchMovedRef.current) handleCellClick?.(row.employeeId, day.date);
                                                            }}
                                                            className="w-full flex items-center justify-center py-0.5 text-slate-300 hover:text-slate-400 hover:bg-slate-50 rounded transition-colors"
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </button>
                                                    )}

                                                    {/* セルメモ */}
                                                    {(() => {
                                                        const memo = cellRemarks[`${row.employeeId}-${dateKey}`] || '';
                                                        return memo ? (
                                                            <div
                                                                onClick={(e) => { e.stopPropagation(); startEditCellMemo(row.employeeId, dateKey); }}
                                                                className="w-full text-[8px] px-1 py-0.5 rounded bg-amber-50 text-slate-700 border-l-2 border-amber-400 mt-0.5 whitespace-pre-wrap break-words leading-tight"
                                                            >
                                                                {memo}
                                                            </div>
                                                        ) : !isReadOnly && movingEventId === null ? (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); startEditCellMemo(row.employeeId, dateKey); }}
                                                                className="w-full flex items-center justify-center py-0.5 text-slate-200 hover:text-slate-400 transition-colors"
                                                            >
                                                                <Pencil className="w-2.5 h-2.5" />
                                                            </button>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
    );
});

function MobileCalendarView({
    weekDays,
    events,
    employeeRows,
    projects,
    isReadOnly,
    canDispatch,
    isSaving,
    getTotalMembersForDate,
    getVacationEmployees,
    getEditingUsers,
    goToPreviousWeek,
    goToNextWeek,
    goToPreviousDay,
    goToNextDay,
    goToToday,
    canGoPrevWeek = true,
    canGoNextWeek = true,
    canGoPrevDay = true,
    canGoNextDay = true,
    handleEventClick,
    handleCellClick,
    handleMoveEvent,
    handleOpenDispatchModal,
    handleCopyEvent,
    handleMoveToCell,
    handleOpenSearch,
    highlightedEventId = null,
    getMemberAdjustment,
    onMemberAdjustmentChange,
    hideRemarks = false,
    handleFloatingEventClick,
    handleFloatingCellClick,
    floatingLaneAnchorId = null,
    hideFloatingLane = false,
}: MobileCalendarViewProps) {
    const todayKey = formatDateKey(new Date());
    const isLandscape = useMediaQuery('(orientation: landscape) and (max-height: 500px)');
    const LABEL_W = isLandscape ? LABEL_W_LANDSCAPE : LABEL_W_NORMAL;
    const COL_W = isLandscape ? COL_W_LANDSCAPE : COL_W_NORMAL;
    const [showRemarks, setShowRemarks] = useState(false);

    // ── 備考・休暇 ──
    const { getRemarks, setRemarks, getVacationEmployees: getVacEmp, addVacationEmployee, removeVacationEmployee } = useVacation();
    const setCellRemark = useCalendarStore(state => state.setCellRemark);
    const cellRemarks = useCalendarStore(state => state.cellRemarks);

    // ── 工事種別の名前解決（カード/アクションシート表示用） ──
    const constructionTypes = useMasterStore(selectConstructionTypes);
    const vehicleMaster = useMasterStore(selectVehicles);
    const getConstructionTypeName = useCallback(
        (id?: string | null): string | null => {
            if (!id) return null;
            return constructionTypes.find((t) => t.id === id)?.name ?? null;
        },
        [constructionTypes]
    );

    // 備考編集
    const [editingRemark, setEditingRemark] = useState<string | null>(null);
    const [remarkTemp, setRemarkTemp] = useState<{ [key: string]: string }>({});

    const startEditRemark = useCallback((dateKey: string) => {
        if (isReadOnly) return;
        setEditingRemark(dateKey);
        setRemarkTemp(prev => ({ ...prev, [dateKey]: getRemarks(dateKey) }));
    }, [isReadOnly, getRemarks]);

    const saveRemark = useCallback((dateKey: string) => {
        setRemarks(dateKey, remarkTemp[dateKey] || '');
        setEditingRemark(null);
    }, [remarkTemp, setRemarks]);

    // セルメモ編集
    const [editingCellMemo, setEditingCellMemo] = useState<{ foremanId: string; dateKey: string } | null>(null);
    const [cellMemoTemp, setCellMemoTemp] = useState('');

    const startEditCellMemo = useCallback((foremanId: string, dateKey: string) => {
        if (isReadOnly) return;
        setEditingCellMemo({ foremanId, dateKey });
        setCellMemoTemp(cellRemarks[`${foremanId}-${dateKey}`] || '');
    }, [isReadOnly, cellRemarks]);

    const saveCellMemo = useCallback(() => {
        if (!editingCellMemo) return;
        setCellRemark(editingCellMemo.foremanId, editingCellMemo.dateKey, cellMemoTemp);
        setEditingCellMemo(null);
    }, [editingCellMemo, cellMemoTemp, setCellRemark]);

    // ── アクションシート ──
    const [chatProjectId, setChatProjectId] = useState<{ id: string; title: string } | null>(null);
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
        handleMoveToCell(movingEvent, employeeId, date);
        setMovingEvent(null);
    }, [movingEvent, handleMoveToCell]);

    // ── 長押し選択メニュー（同一セルに複数案件があるとき：並び替え or 移動） ──
    const [longPressMenu, setLongPressMenu] = useState<{ event: CalendarEvent; employeeId: string; date: Date } | null>(null);

    // ── セル内並び替えモード ──
    const [reorderTarget, setReorderTarget] = useState<{ employeeId: string; date: Date } | null>(null);

    // 並び替え対象セルのイベント（sortOrder 順）。events 更新のたびに最新順を反映。
    const reorderEvents = useMemo(() => {
        if (!reorderTarget) return [] as CalendarEvent[];
        const dk = formatDateKey(reorderTarget.date);
        return events
            .filter(e => (e.assignedEmployeeId ?? '') === reorderTarget.employeeId && formatDateKey(e.startDate) === dk)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }, [reorderTarget, events]);

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

    const onCardTouchStart = useCallback((event: CalendarEvent, employeeId: string, date: Date, cellCount: number) => {
        if (isReadOnly || movingEvent) return;
        longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            if (touchMoved.current) return; // スクロール中なら無視
            navigator.vibrate?.(60);
            touchMoved.current = true; // 長押し確定後はタップ判定させない
            // 同一セルに複数 → 「並び替え/移動」の選択メニュー。単一 → そのまま移動モード。
            if (cellCount >= 2 && handleMoveEvent) {
                setLongPressMenu({ event, employeeId, date });
            } else if (handleMoveToCell) {
                setMovingEvent(event);
            }
        }, LONG_PRESS_MS);
    }, [isReadOnly, movingEvent, handleMoveToCell, handleMoveEvent]);

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

    // 浮きレーン（列幅は上の固定幅グリッドに合わせる）。並べ替えはPC限定のため▲▼は出さない
    const floatingLane = handleFloatingEventClick && !hideFloatingLane ? (
        <FloatingLane
            weekDays={weekDays}
            events={events}
            onEventClick={handleFloatingEventClick}
            onCellClick={handleFloatingCellClick}
            isReadOnly={isReadOnly}
            compact
            labelWidth={LABEL_W}
            colWidth={COL_W}
            onLongPressEvent={isReadOnly ? undefined : (ev) => setMovingEvent(ev)}
            movingEventId={movingEvent?.id ?? null}
            isMoving={movingEvent !== null}
            onCommitMove={(date) => commitMove('unassigned', date)}
        />
    ) : null;
    // アンカーの職長が実在するときだけ行間に挟む（見つからなければ末尾）
    const anchorIndex = floatingLaneAnchorId
        ? employeeRows.findIndex((row) => row.employeeId === floatingLaneAnchorId)
        : -1;

    return (
        <div className="h-full flex flex-col bg-white overflow-hidden">

            {/* ── ナビゲーション ── */}
            <div className={`flex-shrink-0 bg-white border-b border-slate-200 px-2 ${isLandscape ? 'py-0.5' : 'py-1.5'}`}>
                <div className="flex items-center justify-between">
                    {/* Left: back buttons (week << , day <) */}
                    <div className="flex items-center">
                        <button
                            onClick={goToPreviousWeek}
                            disabled={!canGoPrevWeek}
                            className={`rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${isLandscape ? 'p-0.5' : 'p-1.5'}`}
                            aria-label="1週間前"
                        >
                            <svg className={`text-slate-600 ${isLandscape ? 'w-4 h-4' : 'w-5 h-5'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                        </button>
                        <button
                            onClick={goToPreviousDay}
                            disabled={!canGoPrevDay}
                            className={`rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${isLandscape ? 'p-0.5' : 'p-1.5'}`}
                            aria-label="1日前"
                        >
                            <ChevronLeft className={`text-slate-600 ${isLandscape ? 'w-4 h-4' : 'w-5 h-5'}`} />
                        </button>
                    </div>

                    {/* Center: week label + today + remarks toggle + search */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={goToToday}
                            className={`font-bold text-slate-800 px-3 py-1 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors ${isLandscape ? 'text-xs' : 'text-sm'}`}
                        >
                            {weekLabel}
                        </button>
                        {handleOpenSearch && (
                            <button
                                onClick={handleOpenSearch}
                                className={`rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200 transition-colors ${isLandscape ? 'p-0.5' : 'p-1.5'}`}
                                aria-label="案件を検索"
                                title="案件を検索"
                            >
                                <Search className={isLandscape ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
                            </button>
                        )}
                        {isLandscape && !hideRemarks && (
                            <button
                                onClick={() => setShowRemarks(prev => !prev)}
                                className={`p-1 rounded-lg transition-colors ${showRemarks ? 'bg-teal-100 text-teal-700' : 'text-slate-400 hover:bg-slate-100'}`}
                                title="備考表示切替"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Right: forward buttons (day > , week >>) */}
                    <div className="flex items-center">
                        <button
                            onClick={goToNextDay}
                            disabled={!canGoNextDay}
                            className={`rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${isLandscape ? 'p-0.5' : 'p-1.5'}`}
                            aria-label="1日後"
                        >
                            <ChevronRight className={`text-slate-600 ${isLandscape ? 'w-4 h-4' : 'w-5 h-5'}`} />
                        </button>
                        <button
                            onClick={goToNextWeek}
                            disabled={!canGoNextWeek}
                            className={`rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${isLandscape ? 'p-0.5' : 'p-1.5'}`}
                            aria-label="1週間後"
                        >
                            <svg className={`text-slate-600 ${isLandscape ? 'w-4 h-4' : 'w-5 h-5'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* ── 移動モードバナー ── */}
            {movingEvent && (
                <div className="flex-shrink-0 bg-slate-700 text-white px-3 py-2 flex items-center gap-2">
                    <MoveRight className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold truncate block">「{movingEvent.title}」を移動中</span>
                        <span className="text-[10px] text-slate-200">移動先のセルをタップ</span>
                    </div>
                    <button
                        onClick={cancelMoving}
                        className="flex items-center gap-1 bg-slate-600 hover:bg-slate-400 active:bg-slate-800 rounded-lg px-2.5 py-1.5 flex-shrink-0 transition-colors"
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
                    <div className="flex sticky top-0 z-20 border-b-2 border-slate-300 shadow-sm" style={{ height: isLandscape ? 28 : 40 }}>
                        <div
                            className="sticky left-0 z-30 bg-slate-100 border-r-2 border-slate-300 flex items-center justify-center flex-shrink-0"
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
                                    className={`grow flex-shrink-0 border-r border-slate-200 flex flex-col items-center justify-center ${
                                        isToday ? 'bg-teal-600'
                                        : isSat ? 'bg-blue-50'
                                        : isSun ? 'bg-rose-50'
                                        : 'bg-slate-100'
                                    }`}
                                    style={{ width: COL_W }}
                                >
                                    <span className={`text-[11px] font-bold ${
                                        isToday ? 'text-white' : isSat ? 'text-slate-700' : isSun ? 'text-slate-600' : 'text-slate-700'
                                    }`}>
                                        {formatDate(day.date, 'short')}({getDayOfWeekString(day.date, 'short')})
                                        {(() => {
                                            // 浮きの件数バッジもレーンと同じ権限で出し分ける
                                            const fs = hideFloatingLane ? { count: 0, members: 0 } : getFloatingSummaryForDate(events, day.date);
                                            return fs.count > 0 ? (
                                                <span
                                                    className="ml-1 inline-flex items-center justify-center min-w-[13px] h-[13px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none align-middle"
                                                    title={`浮き ${fs.count}件・計${fs.members}人`}
                                                >
                                                    {fs.count}
                                                </span>
                                            ) : null;
                                        })()}
                                    </span>
                                    {isToday && <span className="text-[8px] text-teal-100">今日</span>}
                                </div>
                            );
                        })}
                    </div>

                    {/* 空き人数行（sticky: ヘッダー直下） */}
                    {!hideRemarks && (
                    <div
                        className="flex sticky z-[15] border-b-2 border-slate-300 bg-slate-100 shadow-sm"
                        style={{ height: isLandscape ? 20 : 28, top: isLandscape ? 28 : 40 }}
                    >
                        <div
                            className="sticky left-0 z-20 bg-slate-100 border-r-2 border-slate-300 flex items-center justify-center flex-shrink-0"
                            style={{ width: LABEL_W }}
                        >
                            <span className="text-[9px] font-bold text-slate-500">空き</span>
                        </div>
                        {weekDays.map((day) => {
                            const dateKey = formatDateKey(day.date);
                            const isSat = day.dayOfWeek === 6;
                            const isSun = day.dayOfWeek === 0;
                            const dayEvts = events.filter(e => formatDateKey(e.startDate) === dateKey);
                            const byForeman = new Map<string, number[]>();
                            let unassignedCount = 0;
                            dayEvts.forEach(e => {
                                const count = e.memberCount ?? 0;
                                const key = e.assignedEmployeeId;
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
                            const total = getTotalMembersForDate(dateKey) + adjustment;
                            const remaining = total - assignedCount - vacationCount;
                            return (
                                <div
                                    key={dateKey}
                                    className={`grow flex-shrink-0 border-r border-slate-200 flex items-center justify-center gap-0.5 ${
                                        isSat ? 'bg-slate-50/30' : isSun ? 'bg-slate-50/30' : ''
                                    }`}
                                    style={{ width: COL_W }}
                                >
                                    {onMemberAdjustmentChange && (
                                        <button
                                            onClick={() => onMemberAdjustmentChange(dateKey, -1)}
                                            className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-200 active:bg-slate-300 text-slate-600 text-[10px] font-bold leading-none"
                                        >
                                            −
                                        </button>
                                    )}
                                    <span className={remaining === 0
                                        ? 'text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap text-emerald-600'
                                        : remaining > 0
                                        ? 'text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap text-blue-600'
                                        : 'text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap text-red-600'}>
                                        {remaining}<span className="opacity-70">/{total}</span>
                                    </span>
                                    {onMemberAdjustmentChange && (
                                        <button
                                            onClick={() => onMemberAdjustmentChange(dateKey, 1)}
                                            className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-200 active:bg-slate-300 text-slate-600 text-[10px] font-bold leading-none"
                                        >
                                            +
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    )}

                    {/* 備考行（休暇+フリーテキスト） */}
                    {!hideRemarks && (!isLandscape || showRemarks) && (
                        <div className="flex border-b-2 border-slate-300 bg-teal-50/80" style={{ minHeight: isLandscape ? 36 : 48 }}>
                            <div
                                className="sticky left-0 z-[5] bg-teal-50 border-r-2 border-slate-300 flex items-center justify-center flex-shrink-0"
                                style={{ width: LABEL_W }}
                            >
                                <span className="text-[9px] font-bold text-slate-700">備考</span>
                            </div>
                            {weekDays.map((day) => {
                                const dateKey = formatDateKey(day.date);
                                const isEditing = editingRemark === dateKey;
                                const remarkText = isEditing ? (remarkTemp[dateKey] ?? '') : getRemarks(dateKey);
                                const vacIds = getVacEmp(dateKey);

                                return (
                                    <div
                                        key={dateKey}
                                        className="grow flex-shrink-0 border-r border-slate-200 p-1"
                                        style={{ width: COL_W }}
                                    >
                                        {/* 休暇バッジ（コンパクト版） */}
                                        <VacationSelector
                                            dateKey={dateKey}
                                            selectedEmployeeIds={vacIds}
                                            onAddEmployee={(empId) => addVacationEmployee(dateKey, empId)}
                                            onRemoveEmployee={(empId) => removeVacationEmployee(dateKey, empId)}
                                            readOnly={isReadOnly}
                                        />
                                        {/* フリーテキスト備考 */}
                                        <div
                                            onClick={() => !isEditing && !isReadOnly && startEditRemark(dateKey)}
                                            className={!isEditing && !isReadOnly ? 'cursor-text' : ''}
                                        >
                                            {isEditing && !isReadOnly ? (
                                                <textarea
                                                    autoFocus
                                                    value={remarkText}
                                                    onChange={(e) => setRemarkTemp(prev => ({ ...prev, [dateKey]: e.target.value }))}
                                                    onBlur={() => saveRemark(dateKey)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveRemark(dateKey); }
                                                        else if (e.key === 'Escape') setEditingRemark(null);
                                                    }}
                                                    className="w-full min-h-[32px] p-1 text-[9px] resize-none border border-slate-400 rounded focus:outline-none focus:ring-1 focus:ring-slate-500 bg-white"
                                                    placeholder="備考を入力..."
                                                />
                                            ) : (
                                                <div className={`w-full min-h-[20px] p-0.5 text-[9px] whitespace-pre-wrap break-words rounded ${remarkText ? 'bg-amber-50 text-slate-700 border-l-2 border-amber-400' : 'text-slate-400 italic'}`}>
                                                    {remarkText || (isReadOnly ? '' : 'タップで入力')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* 職長行 */}
                    {employeeRows.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 text-sm">表示する職長がいません</div>
                    ) : (
                        employeeRows.map((row, rowPos) => (
                            <React.Fragment key={`${row.employeeId}-${row.rowIndex}`}>
                            {rowPos === anchorIndex && floatingLane}
                            <MobileForemanRow
                                row={row}
                                weekDays={weekDays}
                                todayKey={todayKey}
                                isLandscape={isLandscape}
                                colW={COL_W}
                                labelW={LABEL_W}
                                movingEventId={movingEvent?.id ?? null}
                                touchMovedRef={touchMoved}
                                isReadOnly={isReadOnly}
                                cellRemarks={cellRemarks}
                                projects={projects}
                                vehicleMaster={vehicleMaster}
                                highlightedEventId={highlightedEventId}
                                getEditingUsers={getEditingUsers}
                                handleCellClick={handleCellClick}
                                commitMove={commitMove}
                                cancelMoving={cancelMoving}
                                openActionSheet={openActionSheet}
                                startEditCellMemo={startEditCellMemo}
                                onCardTouchStart={onCardTouchStart}
                                onCardTouchEnd={onCardTouchEnd}
                            />
                            </React.Fragment>
                        ))
                    )}

                    {/* 浮いているレーン。職長行の間へ動かしている場合は上のmap内で描画済み */}
                    {anchorIndex === -1 && floatingLane}
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
                                        <div className="text-slate-500 text-base mt-0.5">{actionSheet.event.customer}</div>
                                    )}
                                    {(() => {
                                        const typeName = getConstructionTypeName(actionSheet.event.constructionType);
                                        return typeName ? (
                                            <div className="inline-flex items-center gap-1.5 mt-1">
                                                <span
                                                    className="w-2.5 h-2.5 rounded-sm border border-slate-300 flex-shrink-0"
                                                    style={{ backgroundColor: actionSheet.event.color }}
                                                />
                                                <span className="text-slate-600 text-sm font-medium">{typeName}</span>
                                            </div>
                                        ) : null;
                                    })()}
                                    <div className="flex items-center gap-3 mt-1 text-slate-500 text-xs">
                                        {(actionSheet.event.memberCount ?? 0) > 0 && (
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3 h-3" />{actionSheet.event.memberCount ?? 0}人
                                            </span>
                                        )}
                                        {actionSheet.event.estimatedHours != null && (
                                            <span>{actionSheet.event.estimatedHours}h</span>
                                        )}
                                        {actionSheet.event.remarks && (
                                            <span className="truncate">{actionSheet.event.remarks}</span>
                                        )}
                                    </div>
                                    {(() => {
                                        const vehicleNames = resolveEventVehicleNames(actionSheet.project ?? actionSheet.event, vehicleMaster);
                                        return vehicleNames.length > 0 ? (
                                            <div className="flex items-start gap-1 mt-1 text-slate-500 text-xs">
                                                <Truck className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                                <span>{vehicleNames.join('・')}</span>
                                            </div>
                                        ) : null;
                                    })()}
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

                            {actionSheet.project?.projectMasterId && (
                                <button
                                    onClick={() => {
                                        const pmId = actionSheet.project!.projectMasterId!;
                                        const evTitle = actionSheet.event?.title || '案件';
                                        closeActionSheet();
                                        setChatProjectId({ id: pmId, title: evTitle });
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <MessageSquare className="w-5 h-5 text-slate-500" />
                                    チャット
                                </button>
                            )}

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

                            {!isReadOnly && handleMoveEvent && (() => {
                                const ev = actionSheet.event!;
                                const dk = formatDateKey(ev.startDate);
                                const siblings = events.filter(e =>
                                    (e.assignedEmployeeId ?? '') === (ev.assignedEmployeeId ?? '') &&
                                    formatDateKey(e.startDate) === dk
                                ).length;
                                if (siblings < 2) return null;
                                return (
                                    <button
                                        onClick={() => {
                                            const target = { employeeId: ev.assignedEmployeeId ?? '', date: ev.startDate };
                                            closeActionSheet();
                                            setReorderTarget(target);
                                        }}
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                                    >
                                        <ArrowUpDown className="w-5 h-5 text-slate-500" />
                                        このセル内で並び替え
                                    </button>
                                );
                            })()}

                            {!isReadOnly && handleCopyEvent && (
                                <button
                                    onClick={() => { closeActionSheet(); handleCopyEvent(actionSheet.event!.id); }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <Copy className="w-5 h-5 text-slate-500" />
                                    別の日・職長にコピー
                                </button>
                            )}

                            {!isReadOnly && canDispatch && handleOpenDispatchModal && actionSheet.event.assignedEmployeeId !== 'unassigned' && (
                                <button
                                    onClick={() => {
                                        closeActionSheet();
                                        const projectId = actionSheet.event!.id.replace(/-assembly$|-demolition$/, '');
                                        handleOpenDispatchModal(projectId);
                                    }}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm rounded-lg transition-colors ${
                                        actionSheet.project?.isDispatchConfirmed
                                            ? 'text-slate-700 hover:bg-slate-50'
                                            : 'text-slate-700 hover:bg-slate-50 active:bg-slate-100'
                                    }`}
                                >
                                    {actionSheet.project?.isDispatchConfirmed ? (
                                        <><CheckCircle className="w-5 h-5 text-slate-500" />手配確定済み</>
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

            {/* ── 長押し選択メニュー（並び替え or 移動） ── */}
            {longPressMenu && (
                <>
                    <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setLongPressMenu(null)} />
                    <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 animate-slide-up safe-area-bottom">
                        <div className="flex justify-center pt-3 pb-2">
                            <div className="w-10 h-1 bg-slate-300 rounded-full" />
                        </div>
                        <div className="px-4 pb-3 border-b border-slate-100">
                            <div className="flex items-start gap-3">
                                <div
                                    className="w-3 min-h-[36px] rounded-full flex-shrink-0 mt-0.5"
                                    style={{ backgroundColor: longPressMenu.event.color }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-800 text-base truncate">{longPressMenu.event.title}</div>
                                    <div className="text-slate-400 text-xs mt-0.5">操作を選択</div>
                                </div>
                            </div>
                        </div>
                        <div className="p-2">
                            <button
                                onClick={() => {
                                    const t = longPressMenu;
                                    setLongPressMenu(null);
                                    setReorderTarget({ employeeId: t.employeeId, date: t.date });
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                            >
                                <ArrowUpDown className="w-5 h-5 text-slate-500" />
                                このセル内で並び替え
                            </button>
                            {handleMoveToCell && (
                                <button
                                    onClick={() => {
                                        const ev = longPressMenu.event;
                                        setLongPressMenu(null);
                                        setMovingEvent(ev);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <MoveRight className="w-5 h-5 text-slate-500" />
                                    別の日・職長へ移動
                                </button>
                            )}
                            <button
                                onClick={() => setLongPressMenu(null)}
                                className="w-full mt-1 py-3 text-center text-sm text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                            >
                                キャンセル
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* ── セル内並び替えシート ── */}
            {reorderTarget && (
                <>
                    <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setReorderTarget(null)} />
                    <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 animate-slide-up safe-area-bottom">
                        <div className="flex justify-center pt-3 pb-2">
                            <div className="w-10 h-1 bg-slate-300 rounded-full" />
                        </div>
                        <div className="px-4 pb-2 flex items-center justify-between border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <ArrowUpDown className="w-4 h-4 text-slate-500" />
                                <span className="text-sm font-bold text-slate-700">並び替え</span>
                            </div>
                            <button
                                onClick={() => setReorderTarget(null)}
                                className="px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-medium hover:bg-slate-800 active:bg-slate-900 transition-colors"
                            >
                                完了
                            </button>
                        </div>
                        <div className="px-2 py-1 text-[11px] text-slate-400 text-center">▲▼ で順番を入れ替えます</div>
                        <div className="p-2 space-y-1.5 max-h-[55vh] overflow-y-auto">
                            {reorderEvents.length === 0 ? (
                                <div className="py-8 text-center text-sm text-slate-400">案件がありません</div>
                            ) : (
                                reorderEvents.map((ev, idx) => (
                                    <div
                                        key={ev.id}
                                        className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-white"
                                    >
                                        <span className="w-5 text-center text-xs font-bold text-slate-400 flex-shrink-0">{idx + 1}</span>
                                        <div
                                            className="w-1.5 self-stretch rounded-full flex-shrink-0"
                                            style={{ backgroundColor: ev.color }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-slate-800 truncate">{ev.title}</div>
                                            {ev.customer && (
                                                <div className="text-xs text-slate-500 truncate">{ev.customer}</div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => handleMoveEvent?.(ev.id, 'up')}
                                                disabled={idx === 0}
                                                className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 active:bg-slate-200 disabled:opacity-30 disabled:active:bg-slate-100 transition-colors"
                                                aria-label="上に移動"
                                            >
                                                <ChevronUp className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleMoveEvent?.(ev.id, 'down')}
                                                disabled={idx === reorderEvents.length - 1}
                                                className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 active:bg-slate-200 disabled:opacity-30 disabled:active:bg-slate-100 transition-colors"
                                                aria-label="下に移動"
                                            >
                                                <ChevronDown className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* セルメモ編集モーダル */}
            {editingCellMemo && (
                <>
                    <div className="fixed inset-0 bg-black/40 z-40" onClick={saveCellMemo} />
                    <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 animate-slide-up safe-area-bottom">
                        <div className="flex justify-center pt-3 pb-2">
                            <div className="w-10 h-1 bg-slate-300 rounded-full" />
                        </div>
                        <div className="px-4 pb-2">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-bold text-slate-700">メモ編集</span>
                                <button
                                    onClick={saveCellMemo}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors"
                                >
                                    <Check className="w-3 h-3" /> 保存
                                </button>
                            </div>
                            <textarea
                                autoFocus
                                value={cellMemoTemp}
                                onChange={(e) => setCellMemoTemp(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCellMemo(); }
                                    else if (e.key === 'Escape') setEditingCellMemo(null);
                                }}
                                className="w-full min-h-[80px] p-3 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
                                placeholder="メモを入力..."
                            />
                        </div>
                    </div>
                </>
            )}

            {/* 案件チャットモーダル */}
            {chatProjectId && (
                <ProjectChatModal
                    projectId={chatProjectId.id}
                    title={chatProjectId.title}
                    onClose={() => setChatProjectId(null)}
                />
            )}

            {/* 保存中オーバーレイ */}
            {isSaving && (
                <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 pointer-events-none">
                    <div className="bg-white rounded-lg px-6 py-4 shadow-xl flex items-center gap-3 pointer-events-auto">
                        <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium text-slate-700">保存中...</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// スマホ/タブレット常時表示時の発熱対策: 親state（アクションシート・備考編集・isSaving 等）
// の変化でグリッド全体が再構築されるのを遮断する。props は WeeklyCalendar 側で参照安定化済み。
export default React.memo(MobileCalendarView);
