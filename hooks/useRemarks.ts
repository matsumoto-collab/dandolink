'use client';

import { useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

// This hook wraps the Zustand store and handles initialization/realtime
export function useRemarks() {
    const { status } = useSession();

    // Get state from Zustand store
    const remarks = useCalendarStore((state) => state.remarks);
    const isLoading = useCalendarStore((state) => state.remarksLoading);
    const isInitialized = useCalendarStore((state) => state.remarksInitialized);

    // Get actions from Zustand store
    const fetchRemarks = useCalendarStore((state) => state.fetchRemarks);
    const getRemarkStore = useCalendarStore((state) => state.getRemark);
    const setRemarkStore = useCalendarStore((state) => state.setRemark);

    // Initial fetch
    useEffect(() => {
        if (status === 'authenticated' && !isInitialized) {
            fetchRemarks();
        }
    }, [status, isInitialized, fetchRemarks]);

    // Refresh remarks
    const refreshRemarks = useCallback(async () => {
        await fetchRemarks();
    }, [fetchRemarks]);

    // Wrapper functions for backward compatibility
    const getRemark = useCallback((dateKey: string) => {
        return getRemarkStore(dateKey);
    }, [getRemarkStore]);

    const setRemark = useCallback(async (dateKey: string, text: string) => {
        await setRemarkStore(dateKey, text);
    }, [setRemarkStore]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'CalendarRemark',
        channelName: 'remarks-changes-zustand',
        onDataChange: refreshRemarks,
        enabled: status === 'authenticated' && isInitialized,
    });

    return {
        remarks,
        isLoading,
        getRemark,
        setRemark,
        refreshRemarks,
    };
}
