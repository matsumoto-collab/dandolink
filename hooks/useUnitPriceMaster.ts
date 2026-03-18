'use client';

import { useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useFinanceStore } from '@/stores/financeStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { UnitPriceMasterInput, UnitPriceTemplateInput, UnitPriceCategoryInput } from '@/types/unitPrice';

// Re-export types for backward compatibility
export type { UnitPriceMaster, UnitPriceMasterInput, UnitPriceTemplate, UnitPriceTemplateInput, UnitPriceCategory, UnitPriceCategoryInput } from '@/types/unitPrice';

// This hook wraps the Zustand store and handles initialization/realtime
export function useUnitPriceMaster() {
    const { status } = useSession();

    // Get state from Zustand store
    const unitPrices = useFinanceStore((state) => state.unitPrices);
    const isLoading = useFinanceStore((state) => state.unitPricesLoading);
    const isInitialized = useFinanceStore((state) => state.unitPricesInitialized);

    const unitPriceTemplates = useFinanceStore((state) => state.unitPriceTemplates);
    const unitPriceTemplatesInitialized = useFinanceStore((state) => state.unitPriceTemplatesInitialized);

    const unitPriceCategories = useFinanceStore((state) => state.unitPriceCategories);
    const unitPriceCategoriesInitialized = useFinanceStore((state) => state.unitPriceCategoriesInitialized);

    // Get actions from Zustand store
    const fetchUnitPrices = useFinanceStore((state) => state.fetchUnitPrices);
    const addUnitPriceStore = useFinanceStore((state) => state.addUnitPrice);
    const updateUnitPriceStore = useFinanceStore((state) => state.updateUnitPrice);
    const deleteUnitPriceStore = useFinanceStore((state) => state.deleteUnitPrice);
    const getUnitPriceById = useFinanceStore((state) => state.getUnitPriceById);
    const getUnitPricesByTemplate = useFinanceStore((state) => state.getUnitPricesByTemplate);

    const fetchUnitPriceTemplates = useFinanceStore((state) => state.fetchUnitPriceTemplates);
    const addUnitPriceTemplateStore = useFinanceStore((state) => state.addUnitPriceTemplate);
    const updateUnitPriceTemplateStore = useFinanceStore((state) => state.updateUnitPriceTemplate);
    const deleteUnitPriceTemplateStore = useFinanceStore((state) => state.deleteUnitPriceTemplate);

    const fetchUnitPriceCategories = useFinanceStore((state) => state.fetchUnitPriceCategories);
    const addUnitPriceCategoryStore = useFinanceStore((state) => state.addUnitPriceCategory);
    const updateUnitPriceCategoryStore = useFinanceStore((state) => state.updateUnitPriceCategory);
    const deleteUnitPriceCategoryStore = useFinanceStore((state) => state.deleteUnitPriceCategory);

    // Ensure data is loaded (for lazy loading)
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated') {
            const promises: Promise<void>[] = [];
            if (!isInitialized) promises.push(fetchUnitPrices());
            if (!unitPriceTemplatesInitialized) promises.push(fetchUnitPriceTemplates());
            if (!unitPriceCategoriesInitialized) promises.push(fetchUnitPriceCategories());
            if (promises.length > 0) await Promise.all(promises);
        }
    }, [status, isInitialized, unitPriceTemplatesInitialized, unitPriceCategoriesInitialized, fetchUnitPrices, fetchUnitPriceTemplates, fetchUnitPriceCategories]);

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

    // Template wrappers
    const addUnitPriceTemplate = useCallback(async (data: UnitPriceTemplateInput) => {
        await addUnitPriceTemplateStore(data);
    }, [addUnitPriceTemplateStore]);

    const updateUnitPriceTemplate = useCallback(async (id: string, data: Partial<UnitPriceTemplateInput>) => {
        await updateUnitPriceTemplateStore(id, data);
    }, [updateUnitPriceTemplateStore]);

    const deleteUnitPriceTemplate = useCallback(async (id: string) => {
        await deleteUnitPriceTemplateStore(id);
    }, [deleteUnitPriceTemplateStore]);

    // Category wrappers
    const addUnitPriceCategory = useCallback(async (data: UnitPriceCategoryInput) => {
        await addUnitPriceCategoryStore(data);
    }, [addUnitPriceCategoryStore]);

    const updateUnitPriceCategory = useCallback(async (id: string, data: Partial<UnitPriceCategoryInput>) => {
        await updateUnitPriceCategoryStore(id, data);
    }, [updateUnitPriceCategoryStore]);

    const deleteUnitPriceCategory = useCallback(async (id: string) => {
        await deleteUnitPriceCategoryStore(id);
    }, [deleteUnitPriceCategoryStore]);

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
        // Templates
        unitPriceTemplates,
        addUnitPriceTemplate,
        updateUnitPriceTemplate,
        deleteUnitPriceTemplate,
        // Categories
        unitPriceCategories,
        addUnitPriceCategory,
        updateUnitPriceCategory,
        deleteUnitPriceCategory,
    };
}
