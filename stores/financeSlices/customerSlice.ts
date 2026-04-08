import { Customer, CustomerInput } from '@/types/customer';
import { logger } from '@/lib/logger';
import { FinanceSlice, FinanceState, FinanceActions } from './types';

function parseCustomerDates(customer: Customer & { createdAt: string | Date; updatedAt: string | Date }): Customer {
    return {
        ...customer,
        createdAt: new Date(customer.createdAt),
        updatedAt: new Date(customer.updatedAt),
    };
}

type CustomerSlice = Pick<FinanceState, 'customers' | 'customersLoading' | 'customersInitialized'> &
    Pick<FinanceActions, 'fetchCustomers' | 'addCustomer' | 'updateCustomer' | 'deleteCustomer' | 'getCustomerById'>;

export const createCustomerSlice: FinanceSlice<CustomerSlice> = (set, get) => ({
    customers: [],
    customersLoading: false,
    customersInitialized: false,

    fetchCustomers: async () => {
        if (get().customersLoading) return;

        set({ customersLoading: true });
        try {
            const response = await fetch('/api/customers');
            if (response.ok) {
                const data = await response.json();
                set({
                    customers: data.map(parseCustomerDates),
                    customersInitialized: true,
                });
            }
        } catch (error) {
            logger.error('Failed to fetch customers:', error);
        } finally {
            set({ customersLoading: false });
        }
    },

    addCustomer: async (data: CustomerInput) => {
        const response = await fetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '顧客の追加に失敗しました');
        }

        const newCustomer = await response.json();
        set((state) => ({
            customers: [...state.customers, parseCustomerDates(newCustomer)],
        }));
    },

    updateCustomer: async (id: string, data: Partial<CustomerInput>) => {
        const response = await fetch(`/api/customers/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '顧客の更新に失敗しました');
        }

        const updated = await response.json();
        set((state) => ({
            customers: state.customers.map((c) => (c.id === id ? parseCustomerDates(updated) : c)),
        }));
    },

    deleteCustomer: async (id: string) => {
        const response = await fetch(`/api/customers/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '顧客の削除に失敗しました');
        }

        set((state) => ({
            customers: state.customers.filter((c) => c.id !== id),
        }));
    },

    getCustomerById: (id: string) => get().customers.find((c) => c.id === id),
});
