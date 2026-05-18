'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { useCalendar } from '@/hooks/useCalendar';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import type { PendingMove } from '@/hooks/useDragAndDrop';
import type { Vehicle } from '@/types/master';
import { useCalendarModals } from '@/hooks/useCalendarModals';
import { useProjects, ConflictUpdateError } from '@/hooks/useProjects';
import { useMasterData } from '@/hooks/useMasterData';
import { useVacation } from '@/hooks/useVacation';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useCalendarStore } from '@/stores/calendarStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { generateEmployeeRows, formatDateKey } from '@/utils/employeeUtils';
import { canDispatch as canDispatchCheck } from '@/utils/permissions';
import { addDays } from '@/utils/dateUtils';
import { CalendarEvent, CalendarNavigation, Project, Employee, ProjectAssignment, ConflictResolutionAction } from '@/types/calendar';
import Loading from '@/components/ui/Loading';
import { useAssignmentPresence } from '@/hooks/useAssignmentPresence';
import DesktopCalendarView from './DesktopCalendarView';
import MobileCalendarView from './MobileCalendarView';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';

// モーダルを遅延読み込み
const ProjectModal = dynamic(() => import('../Projects/ProjectModal'), {
    loading: () => <Loading overlay />
});
const ProjectMasterSearchModal = dynamic(() => import('../ProjectMasterSearchModal'), {
    loading: () => <Loading overlay />
});
const DispatchConfirmModal = dynamic(() => import('./DispatchConfirmModal'), {
    loading: () => <Loading overlay />
});
const CopyAssignmentModal = dynamic(() => import('./CopyAssignmentModal'), {
    loading: () => <Loading overlay />
});
const ProjectSelectionModal = dynamic(() => import('./ProjectSelectionModal'), {
    loading: () => <Loading overlay />
});
const ScheduleSearchPanel = dynamic(() => import('./ScheduleSearchPanel'), {
    loading: () => <Loading overlay />
});
const ConflictResolutionModal = dynamic(() => import('./ConflictResolutionModal'));
const MoveConfirmModal = dynamic(() => import('./MoveConfirmModal'), {
    loading: () => <Loading overlay />
});

interface WeeklyCalendarProps {
    partnerMode?: boolean;
    partnerId?: string;
    onNavigationReady?: (nav: CalendarNavigation) => void;
    onSearchReady?: (openSearch: () => void) => void;
}

