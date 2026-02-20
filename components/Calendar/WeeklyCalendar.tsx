'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { useCalendar } from '@/hooks/useCalendar';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useCalendarModals } from '@/hooks/useCalendarModals';
import { useProjects, ConflictUpdateError } from '@/hooks/useProjects';
import { useMasterData } from '@/hooks/useMasterData';
import { useVacation } from '@/hooks/useVacation';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { generateEmployeeRows, formatDateKey } from '@/utils/employeeUtils';
import { canDispatch as canDispatchCheck } from '@/utils/permissions';
import { addDays } from '@/utils/dateUtils';
import { CalendarEvent, Project, Employee, ProjectAssignment, ConflictResolutionAction } from '@/types/calendar';
import Loading from '@/components/ui/Loading';
import { useAssignmentPresence } from '@/hooks/useAssignmentPresence';
import DesktopCalendarView from './DesktopCalendarView';
import MobileCalendarView from './MobileCalendarView';

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
const ConflictResolutionModal = dynamic(() => import('./ConflictResolutionModal'));

interface WeeklyCalendarProps {
    partnerMode?: boolean;
    partnerId?: string;
}

export default function WeeklyCalendar({ partnerMode = false, partnerId }: WeeklyCalendarProps) {
    const { data: session, status } = useSession();
    const { projects, addProject, updateProject, updateProjects, deleteProject, fetchForDateRange, isInitialized, refreshProjects } = useProjects();
    const { totalMembers } = useMasterData();
    const { getVacationEmployees } = useVacation();
    const { displayedForemanIds, removeForeman, allForemen, moveForeman, isLoading: isCalendarLoading } = useCalendarDisplay();

    const [isMounted, setIsMounted] = useState(false);
    const isReadOnly = partnerMode;
    const isMobile = useMediaQuery('(max-width: 1023px)');

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
                        console.error('Failed to overwrite:', err);
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

    const { currentDate, weekDays, goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday } = useCalendar(events);

    // 表示週の前後1週間のデータをフェッチ
    useEffect(() => {
        if (status === 'authenticated' && isMounted) {
            const weekStart = new Date(currentDate);
            const weekEnd = addDays(weekStart, 6);
            const rangeStart = addDays(weekStart, -7);
            const rangeEnd = addDays(weekEnd, 7);
            fetchForDateRange(rangeStart, rangeEnd);
        }
    }, [currentDate, status, isMounted, fetchForDateRange]);

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
    }, [updateProjectWithConflictHandling]));

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

    // ローディング（isMobileがnullの間 = SSR/マウント前も含む）
    if (!isMounted || isCalendarLoading || !isInitialized || isMobile === null) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-lg shadow-sm border border-gray-200 min-h-[400px]">
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
                    totalMembers={totalMembers}
                    getVacationEmployees={getVacationEmployees}
                    getEditingUsers={getEditingUsers}
                    goToPreviousWeek={goToPreviousWeek}
                    goToNextWeek={goToNextWeek}
                    goToToday={goToToday}
                    handleEventClick={handleEventClick}
                    handleCellClick={isReadOnly ? undefined : handleCellClick}
                    handleMoveEvent={isReadOnly ? undefined : handleMoveEvent}
                    handleOpenDispatchModal={isReadOnly ? undefined : handleOpenDispatchModal}
                    handleCopyEvent={isReadOnly ? undefined : handleCopyEvent}
                    handleMoveToCell={isReadOnly ? undefined : handleMoveToCell}
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
                    totalMembers={totalMembers}
                    getVacationEmployees={getVacationEmployees}
                    getEditingUsers={getEditingUsers}
                    goToPreviousWeek={goToPreviousWeek}
                    goToNextWeek={goToNextWeek}
                    goToPreviousDay={goToPreviousDay}
                    goToNextDay={goToNextDay}
                    goToToday={goToToday}
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
        </>
    );
}
