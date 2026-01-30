'use client';

import { useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { DailyReportInput } from '@/types/dailyReport';

// Re-export types for backward compatibility
export type { DailyReport, DailyReportInput } from '@/types/dailyReport';

// This hook wraps the Zustand store and handles initialization/realtime
export function useDailyReports() {
    const { status } = useSession();

    // Get state from Zustand store
    const dailyReports = useCalendarStore((state) => state.dailyReports);
    const isLoading = useCalendarStore((state) => state.dailyReportsLoading);
    const isInitialLoaded = useCalendarStore((state) => state.dailyReportsInitialized);

    // Get actions from Zustand store
    const fetchDailyReportsStore = useCalendarStore((state) => state.fetchDailyReports);
    const getDailyReportByForemanAndDateStore = useCalendarStore((state) => state.getDailyReportByForemanAndDate);
    const saveDailyReportStore = useCalendarStore((state) => state.saveDailyReport);
    const deleteDailyReportStore = useCalendarStore((state) => state.deleteDailyReport);

    // Initial fetch (past 30 days)
    useEffect(() => {
        if (status === 'authenticated' && !isInitialLoaded) {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            fetchDailyReportsStore({
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
            });
        }
    }, [status, isInitialLoaded, fetchDailyReportsStore]);

    // Wrapper functions for backward compatibility
    const fetchDailyReports = useCallback(async (params?: { foremanId?: string; date?: string; startDate?: string; endDate?: string }) => {
        await fetchDailyReportsStore(params);
    }, [fetchDailyReportsStore]);

    const getDailyReportByForemanAndDate = useCallback((foremanId: string, date: string) => {
        return getDailyReportByForemanAndDateStore(foremanId, date);
    }, [getDailyReportByForemanAndDateStore]);

    const saveDailyReport = useCallback(async (input: DailyReportInput) => {
        return await saveDailyReportStore(input);
    }, [saveDailyReportStore]);

    const deleteDailyReport = useCallback(async (id: string) => {
        await deleteDailyReportStore(id);
    }, [deleteDailyReportStore]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'DailyReport',
        channelName: 'daily-reports-changes-zustand',
        onDataChange: () => fetchDailyReportsStore(),
        enabled: status === 'authenticated' && isInitialLoaded,
    });

    return {
        dailyReports,
        isLoading,
        isInitialLoaded,
        fetchDailyReports,
        getDailyReportByForemanAndDate,
        saveDailyReport,
        deleteDailyReport,
    };
}
