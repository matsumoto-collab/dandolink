'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { VacationRecord } from '@/types/vacation';

interface VacationContextType {
    isLoading: boolean;
    getVacationEmployees: (dateKey: string) => string[];
    setVacationEmployees: (dateKey: string, employeeIds: string[]) => Promise<void>;
    addVacationEmployee: (dateKey: string, employeeId: string) => Promise<void>;
    removeVacationEmployee: (dateKey: string, employeeId: string) => Promise<void>;
    getRemarks: (dateKey: string) => string;
    setRemarks: (dateKey: string, remarks: string) => Promise<void>;
    refreshVacations: () => Promise<void>;
}

const VacationContext = createContext<VacationContextType | undefined>(undefined);

export function VacationProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [vacations, setVacations] = useState<VacationRecord>({});
    const [isLoading, setIsLoading] = useState(true);

    // Fetch from API
    const fetchVacations = useCallback(async () => {
        if (status !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/calendar/vacations');
            if (response.ok) {
                const data = await response.json();
                setVacations(data);
            }
        } catch (error) {
            console.error('Failed to fetch vacations:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    useEffect(() => {
        fetchVacations();
    }, [fetchVacations]);

    // Realtime subscription - simplified to match ProjectContext pattern
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: any = null;
        let debounceTimer: NodeJS.Timeout | null = null;

        const setupRealtimeSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                console.log('[Vacations Realtime] Setting up subscription...');

                channel = supabase
                    .channel('vacations-realtime-v2')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'VacationRecord' }, () => {
                        console.log('[Vacations Realtime] Change detected, fetching data...');
                        // Debounce fetches
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            fetchVacations();
                        }, 300);
                    })
                    .subscribe((status: string) => {
                        console.log('[Vacations Realtime] Subscription status:', status);
                    });
            } catch (error) {
                console.error('[Realtime] Failed to setup vacations subscription:', error);
            }
        };

        setupRealtimeSubscription();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            if (channel) {
                console.log('[Vacations Realtime] Cleaning up subscription...');
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channel);
                });
            }
        };
    }, [status, fetchVacations]);

    const saveVacation = useCallback(async (dateKey: string, employeeIds: string[], remarks: string) => {
        try {
            await fetch('/api/calendar/vacations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateKey, employeeIds, remarks }),
            });
        } catch (error) {
            console.error('Failed to save vacation:', error);
            fetchVacations();
        }
    }, [fetchVacations]);

    const getVacationEmployees = useCallback((dateKey: string): string[] => {
        return vacations[dateKey]?.employeeIds || [];
    }, [vacations]);

    const setVacationEmployees = useCallback(async (dateKey: string, employeeIds: string[]) => {
        const currentRemarks = vacations[dateKey]?.remarks || '';
        setVacations(prev => ({
            ...prev,
            [dateKey]: { employeeIds, remarks: currentRemarks },
        }));
        await saveVacation(dateKey, employeeIds, currentRemarks);
    }, [vacations, saveVacation]);

    const addVacationEmployee = useCallback(async (dateKey: string, employeeId: string) => {
        const current = getVacationEmployees(dateKey);
        if (!current.includes(employeeId)) {
            await setVacationEmployees(dateKey, [...current, employeeId]);
        }
    }, [getVacationEmployees, setVacationEmployees]);

    const removeVacationEmployee = useCallback(async (dateKey: string, employeeId: string) => {
        const current = getVacationEmployees(dateKey);
        await setVacationEmployees(dateKey, current.filter(id => id !== employeeId));
    }, [getVacationEmployees, setVacationEmployees]);

    const getRemarks = useCallback((dateKey: string): string => {
        return vacations[dateKey]?.remarks || '';
    }, [vacations]);

    const setRemarksCallback = useCallback(async (dateKey: string, remarks: string) => {
        const currentEmployees = vacations[dateKey]?.employeeIds || [];
        setVacations(prev => ({
            ...prev,
            [dateKey]: { employeeIds: currentEmployees, remarks },
        }));
        await saveVacation(dateKey, currentEmployees, remarks);
    }, [vacations, saveVacation]);

    return (
        <VacationContext.Provider value={{
            isLoading,
            getVacationEmployees,
            setVacationEmployees,
            addVacationEmployee,
            removeVacationEmployee,
            getRemarks,
            setRemarks: setRemarksCallback,
            refreshVacations: fetchVacations,
        }}>
            {children}
        </VacationContext.Provider>
    );
}

export function useVacation() {
    const context = useContext(VacationContext);
    if (!context) {
        throw new Error('useVacation must be used within VacationProvider');
    }
    return context;
}
