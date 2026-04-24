'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { useRealtimeSubscription, usePageVisible } from '@/hooks/useRealtimeSubscription';
import { ProjectMaster } from '@/types/calendar';
import { initBroadcastChannel, onBroadcast } from '@/lib/broadcastChannel';

const SYNC_DEBOUNCE_MS = 500;

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

    // デバウンス付きフェッチ: 連続イベントをまとめて1回のフェッチにする
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const debouncedFetch = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
            fetchProjectMastersStore();
        }, SYNC_DEBOUNCE_MS);
    }, [fetchProjectMastersStore]);

    // クリーンアップ
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    // Supabase Realtime subscription (WAL fallback)
    useRealtimeSubscription({
        table: 'ProjectMaster',
        channelName: 'project-masters-changes-zustand',
        onDataChange: () => debouncedFetch(),
        enabled: status === 'authenticated',
    });

    // assignmentsテーブルの変更を監視して配置数をリアルタイム更新
    useRealtimeSubscription({
        table: 'ProjectAssignment',
        channelName: 'assignments-for-pm-count',
        onDataChange: () => debouncedFetch(),
        enabled: status === 'authenticated',
        debounceMs: SYNC_DEBOUNCE_MS,
    });

    // Browser event listener for cross-context sync
    useEffect(() => {
        const handleProjectMasterCreated = () => {
            debouncedFetch();
        };

        window.addEventListener('projectMasterCreated', handleProjectMasterCreated);
        return () => {
            window.removeEventListener('projectMasterCreated', handleProjectMasterCreated);
        };
    }, [debouncedFetch]);

    // Broadcast受信: 別デバイスからの即時通知
    useEffect(() => {
        if (status !== 'authenticated') return;
        initBroadcastChannel();
        const cleanups = [
            onBroadcast('project_master_updated', () => debouncedFetch()),
            onBroadcast('project_master_deleted', () => debouncedFetch()),
        ];
        return () => cleanups.forEach(c => c());
    }, [status, debouncedFetch]);

    // タブが hidden → visible に戻ったら取りこぼしを埋めるため再フェッチ
    // （非表示中は Realtime WebSocket が切断されるため、その間の変更を補完）
    const isVisible = usePageVisible();
    const wasHiddenRef = useRef(false);
    useEffect(() => {
        if (status !== 'authenticated' || !isInitialized) return;
        if (!isVisible) {
            wasHiddenRef.current = true;
            return;
        }
        if (wasHiddenRef.current) {
            wasHiddenRef.current = false;
            debouncedFetch();
        }
    }, [isVisible, status, isInitialized, debouncedFetch]);

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
