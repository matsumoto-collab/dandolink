'use client';

import { useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useFinanceStore } from '@/stores/financeStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { CustomerInput } from '@/types/customer';

// Re-export types for backward compatibility
export type { Customer, CustomerInput } from '@/types/customer';

// This hook wraps the Zustand store and handles initialization/realtime
export function useCustomers() {
    const { status } = useSession();

    // Get state from Zustand store
    const customers = useFinanceStore((state) => state.customers);
    const isLoading = useFinanceStore((state) => state.customersLoading);
    const isInitialized = useFinanceStore((state) => state.customersInitialized);

    // Get actions from Zustand store
    const fetchCustomers = useFinanceStore((state) => state.fetchCustomers);
    const addCustomerStore = useFinanceStore((state) => state.addCustomer);
    const updateCustomerStore = useFinanceStore((state) => state.updateCustomer);
    const deleteCustomerStore = useFinanceStore((state) => state.deleteCustomer);
    const getCustomerById = useFinanceStore((state) => state.getCustomerById);

    // Ensure data is loaded (for lazy loading)
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchCustomers();
        }
    }, [status, isInitialized, fetchCustomers]);

    // Refresh customers
    const refreshCustomers = useCallback(async () => {
        await fetchCustomers();
    }, [fetchCustomers]);

    // Add customer wrapper
    const addCustomer = useCallback(async (data: CustomerInput) => {
        await addCustomerStore(data);
    }, [addCustomerStore]);

    // Update customer wrapper
    const updateCustomer = useCallback(async (id: string, data: Partial<CustomerInput>) => {
        await updateCustomerStore(id, data);
    }, [updateCustomerStore]);

    // Delete customer wrapper
    const deleteCustomer = useCallback(async (id: string) => {
        await deleteCustomerStore(id);
    }, [deleteCustomerStore]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'Customer',
        channelName: 'customers-changes-zustand',
        onDataChange: refreshCustomers,
        enabled: status === 'authenticated' && isInitialized,
    });

    return {
        customers,
        isLoading,
        isInitialized,
        ensureDataLoaded,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        getCustomerById,
        refreshCustomers,
    };
}
