'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { Project, CalendarEvent, CONSTRUCTION_TYPE_COLORS } from '@/types/calendar';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Re-export types for backward compatibility
export type { Project, CalendarEvent, ProjectAssignment, ProjectMaster } from '@/types/calendar';

// This hook wraps the Zustand store and handles initialization/realtime
export function useProjects() {
    const { status } = useSession();
    const [isUpdating, setIsUpdating] = useState(false);
    const isUpdatingRef = useRef(isUpdating);
    isUpdatingRef.current = isUpdating;

    // Get state from Zustand store
    const isLoading = useCalendarStore((state) => state.projectsLoading);
    const isInitialized = useCalendarStore((state) => state.projectsInitialized);

    // Get actions from Zustand store
    const fetchAssignmentsStore = useCalendarStore((state) => state.fetchAssignments);
    const addProjectStore = useCalendarStore((state) => state.addProject);
    const updateProjectStore = useCalendarStore((state) => state.updateProject);
    const updateProjectsStore = useCalendarStore((state) => state.updateProjects);
    const deleteProjectStore = useCalendarStore((state) => state.deleteProject);
    const getProjectByIdStore = useCalendarStore((state) => state.getProjectById);
    const getCalendarEventsStore = useCalendarStore((state) => state.getCalendarEvents);

    // Use ref for date range to avoid callback recreation
    const currentDateRangeRef = useRef<{ start: string; end: string } | null>(null);

    // Reset state when unauthenticated
    useEffect(() => {
        if (status === 'unauthenticated') {
            currentDateRangeRef.current = null;
        }
    }, [status]);

    // Fetch for a specific date range
    const fetchForDateRange = useCallback(async (startDate: Date, endDate: Date) => {
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // Skip if same range is already loaded
        const currentRange = currentDateRangeRef.current;
        if (currentRange?.start === startStr && currentRange?.end === endStr) {
            return;
        }

        currentDateRangeRef.current = { start: startStr, end: endStr };
        await fetchAssignmentsStore(startStr, endStr);
    }, [fetchAssignmentsStore]);

    // Supabase Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: RealtimeChannel | null = null;

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('project_assignments_changes_zustand')
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'ProjectAssignment' },
                        () => {
                            if (!isUpdatingRef.current) {
                                fetchAssignmentsStore();
                            }
                        }
                    )
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'ProjectMaster' },
                        () => {
                            if (!isUpdatingRef.current) {
                                fetchAssignmentsStore();
                            }
                        }
                    )
                    .subscribe();
            } catch (error) {
                console.error('Failed to setup realtime:', error);
            }
        };

        setupRealtime();

        return () => {
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase')
                    .then(({ supabase }) => {
                        supabase.removeChannel(channelToRemove);
                    })
                    .catch(() => {
                        // クリーンアップ時のエラーは無視（コンポーネントは既にアンマウント済み）
                    });
            }
        };
    }, [status, fetchAssignmentsStore]);

    // Wrapper functions for backward compatibility
    const addProject = useCallback(async (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        await addProjectStore(project);
        // Clear cache and refresh
        currentDateRangeRef.current = null;
        await fetchAssignmentsStore();
    }, [addProjectStore, fetchAssignmentsStore]);

    const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
        // リアルタイム購読がfetchを呼ばないよう、先にrefを更新
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            await updateProjectStore(id, updates);
        } finally {
            setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
            }, 500);
        }
    }, [updateProjectStore]);

    const updateProjects = useCallback(async (updates: Array<{ id: string; data: Partial<Project> }>) => {
        // リアルタイム購読がfetchを呼ばないよう、先にrefを更新
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            await updateProjectsStore(updates);
        } finally {
            setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
            }, 500);
        }
    }, [updateProjectsStore]);

    const deleteProject = useCallback(async (id: string) => {
        await deleteProjectStore(id);
    }, [deleteProjectStore]);

    const getProjectById = useCallback((id: string) => {
        return getProjectByIdStore(id);
    }, [getProjectByIdStore]);

    const getCalendarEvents = useCallback((): CalendarEvent[] => {
        return getCalendarEventsStore();
    }, [getCalendarEventsStore]);

    const refreshProjects = useCallback(async () => {
        currentDateRangeRef.current = null;
        await fetchAssignmentsStore();
    }, [fetchAssignmentsStore]);

    // Subscribe to assignments changes to trigger re-renders
    const assignments = useCalendarStore((state) => state.assignments);

    // Get projects from store (now reactive because we subscribe to assignments)
    const projects = assignments.map((a) => {
        // 配置ごとのconstructionTypeを優先、なければProjectMasterから取得
        const constructionType = a.constructionType || a.projectMaster?.constructionType || 'other';
        const color = CONSTRUCTION_TYPE_COLORS[constructionType as keyof typeof CONSTRUCTION_TYPE_COLORS] || CONSTRUCTION_TYPE_COLORS.other;

        return {
            id: a.id,
            title: a.projectMaster?.title || '不明な案件',
            startDate: a.date,
            category: 'construction' as const,
            color,
            description: a.projectMaster?.description,
            location: a.projectMaster?.location,
            customer: a.projectMaster?.customerShortName || a.projectMaster?.customerName,
            workers: a.workers,
            trucks: a.vehicles,
            remarks: a.remarks || a.projectMaster?.remarks,
            constructionType: constructionType as 'assembly' | 'demolition' | 'other',
            assignedEmployeeId: a.assignedEmployeeId,
            sortOrder: a.sortOrder,
            vehicles: a.vehicles,
            meetingTime: a.meetingTime,
            projectMasterId: a.projectMasterId,
            assignmentId: a.id,
            confirmedWorkerIds: a.confirmedWorkerIds,
            confirmedVehicleIds: a.confirmedVehicleIds,
            isDispatchConfirmed: a.isDispatchConfirmed,
            createdBy: a.projectMaster?.createdBy,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
        };
    });

    return {
        projects,
        isLoading,
        isInitialized,
        addProject,
        updateProject,
        updateProjects,
        deleteProject,
        getProjectById,
        getCalendarEvents,
        refreshProjects,
        fetchForDateRange,
    };
}
