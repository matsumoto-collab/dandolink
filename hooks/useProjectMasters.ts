'use client';

import { useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { ProjectMaster } from '@/types/calendar';

// Re-export types for backward compatibility
export type { ProjectMaster } from '@/types/calendar';

// This hook wraps the Zustand store and handles initialization/realtime
export function useProjectMasters() {
    const { status } = useSession();

    // Get state from Zustand store
    const projectMasters = useCalendarStore((state) => state.projectMasters);
    const isLoading = useCalendarStore((state) => state.projectMastersLoading);
    const error = useCalendarStore((state) => state.projectMastersError);

    // Get actions from Zustand store
    const fetchProjectMastersStore = useCalendarStore((state) => state.fetchProjectMasters);
    const createProjectMasterStore = useCalendarStore((state) => state.createProjectMaster);
    const updateProjectMasterStore = useCalendarStore((state) => state.updateProjectMaster);
    const deleteProjectMasterStore = useCalendarStore((state) => state.deleteProjectMaster);
    const getProjectMasterById = useCalendarStore((state) => state.getProjectMasterById);

    // Initial fetch
    useEffect(() => {
        if (status === 'authenticated') {
            fetchProjectMastersStore();
        }
    }, [status, fetchProjectMastersStore]);

    // Wrapper functions for backward compatibility
    const fetchProjectMasters = useCallback(async (search?: string, statusFilter?: string) => {
        await fetchProjectMastersStore(search, statusFilter);
    }, [fetchProjectMastersStore]);

    const createProjectMaster = useCallback(async (data: Omit<ProjectMaster, 'id' | 'createdAt' | 'updatedAt'>) => {
        return await createProjectMasterStore(data);
    }, [createProjectMasterStore]);

    const updateProjectMaster = useCallback(async (id: string, data: Partial<ProjectMaster>) => {
        return await updateProjectMasterStore(id, data);
    }, [updateProjectMasterStore]);

    const deleteProjectMaster = useCallback(async (id: string) => {
        await deleteProjectMasterStore(id);
    }, [deleteProjectMasterStore]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'ProjectMaster',
        channelName: 'project-masters-changes-zustand',
        onDataChange: () => fetchProjectMastersStore(),
        enabled: status === 'authenticated',
    });

    // Browser event listener for cross-context sync
    useEffect(() => {
        const handleProjectMasterCreated = () => {
            fetchProjectMastersStore();
        };

        window.addEventListener('projectMasterCreated', handleProjectMasterCreated);
        return () => {
            window.removeEventListener('projectMasterCreated', handleProjectMasterCreated);
        };
    }, [fetchProjectMastersStore]);

    return {
        projectMasters,
        isLoading,
        error,
        fetchProjectMasters,
        createProjectMaster,
        updateProjectMaster,
        deleteProjectMaster,
        getProjectMasterById,
    };
}
