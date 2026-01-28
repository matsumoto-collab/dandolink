import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { CompanyInfo, CompanyInfoInput } from '@/types/company';
import { Customer, CustomerInput } from '@/types/customer';
import { Estimate, EstimateInput } from '@/types/estimate';
import { Invoice, InvoiceInput } from '@/types/invoice';

// Helper to parse dates
function parseCustomerDates(customer: Customer & { createdAt: string | Date; updatedAt: string | Date }): Customer {
    return {
        ...customer,
        createdAt: new Date(customer.createdAt),
        updatedAt: new Date(customer.updatedAt),
    };
}

function parseEstimateDates(estimate: Estimate & { validUntil: string | Date; createdAt: string | Date; updatedAt: string | Date }): Estimate {
    return {
        ...estimate,
        validUntil: new Date(estimate.validUntil),
        createdAt: new Date(estimate.createdAt),
        updatedAt: new Date(estimate.updatedAt),
    };
}

function parseInvoiceDates(invoice: Invoice & { dueDate: string | Date; paidDate?: string | Date | null; createdAt: string | Date; updatedAt: string | Date }): Invoice {
    return {
        ...invoice,
        dueDate: new Date(invoice.dueDate),
        paidDate: invoice.paidDate ? new Date(invoice.paidDate) : undefined,
        createdAt: new Date(invoice.createdAt),
        updatedAt: new Date(invoice.updatedAt),
    };
}

interface FinanceState {
    // Company
    companyInfo: CompanyInfo | null;
    companyLoading: boolean;
    companyInitialized: boolean;

    // Customers
    customers: Customer[];
    customersLoading: boolean;
    customersInitialized: boolean;

    // Estimates
    estimates: Estimate[];
    estimatesLoading: boolean;
    estimatesInitialized: boolean;

    // Invoices
    invoices: Invoice[];
    invoicesLoading: boolean;
    invoicesInitialized: boolean;
}

interface FinanceActions {
    // Company
    fetchCompanyInfo: () => Promise<void>;
    updateCompanyInfo: (data: CompanyInfoInput) => Promise<void>;

    // Customers
    fetchCustomers: () => Promise<void>;
    addCustomer: (data: CustomerInput) => Promise<void>;
    updateCustomer: (id: string, data: Partial<CustomerInput>) => Promise<void>;
    deleteCustomer: (id: string) => Promise<void>;
    getCustomerById: (id: string) => Customer | undefined;

    // Estimates
    fetchEstimates: () => Promise<void>;
    addEstimate: (data: EstimateInput) => Promise<Estimate>;
    updateEstimate: (id: string, data: Partial<EstimateInput>) => Promise<void>;
    deleteEstimate: (id: string) => Promise<void>;
    getEstimate: (id: string) => Estimate | undefined;
    getEstimatesByProject: (projectId: string) => Estimate[];

    // Invoices
    fetchInvoices: () => Promise<void>;
    addInvoice: (data: InvoiceInput) => Promise<Invoice>;
    updateInvoice: (id: string, data: Partial<InvoiceInput>) => Promise<void>;
    deleteInvoice: (id: string) => Promise<void>;
    getInvoice: (id: string) => Invoice | undefined;

    // Reset
    reset: () => void;
}

type FinanceStore = FinanceState & FinanceActions;

const initialState: FinanceState = {
    companyInfo: null,
    companyLoading: false,
    companyInitialized: false,
    customers: [],
    customersLoading: false,
    customersInitialized: false,
    estimates: [],
    estimatesLoading: false,
    estimatesInitialized: false,
    invoices: [],
    invoicesLoading: false,
    invoicesInitialized: false,
};

