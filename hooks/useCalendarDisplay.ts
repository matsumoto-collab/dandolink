'use client';

import { useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';

// This hook wraps the Zustand store and handles initialization
export function useCalendarDisplay() {
    const { status } = useSession();

    // Get state from Zustand store
    const displayedForemanIds = useCalendarStore((state) => state.displayedForemanIds);
    const allForemen = useCalendarStore((state) => state.allForemen);
    const isLoading = useCalendarStore((state) => state.foremanSettingsLoading);
    const isInitialized = useCalendarStore((state) => state.foremanSettingsInitialized);

    // Get actions from Zustand store
    const fetchForemen = useCalendarStore((state) => state.fetchForemen);
    const fetchForemanSettings = useCalendarStore((state) => state.fetchForemanSettings);
    const addForemanStore = useCalendarStore((state) => state.addForeman);
    const removeForemanStore = useCalendarStore((state) => state.removeForeman);
    const moveForemanStore = useCalendarStore((state) => state.moveForeman);
    const getAvailableForemenStore = useCalendarStore((state) => state.getAvailableForemen);
    const getForemanNameStore = useCalendarStore((state) => state.getForemanName);
    const initializeForemenFromAll = useCalendarStore((state) => state.initializeForemenFromAll);

    // Initial fetch (並列実行)
    useEffect(() => {
        if (status === 'authenticated' && !isInitialized) {
            Promise.all([fetchForemen(), fetchForemanSettings()]);
        }
    }, [status, isInitialized, fetchForemen, fetchForemanSettings]);

    // 設定未登録ユーザーは全職長をデフォルト表示
    useEffect(() => {
        if (isInitialized && displayedForemanIds.length === 0 && allForemen.length > 0) {
            initializeForemenFromAll();
        }
    }, [isInitialized, displayedForemanIds.length, allForemen.length, initializeForemenFromAll]);

    // Wrapper functions for backward compatibility
    const addForeman = useCallback(async (employeeId: string) => {
        await addForemanStore(employeeId);
    }, [addForemanStore]);

    const removeForeman = useCallback(async (employeeId: string) => {
        await removeForemanStore(employeeId);
    }, [removeForemanStore]);

    const moveForeman = useCallback(async (employeeId: string, direction: 'up' | 'down') => {
        await moveForemanStore(employeeId, direction);
    }, [moveForemanStore]);

    const getAvailableForemen = useCallback(() => {
        return getAvailableForemenStore();
    }, [getAvailableForemenStore]);

    const getForemanName = useCallback((id: string) => {
        return getForemanNameStore(id);
    }, [getForemanNameStore]);

    return {
        displayedForemanIds,
        allForemen,
        isLoading,
        addForeman,
        removeForeman,
        moveForeman,
        getAvailableForemen,
        getForemanName,
    };
}
