'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { useCalendar } from '@/hooks/useCalendar';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useProjects } from '@/contexts/ProjectContext';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjectMaster } from '@/contexts/ProjectMasterContext';
import { useProjectAssignment } from '@/contexts/ProjectAssignmentContext';
import { mockEmployees, unassignedEmployee } from '@/data/mockEmployees';
import { generateEmployeeRows, formatDateKey } from '@/utils/employeeUtils';
import { convertToProject } from '@/utils/dataMigration';
import CalendarHeader from './CalendarHeader';
import EmployeeRowComponent from './EmployeeRowComponent';
import DraggableEventCard from './DraggableEventCard';
import DroppableCell from './DroppableCell';
import ProjectModal from '../Projects/ProjectModal';
import ProjectSearchModal from '../ProjectSearchModal';
import ProjectAssignmentForm from '../ProjectAssignmentForm';
import RemarksRow from './RemarksRow';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import { CalendarEvent, Project } from '@/types/calendar';
import { ProjectMaster } from '@/types/projectMaster';

export default function WeeklyCalendar() {
    const { projects, addProject, updateProject, updateProjects, deleteProject, getCalendarEvents } = useProjects();
    const { totalMembers } = useMasterData();
    const { getProjectMasterById } = useProjectMaster();
    const { addProjectAssignment } = useProjectAssignment();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalInitialData, setModalInitialData] = useState<Partial<Project>>({});
    const [isMounted, setIsMounted] = useState(false);

    // 新しいモーダルの状態
    const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
    const [isAssignmentFormOpen, setIsAssignmentFormOpen] = useState(false);
    const [selectedMaster, setSelectedMaster] = useState<ProjectMaster | null>(null);
    const [cellContext, setCellContext] = useState<{ employeeId: string; date: Date } | null>(null);

    // クライアントサイドでのみレンダリング
    useEffect(() => {
        setIsMounted(true);
    }, []);

    // 案件をカレンダーイベントに展開
    const events: CalendarEvent[] = useMemo(() => getCalendarEvents(), [getCalendarEvents]);

    const {
        weekDays,
        goToPreviousWeek,
        goToNextWeek,
        goToPreviousDay,
        goToNextDay,
        goToToday,
    } = useCalendar(events);

    const {
        activeId,
        handleDragStart,
        handleDragEnd,
        handleDragOver,
        handleDragCancel,
    } = useDragAndDrop(events, useCallback((updatedEvents: CalendarEvent[]) => {
        // イベント更新時にProjectContextを更新
        // 日付、担当者、sortOrderの変更を検出
        updatedEvents.forEach(updatedEvent => {
            // 組立・解体のサフィックスを除去して元の案件IDを取得
            const projectId = updatedEvent.id.replace(/-assembly$|-demolition$/, '');
            const originalProject = projects.find(p => p.id === projectId);
            if (originalProject) {
                // 変更があった場合に更新
                const hasChanges =
                    originalProject.assignedEmployeeId !== updatedEvent.assignedEmployeeId ||
                    originalProject.startDate.getTime() !== updatedEvent.startDate.getTime() ||
                    originalProject.sortOrder !== updatedEvent.sortOrder;

                if (hasChanges) {
                    // 組立・解体イベントの場合、対応する日程フィールドを更新
                    const updates: Partial<Project> = {
                        assignedEmployeeId: updatedEvent.assignedEmployeeId,
                        sortOrder: updatedEvent.sortOrder,
                    };

                    // 組立イベントの場合
                    if (updatedEvent.id.endsWith('-assembly')) {
                        updates.assemblyStartDate = updatedEvent.startDate;
                        // startDateも更新（案件編集時に正しい日付を表示するため）
                        updates.startDate = updatedEvent.startDate;
                    }
                    // 解体イベントの場合
                    else if (updatedEvent.id.endsWith('-demolition')) {
                        updates.demolitionStartDate = updatedEvent.startDate;
                        // startDateも更新（案件編集時に正しい日付を表示するため）
                        updates.startDate = updatedEvent.startDate;
                    }
                    // 通常のイベント(後方互換性)
                    else {
                        updates.startDate = updatedEvent.startDate;
                    }

                    updateProject(projectId, updates);
                }
            }
        });
    }, [projects, updateProject]));

    // 職長別の行データを生成（各職長1行のみ、ID='1'の備考は除外）
    const employeeRows = useMemo(() => {
        const filteredEmployees = mockEmployees.filter(emp => emp.id !== '1');
        return generateEmployeeRows(filteredEmployees, events, weekDays);
    }, [events, weekDays]);

    // ドラッグ中のイベントを取得
    const activeEvent = useMemo(() => {
        if (!activeId) return null;
        return events.find(event => event.id === activeId);
    }, [activeId, events]);

    // セルクリック時に選択肢を表示
    const handleCellClick = (employeeId: string, date: Date) => {
        setCellContext({ employeeId, date });
        // 既存案件から選択するか、新規作成するかを選択
        const choice = confirm('既存案件から選択しますか?\n\nOK: 既存案件から選択\nキャンセル: 新規作成');

        if (choice) {
            // 既存案件から選択
            setIsSearchModalOpen(true);
        } else {
            // 新規作成
            setModalInitialData({
                startDate: date,
                assignedEmployeeId: employeeId,
            });
            setIsModalOpen(true);
        }
    };

    // 案件マスターを選択したら割り当てフォームを開く
    const handleSelectMaster = (master: ProjectMaster) => {
        setSelectedMaster(master);
        setIsAssignmentFormOpen(true);
    };

    // 案件割り当てを保存
    const handleSaveAssignment = (assignment: any) => {
        // 案件割り当てを追加
        const newAssignment = addProjectAssignment(assignment);

        // カレンダー表示用にProject形式に変換
        if (selectedMaster) {
            const project = convertToProject(selectedMaster, newAssignment);
            addProject(project);
        }

        // モーダルを閉じる
        setIsAssignmentFormOpen(false);
        setSelectedMaster(null);
        setCellContext(null);
    };

    // イベントクリック時に編集モーダルを開く
    const handleEventClick = (eventId: string) => {
        // 組立・解体のサフィックスを除去して元の案件IDを取得
        const projectId = eventId.replace(/-assembly$|-demolition$/, '');
        const project = projects.find(p => p.id === projectId);
        if (project) {
            setModalInitialData(project);
            setIsModalOpen(true);
        }
    };

    // モーダルから案件を保存
    const handleSaveProject = (projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (modalInitialData.id) {
            // 既存案件を更新
            updateProject(modalInitialData.id, projectData);
        } else {
            // 新規案件を追加
            addProject(projectData);
        }
    };

    // 矢印ボタンでイベントを上下に移動
    const handleMoveEvent = useCallback((eventId: string, direction: 'up' | 'down') => {
        console.log('handleMoveEvent called:', eventId, direction);

        // 組立・解体のサフィックスを除去して元の案件IDを取得
        const projectId = eventId.replace(/-assembly$|-demolition$/, '');
        const event = projects.find(p => p.id === projectId);
        if (!event) {
            console.log('Event not found:', projectId);
            return;
        }

        console.log('Event found:', event);

        // 同じセル内のイベントを取得
        const cellEvents = projects.filter(p =>
            p.assignedEmployeeId === event.assignedEmployeeId &&
            formatDateKey(p.startDate) === formatDateKey(event.startDate)
        ).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        console.log('Cell events:', cellEvents);

        const currentIndex = cellEvents.findIndex(e => e.id === projectId);
        if (currentIndex === -1) {
            console.log('Current index not found');
            return;
        }

        console.log('Current index:', currentIndex);

        // 移動先のインデックスを計算
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= cellEvents.length) {
            console.log('Target index out of bounds:', targetIndex);
            return;
        }

        console.log('Target index:', targetIndex);

        // 配列を入れ替えて、全イベントのsortOrderを再設定
        const newOrder = [...cellEvents];
        [newOrder[currentIndex], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[currentIndex]];

        console.log('New order:', newOrder.map(e => e.title));

        // 全イベントのsortOrderを一括更新
        const updates = newOrder.map((evt, index) => ({
            id: evt.id,
            data: { sortOrder: index }
        }));

        console.log('Batch updating:', updates);
        updateProjects(updates);

        console.log('Update complete');
    }, [projects, updateProjects]);

    // サーバーサイドレンダリング時はローディング表示
    if (!isMounted) {
        return (
            <div className="h-full flex items-center justify-center bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="text-gray-500">読み込み中...</div>
            </div>
        );
    }

    return (
        <DndContext
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <div className="h-full flex flex-col bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
                {/* ヘッダー */}
                <CalendarHeader
                    weekDays={weekDays}
                    onPreviousWeek={goToPreviousWeek}
                    onNextWeek={goToNextWeek}
                    onPreviousDay={goToPreviousDay}
                    onNextDay={goToNextDay}
                    onToday={goToToday}
                />

                {/* カレンダーグリッド */}
                <div className="flex-1 overflow-auto bg-gradient-to-br from-slate-50 via-white to-slate-50">
                    <div className="flex flex-col min-w-full h-full">
                        {/* ヘッダー行: 日付と曜日 */}
                        <div className="flex border-b-2 border-slate-300 bg-gradient-to-r from-slate-100 to-slate-50 sticky top-0 z-20 shadow-md">
                            {/* 職長カラム（固定） */}
                            <div className="sticky left-0 z-30 bg-gradient-to-r from-slate-100 to-slate-50 border-r-2 border-slate-300 shadow-md">
                                <div className="w-32 h-12 flex items-center justify-center font-bold text-slate-700 text-sm tracking-wide">
                                    職長
                                </div>
                            </div>

                            {/* 日付カラム */}
                            {weekDays.map((day, index) => {
                                const dayOfWeekString = getDayOfWeekString(day.date, 'short');
                                const dateString = formatDate(day.date, 'day');
                                const isSaturday = day.dayOfWeek === 6;
                                const isSunday = day.dayOfWeek === 0;

                                return (
                                    <div
                                        key={index}
                                        className={`
                      flex-1 min-w-[140px] border-r border-slate-300
                      ${isSaturday ? 'bg-gradient-to-b from-blue-100 to-blue-50' : isSunday ? 'bg-gradient-to-b from-rose-100 to-rose-50' : 'bg-gradient-to-b from-slate-100 to-slate-50'}
                    `}
                                    >
                                        <div className="h-6 flex items-center justify-center text-xs font-bold text-slate-700">
                                            {dateString}
                                        </div>
                                        <div
                                            className={`
                        h-6 flex items-center justify-center text-xs border-t border-slate-200
                        ${isSaturday ? 'text-blue-700 font-bold' : isSunday ? 'text-rose-700 font-bold' : 'text-slate-700 font-semibold'}
                        ${day.isToday ? 'bg-gradient-to-r from-slate-700 to-slate-600 text-white font-bold shadow-lg shadow-slate-900/30' : ''}
                      `}
                                        >
                                            {dayOfWeekString}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ボディ行: 未割り当て行（残り人数）を一番上に配置 */}
                        <div className="flex border-b-2 border-slate-400 bg-gradient-to-r from-slate-100 to-slate-50 sticky top-[49px] z-[25] shadow-sm h-10">
                            {/* 職長セル */}
                            <div className="sticky left-0 z-30 bg-gradient-to-r from-slate-100 to-slate-50 border-r-2 border-slate-400 shadow-md">
                                <div className="w-32 h-full flex items-center justify-center">
                                    <span className="text-sm font-bold text-slate-700 tracking-wide">
                                        {unassignedEmployee.name}
                                    </span>
                                </div>
                            </div>

                            {/* 日付セル */}
                            {weekDays.map((day, index) => {
                                const dateKey = formatDateKey(day.date);
                                const isSaturday = day.dayOfWeek === 6;
                                const isSunday = day.dayOfWeek === 0;

                                // この日に割り当てられている人数を計算
                                const assignedCount = events
                                    .filter(event =>
                                        formatDateKey(event.startDate) === dateKey &&
                                        event.assignedEmployeeId !== 'unassigned'
                                    )
                                    .reduce((sum, event) => sum + (event.workers?.length || 0), 0);

                                // 残り人数 = 総メンバー数 - 割り当て済み人数
                                const remainingCount = totalMembers - assignedCount;

                                return (
                                    <div
                                        key={index}
                                        className={`
                                            flex-1 min-w-[140px] h-full border-r border-gray-100 p-1
                                            flex items-center justify-center
                                            ${isSaturday ? 'bg-blue-50/30' : isSunday ? 'bg-red-50/30' : 'bg-white'}
                                        `}
                                    >
                                        {remainingCount > 0 ? (
                                            <span className="inline-block px-3 py-1 bg-slate-600 text-white rounded-full text-sm font-bold shadow-sm">
                                                {remainingCount}人
                                            </span>
                                        ) : remainingCount === 0 ? (
                                            <span className="inline-block px-3 py-1 bg-slate-400 text-white rounded-full text-sm font-bold shadow-sm">
                                                0人
                                            </span>
                                        ) : (
                                            <span className="inline-block px-3 py-1 bg-slate-700 text-white rounded-full text-sm font-bold shadow-sm">
                                                {remainingCount}人
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* 備考行 */}
                        <RemarksRow weekDays={weekDays} />

                        {/* 各職長のイベント */}
                        <div className="flex-1 flex flex-col">
                            {employeeRows.map((row) => (
                                <EmployeeRowComponent
                                    key={row.employeeId}
                                    row={row}
                                    weekDays={weekDays}
                                    showEmployeeName={true}
                                    onEventClick={handleEventClick}
                                    onCellClick={handleCellClick}
                                    onMoveEvent={handleMoveEvent}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* ドラッグオーバーレイ */}
            <DragOverlay>
                {activeEvent ? (
                    <div className="opacity-90">
                        <DraggableEventCard event={activeEvent} />
                    </div>
                ) : null}
            </DragOverlay>

            {/* 案件登録・編集モーダル */}
            <ProjectModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setModalInitialData({});
                }}
                onSubmit={handleSaveProject}
                onDelete={deleteProject}
                initialData={modalInitialData.id ? modalInitialData : undefined}
                defaultDate={modalInitialData.startDate}
                defaultEmployeeId={modalInitialData.assignedEmployeeId}
                title={modalInitialData.id ? '案件編集' : '案件登録'}
            />

            {/* 案件検索モーダル */}
            <ProjectSearchModal
                isOpen={isSearchModalOpen}
                onClose={() => {
                    setIsSearchModalOpen(false);
                    setCellContext(null);
                }}
                onSelect={handleSelectMaster}
            />

            {/* 案件割り当てフォーム */}
            {selectedMaster && cellContext && (
                <ProjectAssignmentForm
                    isOpen={isAssignmentFormOpen}
                    onClose={() => {
                        setIsAssignmentFormOpen(false);
                        setSelectedMaster(null);
                        setCellContext(null);
                    }}
                    onSave={handleSaveAssignment}
                    projectMaster={selectedMaster}
                    preselectedLeaderId={cellContext.employeeId}
                    preselectedDate={cellContext.date.toISOString().split('T')[0]}
                />
            )}
        </DndContext>
    );
}
