'use client';

import { useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useFinanceStore } from '@/stores/financeStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { UnitPriceMasterInput } from '@/types/unitPrice';

// Re-export types for backward compatibility
export type { UnitPriceMaster, UnitPriceMasterInput } from '@/types/unitPrice';

// This hook wraps the Zustand store and handles initialization/realtime
export function useUnitPriceMaster() {
    const { status } = useSession();

    // Get state from Zustand store
    const unitPrices = useFinanceStore((state) => state.unitPrices);
    const isLoading = useFinanceStore((state) => state.unitPricesLoading);
    const isInitialized = useFinanceStore((state) => state.unitPricesInitialized);

    // Get actions from Zustand store
    const fetchUnitPrices = useFinanceStore((state) => state.fetchUnitPrices);
    const addUnitPriceStore = useFinanceStore((state) => state.addUnitPrice);
    const updateUnitPriceStore = useFinanceStore((state) => state.updateUnitPrice);
    const deleteUnitPriceStore = useFinanceStore((state) => state.deleteUnitPrice);
    const getUnitPriceById = useFinanceStore((state) => state.getUnitPriceById);
    const getUnitPricesByTemplate = useFinanceStore((state) => state.getUnitPricesByTemplate);

    // Ensure data is loaded (for lazy loading)
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchUnitPrices();
        }
    }, [status, isInitialized, fetchUnitPrices]);

    // Refresh unit prices
    const refreshUnitPrices = useCallback(async () => {
        await fetchUnitPrices();
    }, [fetchUnitPrices]);

    // Add unit price wrapper
    const addUnitPrice = useCallback(async (data: UnitPriceMasterInput) => {
        await addUnitPriceStore(data);
    }, [addUnitPriceStore]);

    // Update unit price wrapper
    const updateUnitPrice = useCallback(async (id: string, data: Partial<UnitPriceMasterInput>) => {
        await updateUnitPriceStore(id, data);
    }, [updateUnitPriceStore]);

    // Delete unit price wrapper
    const deleteUnitPrice = useCallback(async (id: string) => {
        await deleteUnitPriceStore(id);
    }, [deleteUnitPriceStore]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'UnitPriceMaster',
        channelName: 'unit-prices-changes-zustand',
        onDataChange: refreshUnitPrices,
        enabled: status === 'authenticated' && isInitialized,
    });

    return {
        unitPrices,
        isLoading,
        isInitialized,
        ensureDataLoaded,
        addUnitPrice,
        updateUnitPrice,
        deleteUnitPrice,
        getUnitPriceById,
        getUnitPricesByTemplate,
        refreshUnitPrices,
    };
}