export default function WeeklyCalendar({ partnerMode = false, partnerId, onNavigationReady, onSearchReady }: WeeklyCalendarProps) {
    const { data: session, status } = useSession();
    const { projects, addProject, updateProject, updateProjects, deleteProject, fetchForDateRange, isInitialized, refreshProjects, forceRefreshRange } = useProjects();
    const { getTotalMembersForDate } = useMasterData();
    const { getVacationEmployees } = useVacation();
    const { displayedForemanIds, removeForeman, allForemen, moveForeman, isLoading: isCalendarLoading } = useCalendarDisplay();
    const [isMounted, setIsMounted] = useState(false);
    const userRole = session?.user?.role;
    const isForeman2 = userRole === 'foreman2';
    const isReadOnly = partnerMode || isForeman2;
    // Tailwindの`lg`と同条件で「デスクトップではない」= モバイルレイアウト判定
    // （iPad横向きはアスペクト比が16:10未満なのでモバイル扱いになる）
    const isMobile = useMediaQuery('not all and (min-width: 1024px) and (min-aspect-ratio: 16/10)');

    // Presence機能: 編集中ユーザーの追跡
    const { getEditingUsers } = useAssignmentPresence();

    // 保存中の状態管理
    const [isSaving, setIsSaving] = useState(false);

    // 競合解決モーダル用の状態
    const [conflictModalOpen, setConflictModalOpen] = useState(false);
    const [conflictData, setConflictData] = useState<{
        latestData?: ProjectAssignment;
        message: string;
        pendingUpdate?: { id: string; updates: Partial<Project> };
    } | null>(null);

    // 案件をカレンダーイベントに展開 (projectsが変わると再計算)
    const events: CalendarEvent[] = useMemo(() => projects as CalendarEvent[], [projects]);

    // モーダル関連のロジックをカスタムフックに分離
    const {
        isModalOpen, modalInitialData, handleEventClick, handleCloseModal, setModalInitialData, setIsModalOpen,
        isSearchModalOpen, cellContext, handleSelectProjectMaster, handleCloseSearchModal,
        isSelectionModalOpen, handleCellClick, handleSelectExisting, handleCreateNew, handleSelectionCancel,
        isDispatchModalOpen, dispatchProject, handleOpenDispatchModal, handleCloseDispatchModal,
        isCopyModalOpen, copyEvent, handleCopyEvent, handleCloseCopyModal, handleCopyAssignment,
    } = useCalendarModals(projects, events, addProject);

    // 手配確定権限チェック
    const canDispatch = useMemo(() => canDispatchCheck(session?.user), [session?.user]);

useEffect(() => { setIsMounted(true); }, []);

    // 競合解決ハンドラー
    const handleConflictResolution = useCallback(async (action: ConflictResolutionAction) => {
        if (!conflictData) return;

        switch (action) {
            case 'reload':
                await refreshProjects();
                break;
            case 'overwrite':
                if (conflictData.pendingUpdate) {
                    try {
                        const response = await fetch(`/api/assignments/${conflictData.pendingUpdate.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                assignedEmployeeId: conflictData.pendingUpdate.updates.assignedEmployeeId,
                                date: conflictData.pendingUpdate.updates.startDate instanceof Date
                                    ? conflictData.pendingUpdate.updates.startDate.toISOString()
                                    : conflictData.pendingUpdate.updates.startDate,
                                sortOrder: conflictData.pendingUpdate.updates.sortOrder,
                                workers: conflictData.pendingUpdate.updates.workers,
                                vehicles: conflictData.pendingUpdate.updates.vehicles,
                                meetingTime: conflictData.pendingUpdate.updates.meetingTime,
                                remarks: conflictData.pendingUpdate.updates.remarks,
                            }),
                        });
                        if (response.ok) {
                            await refreshProjects();
                        }
                    } catch (err) {
                        logger.error('Failed to overwrite:', err);
                    }
                }
                break;
            case 'cancel':
                break;
        }

        setConflictModalOpen(false);
        setConflictData(null);
    }, [conflictData, refreshProjects]);

    // 競合を処理するupdateProject wrapper
    const updateProjectWithConflictHandling = useCallback(async (id: string, updates: Partial<Project>) => {
        try {
            await updateProject(id, updates);
        } catch (error) {
            if (error instanceof ConflictUpdateError) {
                setConflictData({
                    latestData: error.latestData,
                    message: error.message,
                    pendingUpdate: { id, updates },
                });
                setConflictModalOpen(true);
            } else {
                throw error;
            }
        }
    }, [updateProject]);

    // 移動確認モーダル用の状態
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
    const [availableVehiclesData, setAvailableVehiclesData] = useState<{
        available: Vehicle[];
        inUse: { id: string; name: string; usedBy: string }[];
    } | null>(null);

    // セル間移動が発生したら即時確定せず、確認モーダルを開いて空き車両を取得
    const handlePendingMove = useCallback(async (pending: PendingMove) => {
        setPendingMove(pending);
        setAvailableVehiclesData(null);
        setIsMoveModalOpen(true);
        try {
            const dateKey = formatDateKey(pending.toDate);
            const projectId = pending.eventId.replace(/-assembly$|-demolition$/, '');
            const res = await fetch(
                `/api/calendar/available-vehicles?date=${dateKey}&excludeAssignmentId=${projectId}`,
                { cache: 'no-store' }
            );
            if (res.ok) {
                setAvailableVehiclesData(await res.json());
            } else {
                setAvailableVehiclesData({ available: [], inUse: [] });
            }
        } catch (e) {
            logger.error('Failed to fetch available vehicles:', e);
            setAvailableVehiclesData({ available: [], inUse: [] });
        }
    }, []);

    const { currentDate, weekDays, goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday, goToDate } = useCalendar(events);

    // 検索パネルの開閉
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const handleOpenSearch = useCallback(() => setIsSearchOpen(true), []);
    const handleCloseSearch = useCallback(() => setIsSearchOpen(false), []);

    // 検索結果クリック時のハイライト（3秒間）
    const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
    const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        return () => {
            if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        };
    }, []);
    const handleSearchJump = useCallback((date: Date, assignmentId: string) => {
        goToDate(date);
        setHighlightedEventId(assignmentId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightedEventId(null), 4000);
    }, [goToDate]);

    // ハイライト対象が画面に入っていなければ自動スクロール
    // - ジャンプ後にprojectsが揃うまで何回かリトライ（最大1.5秒）
    useEffect(() => {
        if (!highlightedEventId) return;
        let cancelled = false;
        let attempts = 0;
        const maxAttempts = 8; // 200ms * 8 = 1.6秒
        const tryScroll = () => {
            if (cancelled) return;
            const el = document.querySelector<HTMLElement>(`[data-project-id="${highlightedEventId}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                return;
            }
            if (++attempts < maxAttempts) {
                setTimeout(tryScroll, 200);
            }
        };
        // 初回は次のpaintを待ってから
        const t = setTimeout(tryScroll, 100);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [highlightedEventId, projects]);

    // ナビゲーション関数を親に公開
    useEffect(() => {
        if (onNavigationReady) {
            onNavigationReady({ goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday });
        }
    }, [onNavigationReady, goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday]);

    // 検索オープナーを親に公開（ScheduleToolbar から呼ばれる）
    useEffect(() => {
        if (onSearchReady) {
            onSearchReady(handleOpenSearch);
        }
    }, [onSearchReady, handleOpenSearch]);

    // 表示週の前後1週間のデータをフェッチ（デバウンス付き：週連打時に中間週のフェッチをスキップ）
    const fetchTimerRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (status === 'authenticated' && isMounted) {
            if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
            fetchTimerRef.current = setTimeout(() => {
                const weekStart = new Date(currentDate);
                const weekEnd = addDays(weekStart, 6);
                const rangeStart = addDays(weekStart, -7);
                const rangeEnd = addDays(weekEnd, 7);
                fetchForDateRange(rangeStart, rangeEnd);
            }, 300);
        }
        return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
    }, [currentDate, status, isMounted, fetchForDateRange]);

    // ポーリング: 120秒ごとに最新データを再取得（Supabase Realtime broadcast の補完）
    // - タブがバックグラウンドのときはスキップ（バッテリー節約）
    // - タブに戻ったら即時再取得
    // currentDateをrefで参照し、インターバルの再作成を防ぐ
    const currentDateRef = useRef(currentDate);
    currentDateRef.current = currentDate;
    useEffect(() => {
        if (status !== 'authenticated' || !isMounted) return;
        const refresh = () => {
            const weekStart = new Date(currentDateRef.current);
            const weekEnd = addDays(weekStart, 6);
            const rangeStart = addDays(weekStart, -7);
            const rangeEnd = addDays(weekEnd, 7);
            forceRefreshRange(rangeStart, rangeEnd);
        };
        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') refresh();
        }, 120_000);
        const onVisible = () => {
            if (document.visibilityState === 'visible') refresh();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [status, isMounted, forceRefreshRange]);

    // projectsの参照をrefで保持（クロージャの古い値問題を回避）
    const projectsRef = useRef(projects);
    projectsRef.current = projects;

    const { activeId, handleDragStart, handleDragEnd, handleDragOver, handleDragCancel } = useDragAndDrop(events, useCallback((updatedEvents: CalendarEvent[]) => {
        updatedEvents.forEach(updatedEvent => {
            const projectId = updatedEvent.id.replace(/-assembly$|-demolition$/, '');
            const currentProjects = projectsRef.current;
            const originalProject = currentProjects.find((p: Project) => p.id === projectId);
            if (originalProject) {
                const hasChanges =
                    originalProject.assignedEmployeeId !== updatedEvent.assignedEmployeeId ||
                    originalProject.startDate.getTime() !== updatedEvent.startDate.getTime() ||
                    originalProject.sortOrder !== updatedEvent.sortOrder;

                if (hasChanges) {
                    const updates: Partial<Project> = {
                        assignedEmployeeId: updatedEvent.assignedEmployeeId,
                        sortOrder: updatedEvent.sortOrder,
                    };

                    if (updatedEvent.id.endsWith('-assembly')) {
                        updates.assemblyStartDate = updatedEvent.startDate;
                        updates.startDate = updatedEvent.startDate;
                    } else if (updatedEvent.id.endsWith('-demolition')) {
                        updates.demolitionStartDate = updatedEvent.startDate;
                        updates.startDate = updatedEvent.startDate;
                    } else {
                        updates.startDate = updatedEvent.startDate;
                    }

                    updateProjectWithConflictHandling(projectId, updates);
                }
            }
        });
    }, [updateProjectWithConflictHandling]), { onPendingMove: handlePendingMove });

    // 移動を確定（職長/日付/並び順 ＋ 任意で車両・人数）。既存の競合ハンドリングを通す
    const applyPendingMove = useCallback((
        pending: PendingMove,
        extra?: { trucks?: string[]; memberCount?: number }
    ) => {
        const projectId = pending.eventId.replace(/-assembly$|-demolition$/, '');
        const newDateKey = formatDateKey(pending.toDate);
        const targetCellEvents = projectsRef.current.filter((p: Project) =>
            p.id !== projectId &&
            p.assignedEmployeeId === pending.toEmployeeId &&
            formatDateKey(p.startDate) === newDateKey
        );
        const newSortOrder = targetCellEvents.reduce(
            (max: number, p: Project) => Math.max(max, p.sortOrder ?? 0),
            -1
        ) + 1;

        const updates: Partial<Project> = {
            assignedEmployeeId: pending.toEmployeeId,
            sortOrder: newSortOrder,
        };
        if (pending.eventId.endsWith('-assembly')) {
            updates.assemblyStartDate = pending.toDate;
            updates.startDate = pending.toDate;
        } else if (pending.eventId.endsWith('-demolition')) {
            updates.demolitionStartDate = pending.toDate;
            updates.startDate = pending.toDate;
        } else {
            updates.startDate = pending.toDate;
        }
        if (extra?.trucks !== undefined) updates.vehicles = extra.trucks;
        if (extra?.memberCount !== undefined) updates.memberCount = extra.memberCount;

        updateProjectWithConflictHandling(projectId, updates);
    }, [updateProjectWithConflictHandling, projectsRef]);

    const closeMoveModal = useCallback(() => {
        setIsMoveModalOpen(false);
        setPendingMove(null);
        setAvailableVehiclesData(null);
    }, []);

    const handleMoveKeep = useCallback(() => {
        if (pendingMove) applyPendingMove(pendingMove);
        closeMoveModal();
    }, [pendingMove, applyPendingMove, closeMoveModal]);

    const handleMoveReassign = useCallback((trucks: string[], memberCount: number) => {
        if (pendingMove) applyPendingMove(pendingMove, { trucks, memberCount });
        closeMoveModal();
    }, [pendingMove, applyPendingMove, closeMoveModal]);

    const handleMoveCancel = useCallback(() => {
        // 何も更新しない（カードは元の位置のまま）
        closeMoveModal();
    }, [closeMoveModal]);

    // 職長別の行データを生成
    const employeeRows = useMemo(() => {
        let filteredEmployees: Employee[] = [];

        if (partnerMode && partnerId) {
            const partnerData = allForemen.find(f => f.id === partnerId);
            if (partnerData) {
                filteredEmployees = [{ id: partnerData.id, name: partnerData.displayName }];
            }
        } else {
            filteredEmployees = displayedForemanIds
                .map(id => allForemen.find(f => f.id === id))
                .filter((foreman): foreman is typeof allForemen[0] => foreman !== undefined)
                .map(foreman => ({ id: foreman.id, name: foreman.displayName }));
        }

        return generateEmployeeRows(filteredEmployees, events, weekDays);
    }, [events, weekDays, displayedForemanIds, allForemen, partnerMode, partnerId]);

    const activeEvent = useMemo(() => activeId ? events.find(event => event.id === activeId) ?? null : null, [activeId, events]);

    // 矢印ボタンでイベントを上下に移動
    const handleMoveEvent = useCallback((eventId: string, direction: 'up' | 'down') => {
        const projectId = eventId.replace(/-assembly$|-demolition$/, '');
        const event = projects.find(p => p.id === projectId);
        if (!event) return;

        const cellEvents = projects.filter(p =>
            p.assignedEmployeeId === event.assignedEmployeeId &&
            formatDateKey(p.startDate) === formatDateKey(event.startDate)
        ).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        const currentIndex = cellEvents.findIndex(e => e.id === projectId);
        if (currentIndex === -1) return;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= cellEvents.length) return;

        const newOrder = [...cellEvents];
        [newOrder[currentIndex], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[currentIndex]];

        const updates = newOrder.map((evt, index) => ({ id: evt.id, data: { sortOrder: index } }));
        updateProjects(updates);
    }, [projects, updateProjects]);

    // モーダルから案件を保存（競合ハンドリング付き）
    const handleSaveProject = useCallback(async (projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        setIsSaving(true);
        try {
            if (modalInitialData.id) {
                await updateProjectWithConflictHandling(modalInitialData.id, projectData);
            } else {
                // 新規作成時: 対象セルの既存案件の最大sortOrder+1をセット（重複を防ぐ）
                if (!projectData.workSchedules?.length) {
                    const targetEmployeeId = projectData.assignedEmployeeId;
                    const targetDate = projectData.startDate instanceof Date ? projectData.startDate : new Date(projectData.startDate!);
                    if (targetEmployeeId && targetDate) {
                        const targetDateKey = formatDateKey(targetDate);
                        const targetCellProjects = projectsRef.current.filter(p =>
                            p.assignedEmployeeId === targetEmployeeId &&
                            formatDateKey(p.startDate) === targetDateKey
                        );
                        const maxSortOrder = targetCellProjects.reduce(
                            (max, p) => Math.max(max, p.sortOrder ?? 0),
                            -1
                        );
                        projectData = { ...projectData, sortOrder: maxSortOrder + 1 };
                    }
                }
                await addProject(projectData);
            }
        } finally {
            setIsSaving(false);
        }
    }, [modalInitialData.id, updateProjectWithConflictHandling, addProject]);

    // モバイル: 長押しで別セルに移動
    const handleMoveToCell = useCallback(async (eventId: string, targetEmployeeId: string, targetDate: Date) => {
        const projectId = eventId.replace(/-assembly$|-demolition$/, '');
        const targetDateKey = formatDateKey(targetDate);
        const currentProjects = projectsRef.current;

        // 移動先セルの末尾に配置
        const targetCellProjects = currentProjects.filter(p =>
            p.assignedEmployeeId === targetEmployeeId &&
            formatDateKey(p.startDate) === targetDateKey
        );
        const maxSortOrder = targetCellProjects.reduce((max, p) => Math.max(max, p.sortOrder ?? 0), -1);

        const updates: Partial<Project> = {
            assignedEmployeeId: targetEmployeeId,
            sortOrder: maxSortOrder + 1,
        };
        if (eventId.endsWith('-assembly')) {
            updates.assemblyStartDate = targetDate;
            updates.startDate = targetDate;
        } else if (eventId.endsWith('-demolition')) {
            updates.demolitionStartDate = targetDate;
            updates.startDate = targetDate;
        } else {
            updates.startDate = targetDate;
        }

        await updateProjectWithConflictHandling(projectId, updates);
    }, [updateProjectWithConflictHandling, projectsRef]);

    // 日別メンバー調整
    const memberAdjustments = useCalendarStore((state) => state.memberAdjustments);
    const setMemberAdjustment = useCalendarStore((state) => state.setMemberAdjustment);

    // ヘッダー残り人数・セルメモが揃っているか（部分ロードで誤値表示を防ぐ）
    const cellRemarksInitialized = useCalendarStore((state) => state.cellRemarksInitialized);
    const memberAdjustmentsInitialized = useCalendarStore((state) => state.memberAdjustmentsInitialized);
    const vacationsInitialized = useCalendarStore((state) => state.vacationsInitialized);
    const calendarDataReady = cellRemarksInitialized && memberAdjustmentsInitialized && vacationsInitialized;
    // 連打対応: pendingは即時UI反映、一定時間後にまとめて確認ダイアログ
    const [pendingAdjustments, setPendingAdjustments] = useState<Record<string, number>>({});
    const pendingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const pendingToastIdsRef = useRef<Record<string, string>>({});
    const getMemberAdjustmentCb = useCallback((dateKey: string) => {
        return (memberAdjustments[dateKey] || 0) + (pendingAdjustments[dateKey] || 0);
    }, [memberAdjustments, pendingAdjustments]);

    const clearPending = useCallback((dateKey: string) => {
        setPendingAdjustments(prev => {
            if (!(dateKey in prev)) return prev;
            const rest = { ...prev };
            delete rest[dateKey];
            return rest;
        });
    }, []);

    const commitPending = useCallback((dateKey: string, delta: number) => {
        const current = useCalendarStore.getState().memberAdjustments[dateKey] || 0;
        setMemberAdjustment(dateKey, current + delta);
        clearPending(dateKey);
    }, [setMemberAdjustment, clearPending]);

    const promptConfirmAdjustment = useCallback((dateKey: string) => {
        // 最新のpending値を取得するためsetterパターンで読む
        setPendingAdjustments(prev => {
            const pendingDelta = prev[dateKey] || 0;
            if (pendingDelta === 0) {
                if (pendingToastIdsRef.current[dateKey]) {
                    toast.dismiss(pendingToastIdsRef.current[dateKey]);
                    delete pendingToastIdsRef.current[dateKey];
                }
                const rest = { ...prev };
                delete rest[dateKey];
                return rest;
            }

            // 既存のトーストがあれば閉じて新しく出し直す
            if (pendingToastIdsRef.current[dateKey]) {
                toast.dismiss(pendingToastIdsRef.current[dateKey]);
            }

            // 日付表示
            const [, m, d] = dateKey.split('-');
            const dateLabel = `${Number(m)}/${Number(d)}`;
            const sign = pendingDelta > 0 ? '+' : '';
            const message = `${dateLabel} の残り人数を ${sign}${pendingDelta}人 変更しますか？`;

            const id = toast.custom(
                (t) => (
                    <div
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-slate-800 text-white ${t.visible ? 'animate-enter' : 'animate-leave'}`}
                    >
                        <span className="text-sm whitespace-nowrap">{message}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={() => {
                                    toast.dismiss(t.id);
                                    delete pendingToastIdsRef.current[dateKey];
                                    commitPending(dateKey, pendingDelta);
                                }}
                                className="px-3 py-1 text-xs font-semibold rounded-lg bg-white text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                            >
                                はい
                            </button>
                            <button
                                onClick={() => {
                                    toast.dismiss(t.id);
                                    delete pendingToastIdsRef.current[dateKey];
                                    clearPending(dateKey);
                                }}
                                className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-600 text-white hover:bg-slate-500 whitespace-nowrap"
                            >
                                いいえ
                            </button>
                        </div>
                    </div>
                ),
                { duration: 8000, position: 'bottom-center' }
            );
            pendingToastIdsRef.current[dateKey] = id;
            // トーストが自動消滅した時に pending が残るのを防ぐ（duration と同期して破棄）
            setTimeout(() => {
                if (pendingToastIdsRef.current[dateKey] === id) {
                    delete pendingToastIdsRef.current[dateKey];
                    clearPending(dateKey);
                }
            }, 8000);
            return prev;
        });
    }, [commitPending, clearPending]);

    const handleMemberAdjustmentChange = useCallback((dateKey: string, delta: number) => {
        // pendingに即時反映（UIがすぐ更新される）
        setPendingAdjustments(prev => ({
            ...prev,
            [dateKey]: (prev[dateKey] || 0) + delta,
        }));

        // 連打対応: 既存タイマーをリセットして1.2秒後にまとめて確認
        if (pendingTimersRef.current[dateKey]) {
            clearTimeout(pendingTimersRef.current[dateKey]);
        }
        pendingTimersRef.current[dateKey] = setTimeout(() => {
            delete pendingTimersRef.current[dateKey];
            promptConfirmAdjustment(dateKey);
        }, 1200);
    }, [promptConfirmAdjustment]);

    // アンマウント時にタイマーを掃除
    useEffect(() => {
        return () => {
            Object.values(pendingTimersRef.current).forEach(clearTimeout);
            pendingTimersRef.current = {};
            Object.values(pendingToastIdsRef.current).forEach(id => toast.dismiss(id));
            pendingToastIdsRef.current = {};
        };
    }, []);

    // ローディング（isMobileがnullの間 = SSR/マウント前も含む）
    // 残り人数・セルメモは副次データに見えるが実際にはヘッダーとセルに直接効くため、
    // 初期化が完了するまで描画しない（部分ロード状態で誤った値が表示されるのを防ぐ）
    if (!isMounted || isCalendarLoading || !isInitialized || isMobile === null
        || !calendarDataReady) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-lg shadow-sm border border-slate-200 min-h-[400px]">
                <Loading size="lg" text="週間スケジュールを読み込み中..." />
            </div>
        );
    }

    return (
        <>
            {/* カレンダービュー: PC / モバイル切替 */}
            {isMobile ? (
                <MobileCalendarView
                    weekDays={weekDays}
                    events={events}
                    employeeRows={employeeRows}
                    projects={projects}
                    isReadOnly={isReadOnly}
                    canDispatch={canDispatch}
                    isSaving={isSaving}
                    getTotalMembersForDate={getTotalMembersForDate}
                    getVacationEmployees={getVacationEmployees}
                    getEditingUsers={getEditingUsers}
                    goToPreviousWeek={goToPreviousWeek}
                    goToNextWeek={goToNextWeek}
                    goToPreviousDay={goToPreviousDay}
                    goToNextDay={goToNextDay}
                    goToToday={goToToday}
                    handleEventClick={handleEventClick}
                    handleCellClick={isReadOnly ? undefined : handleCellClick}
                    handleMoveEvent={isReadOnly ? undefined : handleMoveEvent}
                    handleOpenDispatchModal={isReadOnly ? undefined : handleOpenDispatchModal}
                    handleCopyEvent={isReadOnly ? undefined : handleCopyEvent}
                    handleMoveToCell={isReadOnly ? undefined : handleMoveToCell}
                    handleOpenSearch={partnerMode ? undefined : handleOpenSearch}
                    highlightedEventId={highlightedEventId}
                    getMemberAdjustment={getMemberAdjustmentCb}
                    onMemberAdjustmentChange={isReadOnly ? undefined : handleMemberAdjustmentChange}
                    hideRemarks={partnerMode}
                />
            ) : (
                <DesktopCalendarView
                    weekDays={weekDays}
                    events={events}
                    employeeRows={employeeRows}
                    projects={projects}
                    activeEvent={activeEvent}
                    isReadOnly={isReadOnly}
                    canDispatch={canDispatch}
                    isSaving={isSaving}
                    getTotalMembersForDate={getTotalMembersForDate}
                    getVacationEmployees={getVacationEmployees}
                    getEditingUsers={getEditingUsers}
                    handleDragStart={handleDragStart}
                    handleDragOver={handleDragOver}
                    handleDragEnd={handleDragEnd}
                    handleDragCancel={handleDragCancel}
                    handleEventClick={handleEventClick}
                    handleCellClick={isReadOnly ? undefined : handleCellClick}
                    handleMoveEvent={isReadOnly ? undefined : handleMoveEvent}
                    removeForeman={isReadOnly ? undefined : removeForeman}
                    moveForeman={isReadOnly ? undefined : moveForeman}
                    handleOpenDispatchModal={isReadOnly ? undefined : handleOpenDispatchModal}
                    handleCopyEvent={isReadOnly ? undefined : handleCopyEvent}
                    handleMoveToCell={isReadOnly ? undefined : handleMoveToCell}
                    highlightedEventId={highlightedEventId}
                    getMemberAdjustment={getMemberAdjustmentCb}
                    onMemberAdjustmentChange={isReadOnly ? undefined : handleMemberAdjustmentChange}
                    hideRemarks={partnerMode}
                    hideForemanSelector={partnerMode}
                />
            )}

            {/* モーダル群（PC/モバイル共通） */}
            <ProjectModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSubmit={handleSaveProject}
                onDelete={deleteProject}
                initialData={modalInitialData.projectMasterId || modalInitialData.id ? modalInitialData : undefined}
                defaultDate={modalInitialData.startDate}
                defaultEmployeeId={modalInitialData.assignedEmployeeId}
                title={modalInitialData.id ? '案件編集' : '案件登録'}
                readOnly={isReadOnly}
            />

            <ProjectMasterSearchModal
                isOpen={isSearchModalOpen}
                onClose={handleCloseSearchModal}
                onSelect={handleSelectProjectMaster}
                onCreateNew={() => {
                    setModalInitialData({ startDate: cellContext?.date, assignedEmployeeId: cellContext?.employeeId });
                    setIsModalOpen(true);
                }}
            />

            {dispatchProject && (
                <DispatchConfirmModal isOpen={isDispatchModalOpen} onClose={handleCloseDispatchModal} project={dispatchProject} />
            )}

            <CopyAssignmentModal
                isOpen={isCopyModalOpen}
                onClose={handleCloseCopyModal}
                event={copyEvent}
                employees={allForemen.map(f => ({ id: f.id, name: f.displayName }))}
                onCopy={handleCopyAssignment}
            />

            <ProjectSelectionModal
                isOpen={isSelectionModalOpen}
                onClose={handleSelectionCancel}
                onSelectExisting={handleSelectExisting}
                onCreateNew={handleCreateNew}
            />

            <ConflictResolutionModal
                isOpen={conflictModalOpen}
                onClose={() => {
                    setConflictModalOpen(false);
                    setConflictData(null);
                }}
                onResolve={handleConflictResolution}
                latestData={conflictData?.latestData}
                conflictMessage={conflictData?.message}
            />

            {pendingMove && (
                <MoveConfirmModal
                    isOpen={isMoveModalOpen}
                    pendingMove={pendingMove}
                    eventTitle={
                        projects.find(
                            p => p.id === pendingMove.eventId.replace(/-assembly$|-demolition$/, '')
                        )?.title
                    }
                    fromForemanName={allForemen.find(f => f.id === pendingMove.fromEmployeeId)?.displayName}
                    toForemanName={allForemen.find(f => f.id === pendingMove.toEmployeeId)?.displayName}
                    availableVehicles={availableVehiclesData?.available ?? null}
                    inUseVehicles={availableVehiclesData?.inUse ?? []}
                    onConfirmKeep={handleMoveKeep}
                    onConfirmReassign={handleMoveReassign}
                    onCancel={handleMoveCancel}
                />
            )}

            <ScheduleSearchPanel
                isOpen={isSearchOpen}
                onClose={handleCloseSearch}
                onJump={handleSearchJump}
            />

        </>
    );
}
