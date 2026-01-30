'use client';

import { useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useFinanceStore } from '@/stores/financeStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { EstimateInput } from '@/types/estimate';

// Re-export types for backward compatibility
export type { Estimate, EstimateInput } from '@/types/estimate';

// This hook wraps the Zustand store and handles initialization/realtime
export function useEstimates() {
    const { status } = useSession();

    // Get state from Zustand store
    const estimates = useFinanceStore((state) => state.estimates);
    const isLoading = useFinanceStore((state) => state.estimatesLoading);
    const isInitialized = useFinanceStore((state) => state.estimatesInitialized);

    // Get actions from Zustand store
    const fetchEstimates = useFinanceStore((state) => state.fetchEstimates);
    const addEstimateStore = useFinanceStore((state) => state.addEstimate);
    const updateEstimateStore = useFinanceStore((state) => state.updateEstimate);
    const deleteEstimateStore = useFinanceStore((state) => state.deleteEstimate);
    const getEstimate = useFinanceStore((state) => state.getEstimate);
    const getEstimatesByProject = useFinanceStore((state) => state.getEstimatesByProject);

    // Ensure data is loaded (for lazy loading)
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchEstimates();
        }
    }, [status, isInitialized, fetchEstimates]);

    // Refresh estimates
    const refreshEstimates = useCallback(async () => {
        await fetchEstimates();
    }, [fetchEstimates]);

    // Add estimate wrapper
    const addEstimate = useCallback(async (data: EstimateInput) => {
        return await addEstimateStore(data);
    }, [addEstimateStore]);

    // Update estimate wrapper
    const updateEstimate = useCallback(async (id: string, data: Partial<EstimateInput>) => {
        await updateEstimateStore(id, data);
    }, [updateEstimateStore]);

    // Delete estimate wrapper
    const deleteEstimate = useCallback(async (id: string) => {
        await deleteEstimateStore(id);
    }, [deleteEstimateStore]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'Estimate',
        channelName: 'estimates-changes-zustand',
        onDataChange: refreshEstimates,
        enabled: status === 'authenticated' && isInitialized,
    });

    return {
        estimates,
        isLoading,
        isInitialized,
        ensureDataLoaded,
        addEstimate,
        updateEstimate,
        deleteEstimate,
        getEstimate,
        getEstimatesByProject,
        refreshEstimates,
    };
}
