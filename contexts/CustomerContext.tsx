'use client';

import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Customer, CustomerInput } from '@/types/customer';

interface CustomerContextType {
    customers: Customer[];
    isLoading: boolean;
    addCustomer: (customer: CustomerInput) => Promise<void>;
    updateCustomer: (id: string, customer: Partial<CustomerInput>) => Promise<void>;
    deleteCustomer: (id: string) => Promise<void>;
    getCustomerById: (id: string) => Customer | undefined;
    refreshCustomers: () => Promise<void>;
}

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

export function CustomerProvider({ children }: { children: React.ReactNode }) {
    const { data: session, status } = useSession();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch customers from API
    const fetchCustomers = useCallback(async () => {
        // Skip if not authenticated
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
                // Convert date strings to Date objects
                const parsedCustomers = data.map((customer: any) => ({
                    ...customer,
                    createdAt: new Date(customer.createdAt),
                    updatedAt: new Date(customer.updatedAt),
                }));
                setCustomers(parsedCustomers);
            }
        } catch (error) {
            console.error('Failed to fetch customers:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    // Load customers on mount and when session changes
    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers, session?.user?.email]);

    // Add customer
    const addCustomer = useCallback(async (customerData: CustomerInput) => {
        try {
            const response = await fetch('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(customerData),
            });

            if (response.ok) {
                const newCustomer = await response.json();
                const parsedCustomer = {
                    ...newCustomer,
                    createdAt: new Date(newCustomer.createdAt),
                    updatedAt: new Date(newCustomer.updatedAt),
                };
                setCustomers(prev => [...prev, parsedCustomer]);
            } else {
                const error = await response.json();
                throw new Error(error.error || '顧客の追加に失敗しました');
            }
        } catch (error) {
            console.error('Failed to add customer:', error);
            throw error;
        }
    }, []);

    // Update customer
    const updateCustomer = useCallback(async (id: string, customerData: Partial<CustomerInput>) => {
        try {
            const response = await fetch(`/api/customers/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(customerData),
            });

            if (response.ok) {
                const updatedCustomer = await response.json();
                const parsedCustomer = {
                    ...updatedCustomer,
                    createdAt: new Date(updatedCustomer.createdAt),
                    updatedAt: new Date(updatedCustomer.updatedAt),
                };
                setCustomers(prev => prev.map(c => c.id === id ? parsedCustomer : c));
            } else {
                const error = await response.json();
                throw new Error(error.error || '顧客の更新に失敗しました');
            }
        } catch (error) {
            console.error('Failed to update customer:', error);
            throw error;
        }
    }, []);

    // Delete customer
    const deleteCustomer = useCallback(async (id: string) => {
        try {
            const response = await fetch(`/api/customers/${id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setCustomers(prev => prev.filter(c => c.id !== id));
            } else {
                const error = await response.json();
                throw new Error(error.error || '顧客の削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete customer:', error);
            throw error;
        }
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