export const useFinanceStore = create<FinanceStore>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        // ========== Company ==========
        fetchCompanyInfo: async () => {
            if (get().companyLoading) return;

            set({ companyLoading: true });
            try {
                const response = await fetch('/api/master-data/company');
                if (response.ok) {
                    const data = await response.json();
                    set({
                        companyInfo: {
                            ...data,
                            createdAt: new Date(data.createdAt),
                            updatedAt: new Date(data.updatedAt),
                        },
                        companyInitialized: true,
                    });
                }
            } catch (error) {
                console.error('Failed to fetch company info:', error);
            } finally {
                set({ companyLoading: false });
            }
        },

        updateCompanyInfo: async (data: CompanyInfoInput) => {
            const response = await fetch('/api/master-data/company', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (response.ok) {
                const updated = await response.json();
                set({
                    companyInfo: {
                        ...updated,
                        createdAt: new Date(updated.createdAt),
                        updatedAt: new Date(updated.updatedAt),
                    },
                });
            }
        },

        // ========== Customers ==========
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
                console.error('Failed to fetch customers:', error);
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

        // ========== Estimates ==========
        fetchEstimates: async () => {
            if (get().estimatesLoading) return;

            set({ estimatesLoading: true });
            try {
                const response = await fetch('/api/estimates');
                if (response.ok) {
                    const data = await response.json();
                    set({
                        estimates: data.map(parseEstimateDates),
                        estimatesInitialized: true,
                    });
                }
            } catch (error) {
                console.error('Failed to fetch estimates:', error);
            } finally {
                set({ estimatesLoading: false });
            }
        },

        addEstimate: async (data: EstimateInput) => {
            const response = await fetch('/api/estimates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '見積の追加に失敗しました');
            }

            const newEstimate = await response.json();
            const parsed = parseEstimateDates(newEstimate);
            set((state) => ({
                estimates: [...state.estimates, parsed],
            }));
            return parsed;
        },

        updateEstimate: async (id: string, data: Partial<EstimateInput>) => {
            const response = await fetch(`/api/estimates/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '見積の更新に失敗しました');
            }

            const updated = await response.json();
            set((state) => ({
                estimates: state.estimates.map((e) => (e.id === id ? parseEstimateDates(updated) : e)),
            }));
        },

        deleteEstimate: async (id: string) => {
            const response = await fetch(`/api/estimates/${id}`, { method: 'DELETE' });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '見積の削除に失敗しました');
            }

            set((state) => ({
                estimates: state.estimates.filter((e) => e.id !== id),
            }));
        },

        getEstimate: (id: string) => get().estimates.find((e) => e.id === id),

        getEstimatesByProject: (projectId: string) =>
            get().estimates.filter((e) => e.projectId === projectId),

        // ========== Invoices ==========
        fetchInvoices: async () => {
            if (get().invoicesLoading) return;

            set({ invoicesLoading: true });
            try {
                const response = await fetch('/api/invoices');
                if (response.ok) {
                    const data = await response.json();
                    set({
                        invoices: data.map(parseInvoiceDates),
                        invoicesInitialized: true,
                    });
                }
            } catch (error) {
                console.error('Failed to fetch invoices:', error);
            } finally {
                set({ invoicesLoading: false });
            }
        },

        addInvoice: async (data: InvoiceInput) => {
            const response = await fetch('/api/invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '請求書の追加に失敗しました');
            }

            const newInvoice = await response.json();
            const parsed = parseInvoiceDates(newInvoice);
            set((state) => ({
                invoices: [...state.invoices, parsed],
            }));
            return parsed;
        },

        updateInvoice: async (id: string, data: Partial<InvoiceInput>) => {
            const response = await fetch(`/api/invoices/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '請求書の更新に失敗しました');
            }

            const updated = await response.json();
            set((state) => ({
                invoices: state.invoices.map((i) => (i.id === id ? parseInvoiceDates(updated) : i)),
            }));
        },

        deleteInvoice: async (id: string) => {
            const response = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '請求書の削除に失敗しました');
            }

            set((state) => ({
                invoices: state.invoices.filter((i) => i.id !== id),
            }));
        },

        getInvoice: (id: string) => get().invoices.find((i) => i.id === id),

        reset: () => set(initialState),
    }))
);

// Selectors
export const selectCompanyInfo = (state: FinanceStore) => state.companyInfo;
export const selectCompanyLoading = (state: FinanceStore) => state.companyLoading;
export const selectCompanyInitialized = (state: FinanceStore) => state.companyInitialized;

export const selectCustomers = (state: FinanceStore) => state.customers;
export const selectCustomersLoading = (state: FinanceStore) => state.customersLoading;
export const selectCustomersInitialized = (state: FinanceStore) => state.customersInitialized;

export const selectEstimates = (state: FinanceStore) => state.estimates;
export const selectEstimatesLoading = (state: FinanceStore) => state.estimatesLoading;
export const selectEstimatesInitialized = (state: FinanceStore) => state.estimatesInitialized;

export const selectInvoices = (state: FinanceStore) => state.invoices;
export const selectInvoicesLoading = (state: FinanceStore) => state.invoicesLoading;
export const selectInvoicesInitialized = (state: FinanceStore) => state.invoicesInitialized;
