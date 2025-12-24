'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Invoice, InvoiceInput } from '@/types/invoice';
import { Estimate } from '@/types/estimate';

interface InvoiceContextType {
    invoices: Invoice[];
    addInvoice: (invoice: InvoiceInput) => Invoice;
    updateInvoice: (id: string, invoice: Partial<InvoiceInput>) => void;
    deleteInvoice: (id: string) => void;
    getInvoice: (id: string) => Invoice | undefined;
    getInvoicesByProject: (projectId: string) => Invoice[];
    createInvoiceFromEstimate: (estimate: Estimate) => Invoice;
}

const InvoiceContext = createContext<InvoiceContextType | undefined>(undefined);

const STORAGE_KEY = 'yusystem_invoices';

export function InvoiceProvider({ children }: { children: ReactNode }) {
    const [invoices, setInvoices] = useState<Invoice[]>([]);

    // Load from LocalStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Convert date strings back to Date objects
                const invoicesWithDates = parsed.map((inv: any) => ({
                    ...inv,
                    dueDate: new Date(inv.dueDate),
                    paidDate: inv.paidDate ? new Date(inv.paidDate) : undefined,
                    createdAt: new Date(inv.createdAt),
                    updatedAt: new Date(inv.updatedAt),
                }));
                setInvoices(invoicesWithDates);
            } catch (error) {
                console.error('Failed to load invoices:', error);
            }
        }
    }, []);

    // Save to LocalStorage whenever invoices change
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
    }, [invoices]);

    const addInvoice = useCallback((input: InvoiceInput): Invoice => {
        const newInvoice: Invoice = {
            ...input,
            id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        setInvoices(prev => [...prev, newInvoice]);
        return newInvoice;
    }, []);

    const updateInvoice = useCallback((id: string, input: Partial<InvoiceInput>) => {
        setInvoices(prev => prev.map(inv =>
            inv.id === id
                ? { ...inv, ...input, updatedAt: new Date() }
                : inv
        ));
    }, []);

    const deleteInvoice = useCallback((id: string) => {
        setInvoices(prev => prev.filter(inv => inv.id !== id));
    }, []);

    const getInvoice = useCallback((id: string) => {
        return invoices.find(inv => inv.id === id);
    }, [invoices]);

    const getInvoicesByProject = useCallback((projectId: string) => {
        return invoices.filter(inv => inv.projectId === projectId);
    }, [invoices]);

    const createInvoiceFromEstimate = useCallback((estimate: Estimate): Invoice => {
        // 見積書から請求書を生成
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30); // 30日後を支払期限に

        const newInvoice: Invoice = {
            id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            projectId: estimate.projectId ?? '',
            estimateId: estimate.id,
            invoiceNumber: `INV-${Date.now()}`,
            title: estimate.title,
            items: estimate.items,
            subtotal: estimate.subtotal,
            tax: estimate.tax,
            total: estimate.total,
            dueDate,
            status: 'draft',
            notes: estimate.notes,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        setInvoices(prev => [...prev, newInvoice]);
        return newInvoice;
    }, []);

    return (
        <InvoiceContext.Provider
            value={{
                invoices,
                addInvoice,
                updateInvoice,
                deleteInvoice,
                getInvoice,
                getInvoicesByProject,
                createInvoiceFromEstimate,
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
