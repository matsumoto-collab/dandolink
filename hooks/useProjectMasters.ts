'use client';

import { useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { ProjectMaster } from '@/types/calendar';
import { initBroadcastChannel, onBroadcast } from '@/lib/broadcastChannel';

// Re-export types for backward compatibility
export type { ProjectMaster } from '@/types/calendar';

// This hook wraps the Zustand store and handles initialization/realtime
export function useProjectMasters() {
    const { status } = useSession();

    // Get state from Zustand store
    const projectMasters = useCalendarStore((state) => state.projectMasters);
    const isLoading = useCalendarStore((state) => state.projectMastersLoading);
    const error = useCalendarStore((state) => state.projectMastersError);
    const isInitialized = useCalendarStore((state) => state.projectMastersInitialized);

    // Get actions from Zustand store
    const fetchProjectMastersStore = useCalendarStore((state) => state.fetchProjectMasters);
    const createProjectMasterStore = useCalendarStore((state) => state.createProjectMaster);
    const updateProjectMasterStore = useCalendarStore((state) => state.updateProjectMaster);
    const deleteProjectMasterStore = useCalendarStore((state) => state.deleteProjectMaster);
    const getProjectMasterById = useCalendarStore((state) => state.getProjectMasterById);

    // Initial fetch - only if not already initialized
    useEffect(() => {
        if (status === 'authenticated' && !isInitialized) {
            fetchProjectMastersStore();
        }
    }, [status, isInitialized, fetchProjectMastersStore]);

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

    // Supabase Realtime subscription (WAL fallback)
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

    // Broadcast受信: 別デバイスからの即時通知
    useEffect(() => {
        if (status !== 'authenticated') return;
        initBroadcastChannel();
        const cleanups = [
            onBroadcast('project_master_updated', () => fetchProjectMastersStore()),
            onBroadcast('project_master_deleted', () => fetchProjectMastersStore()),
        ];
        return () => cleanups.forEach(c => c());
    }, [status, fetchProjectMastersStore]);

    return {
        projectMasters,
        isLoading,
        isInitialized,
        error,
        fetchProjectMasters,
        createProjectMaster,
        updateProjectMaster,
        deleteProjectMaster,
        getProjectMasterById,
    };
}
