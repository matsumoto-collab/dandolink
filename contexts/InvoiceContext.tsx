'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Invoice, InvoiceInput } from '@/types/invoice';
import { Estimate } from '@/types/estimate';

interface InvoiceContextType {
    invoices: Invoice[];
    isLoading: boolean;
    addInvoice: (invoice: InvoiceInput) => Promise<Invoice>;
    updateInvoice: (id: string, invoice: Partial<InvoiceInput>) => Promise<void>;
    deleteInvoice: (id: string) => Promise<void>;
    getInvoice: (id: string) => Invoice | undefined;
    getInvoicesByProject: (projectId: string) => Invoice[];
    createInvoiceFromEstimate: (estimate: Estimate) => Promise<Invoice>;
    refreshInvoices: () => Promise<void>;
}

const InvoiceContext = createContext<InvoiceContextType | undefined>(undefined);

export function InvoiceProvider({ children }: { children: ReactNode }) {
    const { data: session, status } = useSession();
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch invoices from API
    const fetchInvoices = useCallback(async () => {
        // Skip if not authenticated
        if (status !== 'authenticated') {
            setInvoices([]);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            const response = await fetch('/api/invoices');
            if (response.ok) {
                const data = await response.json();
                // Convert date strings to Date objects
                const parsedInvoices = data.map((invoice: any) => ({
                    ...invoice,
                    dueDate: new Date(invoice.dueDate),
                    paidDate: invoice.paidDate ? new Date(invoice.paidDate) : undefined,
                    createdAt: new Date(invoice.createdAt),
                    updatedAt: new Date(invoice.updatedAt),
                }));
                setInvoices(parsedInvoices);
            }
        } catch (error) {
            console.error('Failed to fetch invoices:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    // Load invoices on mount and when session changes
    useEffect(() => {
        fetchInvoices();
    }, [fetchInvoices, session?.user?.email]);

    const addInvoice = useCallback(async (input: InvoiceInput): Promise<Invoice> => {
        try {
            const response = await fetch('/api/invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (response.ok) {
                const newInvoice = await response.json();
                const parsedInvoice = {
                    ...newInvoice,
                    dueDate: new Date(newInvoice.dueDate),
                    paidDate: newInvoice.paidDate ? new Date(newInvoice.paidDate) : undefined,
                    createdAt: new Date(newInvoice.createdAt),
                    updatedAt: new Date(newInvoice.updatedAt),
                };
                setInvoices(prev => [...prev, parsedInvoice]);
                return parsedInvoice;
            } else {
                const error = await response.json();
                throw new Error(error.error || '請求書の追加に失敗しました');
            }
        } catch (error) {
            console.error('Failed to add invoice:', error);
            throw error;
        }
    }, []);

    const updateInvoice = useCallback(async (id: string, input: Partial<InvoiceInput>) => {
        try {
            const response = await fetch(`/api/invoices/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (response.ok) {
                const updatedInvoice = await response.json();
                const parsedInvoice = {
                    ...updatedInvoice,
                    dueDate: new Date(updatedInvoice.dueDate),
                    paidDate: updatedInvoice.paidDate ? new Date(updatedInvoice.paidDate) : undefined,
                    createdAt: new Date(updatedInvoice.createdAt),
                    updatedAt: new Date(updatedInvoice.updatedAt),
                };
                setInvoices(prev => prev.map(inv => inv.id === id ? parsedInvoice : inv));
            } else {
                const error = await response.json();
                throw new Error(error.error || '請求書の更新に失敗しました');
            }
        } catch (error) {
            console.error('Failed to update invoice:', error);
            throw error;
        }
    }, []);

    const deleteInvoice = useCallback(async (id: string) => {
        try {
            const response = await fetch(`/api/invoices/${id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setInvoices(prev => prev.filter(inv => inv.id !== id));
            } else {
                const error = await response.json();
                throw new Error(error.error || '請求書の削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete invoice:', error);
            throw error;
        }
    }, []);

    const getInvoice = useCallback((id: string) => {
        return invoices.find(inv => inv.id === id);
    }, [invoices]);

    const getInvoicesByProject = useCallback((projectId: string) => {
        return invoices.filter(inv => inv.projectId === projectId);
    }, [invoices]);

    const createInvoiceFromEstimate = useCallback(async (estimate: Estimate): Promise<Invoice> => {
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

    return (
        <InvoiceContext.Provider
            value={{
                invoices,
                isLoading,
                addInvoice,
                updateInvoice,
                deleteInvoice,
                getInvoice,
                getInvoicesByProject,
                createInvoiceFromEstimate,
                refreshInvoices: fetchInvoices,
            }}
        >
            {children}
        </InvoiceContext.Provider>
    );
}

export function useInvoices() {
    const context = useContext(InvoiceContext);
    if (context === undefined) {
        throw new Error('useInvoices must be used within an InvoiceProvider');
    }
    return context;
}
