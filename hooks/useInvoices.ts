'use client';

import { useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useFinanceStore } from '@/stores/financeStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { InvoiceInput } from '@/types/invoice';
import { Estimate } from '@/types/estimate';

// Re-export types for backward compatibility
export type { Invoice, InvoiceInput } from '@/types/invoice';

// This hook wraps the Zustand store and handles initialization/realtime
export function useInvoices() {
    const { status } = useSession();

    // Get state from Zustand store
    const invoices = useFinanceStore((state) => state.invoices);
    const isLoading = useFinanceStore((state) => state.invoicesLoading);
    const isInitialized = useFinanceStore((state) => state.invoicesInitialized);

    // Get actions from Zustand store
    const fetchInvoices = useFinanceStore((state) => state.fetchInvoices);
    const addInvoiceStore = useFinanceStore((state) => state.addInvoice);
    const updateInvoiceStore = useFinanceStore((state) => state.updateInvoice);
    const deleteInvoiceStore = useFinanceStore((state) => state.deleteInvoice);
    const getInvoice = useFinanceStore((state) => state.getInvoice);
    const getInvoicesByProject = useFinanceStore((state) => state.getInvoicesByProject);

    // Ensure data is loaded (for lazy loading)
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchInvoices();
        }
    }, [status, isInitialized, fetchInvoices]);

    // Refresh invoices
    const refreshInvoices = useCallback(async () => {
        await fetchInvoices();
    }, [fetchInvoices]);

    // Add invoice wrapper
    const addInvoice = useCallback(async (data: InvoiceInput) => {
        return await addInvoiceStore(data);
    }, [addInvoiceStore]);

    // Update invoice wrapper
    const updateInvoice = useCallback(async (id: string, data: Partial<InvoiceInput>) => {
        await updateInvoiceStore(id, data);
    }, [updateInvoiceStore]);

    // Delete invoice wrapper
    const deleteInvoice = useCallback(async (id: string) => {
        await deleteInvoiceStore(id);
    }, [deleteInvoiceStore]);

    // Create invoice from estimate
    const createInvoiceFromEstimate = useCallback(async (estimate: Estimate) => {
        const invoiceInput: InvoiceInput = {
            projectId: estimate.projectId || '',
            estimateId: estimate.id,
            invoiceNumber: `INV-${Date.now()}`,
            title: estimate.title,
            items: estimate.items,
            subtotal: estimate.subtotal,
            tax: estimate.tax,
            total: estimate.total,
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
            status: 'draft',
            notes: estimate.notes,
        };

        return await addInvoice(invoiceInput);
    }, [addInvoice]);

    // Supabase Realtime subscription
    useRealtimeSubscription({
        table: 'Invoice',
        channelName: 'invoices-changes-zustand',
        onDataChange: refreshInvoices,
        enabled: status === 'authenticated' && isInitialized,
    });

    return {
        invoices,
        isLoading,
        isInitialized,
        ensureDataLoaded,
        addInvoice,
        updateInvoice,
        deleteInvoice,
        getInvoice,
        getInvoicesByProject,
        createInvoiceFromEstimate,
        refreshInvoices,
    };
}
