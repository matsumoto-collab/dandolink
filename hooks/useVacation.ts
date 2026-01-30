'use client';

import { useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

// Re-export types for backward compatibility
export type { VacationRecord, VacationData } from '@/types/vacation';

// This hook wraps the Zustand store and handles initialization/realtime
export function useVacation() {
    const { status } = useSession();

    // Get state from Zustand store
    const vacations = useCalendarStore((state) => state.vacations);
    const isLoading = useCalendarStore((state) => state.vacationsLoading);
    const isInitialized = useCalendarStore((state) => state.vacationsInitialized);

    // Get actions from Zustand store
    const fetchVacations = useCalendarStore((state) => state.fetchVacations);
    const getVacationEmployeesStore = useCalendarStore((state) => state.getVacationEmployees);
    const setVacationEmployeesStore = useCalendarStore((state) => state.setVacationEmployees);
    const addVacationEmployeeStore = useCalendarStore((state) => state.addVacationEmployee);
    const removeVacationEmployeeStore = useCalendarStore((state) => state.removeVacationEmployee);
    const getVacationRemarksStore = useCalendarStore((state) => state.getVacationRemarks);
    const setVacationRemarksStore = useCalendarStore((state) => state.setVacationRemarks);

    // Initial fetch
    useEffect(() => {
        if (status === 'authenticated' && !isInitialized) {
            fetchVacations();
        }
    }, [status, isInitialized, fetchVacations]);

    // Refresh vacations
    const refreshVacations = useCallback(async () => {
        await fetchVacations();
    }, [fetchVacations]);

    // Wrapper functions for backward compatibility
    const getVacationEmployees = useCallback((dateKey: string) => {
        return getVacationEmployeesStore(dateKey);
    }, [getVacationEmployeesStore]);

    const setVacationEmployees = useCallback(async (dateKey: string, employeeIds: string[]) => {
        await setVacationEmployeesStore(dateKey, employeeIds);
    }, [setVacationEmployeesStore]);

    const addVacationEmployee = useCallback(async (dateKey: string, employeeId: string) => {
        await addVacationEmployeeStore(dateKey, employeeId);
    }, [addVacationEmployeeStore]);

    const removeVacationEmployee = useCallback(async (dateKey: string, employeeId: string) => {
        await removeVacationEmployeeStore(dateKey, employeeId);
    }, [removeVacationEmployeeStore]);

    // For backward compatibility with VacationContext's getRemarks/setRemarks
    const getRemarks = useCallback((dateKey: string) => {
        return getVacationRemarksStore(dateKey);
    }, [getVacationRemarksStore]);

    const setRemarks = useCallback(async (dateKey: string, remarks: string) => {
        await setVacationRemarksStore(dateKey, remarks);
    }, [setVacationRemarksStore]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'VacationRecord',
        channelName: 'vacations-changes-zustand',
        onDataChange: refreshVacations,
        enabled: status === 'authenticated' && isInitialized,
        debounceMs: 300,
    });

    return {
        vacations,
        isLoading,
        getVacationEmployees,
        setVacationEmployees,
        addVacationEmployee,
        removeVacationEmployee,
        getRemarks,
        setRemarks,
        refreshVacations,
    };
}
