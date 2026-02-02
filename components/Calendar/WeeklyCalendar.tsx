'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { useSession } from 'next-auth/react';
import { useCalendar } from '@/hooks/useCalendar';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useCalendarModals } from '@/hooks/useCalendarModals';
import { useProjects } from '@/hooks/useProjects';
import { useMasterData } from '@/hooks/useMasterData';
import { useVacation } from '@/hooks/useVacation';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { unassignedEmployee } from '@/data/mockEmployees';
import { generateEmployeeRows, formatDateKey } from '@/utils/employeeUtils';
import { canDispatch as canDispatchCheck } from '@/utils/permissions';
import CalendarHeader from './CalendarHeader';
import EmployeeRowComponent from './EmployeeRowComponent';
import DraggableEventCard from './DraggableEventCard';
import RemarksRow from './RemarksRow';
import ForemanSelector from './ForemanSelector';
import { formatDate, getDayOfWeekString, addDays } from '@/utils/dateUtils';
import { CalendarEvent, Project, Employee } from '@/types/calendar';
import Loading from '@/components/ui/Loading';

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

interface WeeklyCalendarProps {
    partnerMode?: boolean;
    partnerId?: string;
}

export default function WeeklyCalendar({ partnerMode = false, partnerId }: WeeklyCalendarProps) {
    const { data: session, status } = useSession();
    const { projects, addProject, updateProject, updateProjects, deleteProject, fetchForDateRange, isInitialized } = useProjects();
    const { totalMembers } = useMasterData();
    const { getVacationEmployees } = useVacation();
    const { displayedForemanIds, removeForeman, allForemen, moveForeman, isLoading: isCalendarLoading } = useCalendarDisplay();

    const [isMounted, setIsMounted] = useState(false);
    const isReadOnly = partnerMode;

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

    const { activeId, handleDragStart, handleDragEnd, handleDragOver, handleDragCancel } = useDragAndDrop(events, useCallback((updatedEvents: CalendarEvent[]) => {
        updatedEvents.forEach(updatedEvent => {
            const projectId = updatedEvent.id.replace(/-assembly$|-demolition$/, '');
            const originalProject = projects.find(p => p.id === projectId);
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

                    updateProject(projectId, updates);
                }
            }
        });
    }, [projects, updateProject]));

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

    const activeEvent = useMemo(() => activeId ? events.find(event => event.id === activeId) : null, [activeId, events]);

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

    // モーダルから案件を保存
    const handleSaveProject = useCallback((projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (modalInitialData.id) {
            updateProject(modalInitialData.id, projectData);
        } else {
            addProject(projectData);
        }
    }, [modalInitialData.id, updateProject, addProject]);

    if (!isMounted || isCalendarLoading || !isInitialized) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-lg shadow-sm border border-gray-200 min-h-[400px]">
                <Loading size="lg" text="週間スケジュールを読み込み中..." />
            </div>
        );
    }

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
                        {/* ヘッダー行: 日付と曜日 */}
                        <div className="flex border-b-2 border-slate-300 bg-gradient-to-r from-slate-100 to-slate-50 sticky top-0 z-20 shadow-md">
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
                                        <div className={`text-[11px] font-bold ${isSaturday ? 'text-blue-700' : isSunday ? 'text-rose-700' : 'text-slate-700'} ${day.isToday ? 'text-white' : ''}`}>{combinedDate}</div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 未割り当て行 */}
                        <div className="flex border-b-2 border-slate-400 bg-gradient-to-r from-slate-100 to-slate-50 sticky top-[32px] z-[25] shadow-sm h-9">
                            <div className="sticky left-0 z-30 bg-gradient-to-r from-slate-100 to-slate-50 border-r-2 border-slate-400 shadow-md">
                                <div className="w-32 h-full flex items-center justify-center">
                                    <span className="text-xs font-bold text-slate-700 tracking-wide">{unassignedEmployee.name}</span>
                                </div>
                            </div>
                            {weekDays.map((day, index) => {
                                const dateKey = formatDateKey(day.date);
                                const isSaturday = day.dayOfWeek === 6;
                                const isSunday = day.dayOfWeek === 0;
                                const assignedCount = events.filter(event => formatDateKey(event.startDate) === dateKey && event.assignedEmployeeId !== 'unassigned').reduce((sum, event) => sum + (event.workers?.length || 0), 0);
                                const vacationCount = getVacationEmployees(dateKey).length;
                                const remainingCount = totalMembers - assignedCount - vacationCount;

                                return (
                                    <div key={index} className={`flex-1 min-w-[140px] h-full border-r border-gray-100 p-1 flex items-center justify-center ${isSaturday ? 'bg-blue-50/30' : isSunday ? 'bg-red-50/30' : 'bg-white'}`}>
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold shadow-sm text-white ${remainingCount > 0 ? 'bg-slate-600' : remainingCount === 0 ? 'bg-slate-400' : 'bg-slate-700'}`}>{remainingCount}人</span>
                                    </div>
                                );
                            })}
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
        </DndContext>
    );
}
