'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useFinanceStore } from '@/stores/financeStore';
import { CompanyInfoInput } from '@/types/company';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Re-export types for backward compatibility
export type { CompanyInfo, CompanyInfoInput } from '@/types/company';

// This hook wraps the Zustand store and handles initialization/realtime
export function useCompany() {
    const { status } = useSession();
    const [realtimeSetup, setRealtimeSetup] = useState(false);

    // Get state from Zustand store
    const companyInfo = useFinanceStore((state) => state.companyInfo);
    const isLoading = useFinanceStore((state) => state.companyLoading);
    const isInitialized = useFinanceStore((state) => state.companyInitialized);

    // Get actions from Zustand store
    const fetchCompanyInfo = useFinanceStore((state) => state.fetchCompanyInfo);
    const updateCompanyInfoStore = useFinanceStore((state) => state.updateCompanyInfo);

    // Ensure data is loaded (for lazy loading)
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchCompanyInfo();
        }
    }, [status, isInitialized, fetchCompanyInfo]);

    // Refresh company info
    const refreshCompanyInfo = useCallback(async () => {
        await fetchCompanyInfo();
    }, [fetchCompanyInfo]);

    // Update company info wrapper
    const updateCompanyInfo = useCallback(async (data: CompanyInfoInput) => {
        await updateCompanyInfoStore(data);
    }, [updateCompanyInfoStore]);

    // Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated' || !isInitialized || realtimeSetup) return;

        let channel: RealtimeChannel | null = null;
        setRealtimeSetup(true);

        const setupRealtimeSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                channel = supabase
                    .channel('company-info-realtime-zustand')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'CompanyInfo' }, () => {
                        refreshCompanyInfo();
                    })
                    .subscribe();
            } catch (error) {
                console.error('[Realtime] Failed to setup company info subscription:', error);
            }
        };

        setupRealtimeSubscription();

        return () => {
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channelToRemove);
                });
            }
        };
    }, [status, isInitialized, realtimeSetup, refreshCompanyInfo]);

    return {
        companyInfo,
        isLoading,
        isInitialized,
        ensureDataLoaded,
        updateCompanyInfo,
        refreshCompanyInfo,
    };
}
