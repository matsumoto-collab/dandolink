'use client';

import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Customer, CustomerInput } from '@/types/customer';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

interface CustomerContextType {
    customers: Customer[];
    isLoading: boolean;
    isInitialized: boolean;
    ensureDataLoaded: () => Promise<void>;
    addCustomer: (customer: CustomerInput) => Promise<void>;
    updateCustomer: (id: string, customer: Partial<CustomerInput>) => Promise<void>;
    deleteCustomer: (id: string) => Promise<void>;
    getCustomerById: (id: string) => Customer | undefined;
    refreshCustomers: () => Promise<void>;
}

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

// 日付文字列をDateオブジェクトに変換
function parseCustomerDates(customer: Customer & { createdAt: string | Date; updatedAt: string | Date }): Customer {
    return {
        ...customer,
        createdAt: new Date(customer.createdAt),
        updatedAt: new Date(customer.updatedAt),
    };
}

export function CustomerProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Fetch customers from API
    const fetchCustomers = useCallback(async () => {
        if (status !== 'authenticated') {
            setCustomers([]);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            const response = await fetch('/api/customers');
            if (response.ok) {
                const data = await response.json();
                setCustomers(data.map(parseCustomerDates));
            }
        } catch (error) {
            console.error('Failed to fetch customers:', error);
        } finally {
            setIsLoading(false);
            setIsInitialized(true);
        }
    }, [status]);

    // 遅延読み込み
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchCustomers();
        }
    }, [status, isInitialized, fetchCustomers]);

    // 未認証時はリセット
    useEffect(() => {
        if (status === 'unauthenticated') {
            setCustomers([]);
            setIsInitialized(false);
        }
    }, [status]);

    // Supabase Realtime subscription（共通フック使用）
    useRealtimeSubscription({
        table: 'Customer',
        channelName: 'customers-changes',
        onDataChange: fetchCustomers,
        enabled: status === 'authenticated' && isInitialized,
    });

    // Add customer
    const addCustomer = useCallback(async (customerData: CustomerInput) => {
        const response = await fetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(customerData),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '顧客の追加に失敗しました');
        }

        const newCustomer = await response.json();
        setCustomers(prev => [...prev, parseCustomerDates(newCustomer)]);
    }, []);

    // Update customer
    const updateCustomer = useCallback(async (id: string, customerData: Partial<CustomerInput>) => {
        const response = await fetch(`/api/customers/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(customerData),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '顧客の更新に失敗しました');
        }

        const updated = await response.json();
        setCustomers(prev => prev.map(c => c.id === id ? parseCustomerDates(updated) : c));
    }, []);

    // Delete customer
    const deleteCustomer = useCallback(async (id: string) => {
        const response = await fetch(`/api/customers/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '顧客の削除に失敗しました');
        }

        setCustomers(prev => prev.filter(c => c.id !== id));
    }, []);

    // Get customer by ID
    const getCustomerById = useCallback((id: string) => {
        return customers.find(customer => customer.id === id);
    }, [customers]);

    return (
        <CustomerContext.Provider
            value={{
                customers,
                isLoading,
                isInitialized,
                ensureDataLoaded,
                addCustomer,
                updateCustomer,
                deleteCustomer,
                getCustomerById,
                refreshCustomers: fetchCustomers,
            }}
        >
            {children}
        </CustomerContext.Provider>
    );
}

export function useCustomers() {
    const context = useContext(CustomerContext);
    if (context === undefined) {
        throw new Error('useCustomers must be used within a CustomerProvider');
    }
    return context;
}
