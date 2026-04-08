import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { FinanceStore, FinanceState } from './financeSlices/types';
import { createCompanySlice } from './financeSlices/companySlice';
import { createCustomerSlice } from './financeSlices/customerSlice';
import { createEstimateSlice } from './financeSlices/estimateSlice';
import { createInvoiceSlice } from './financeSlices/invoiceSlice';
import { createUnitPriceSlice } from './financeSlices/unitPriceSlice';

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
    unitPrices: [],
    unitPricesLoading: false,
    unitPricesInitialized: false,
    unitPriceTemplates: [],
    unitPriceTemplatesLoading: false,
    unitPriceTemplatesInitialized: false,
    unitPriceCategories: [],
    unitPriceCategoriesLoading: false,
    unitPriceCategoriesInitialized: false,
    unitPriceSpecifications: [],
    unitPriceSpecificationsLoading: false,
    unitPriceSpecificationsInitialized: false,
};

export const useFinanceStore = create<FinanceStore>()(
    subscribeWithSelector((...a) => ({
        ...createCompanySlice(...a),
        ...createCustomerSlice(...a),
        ...createEstimateSlice(...a),
        ...createInvoiceSlice(...a),
        ...createUnitPriceSlice(...a),
        reset: () => a[0](initialState),
    }))
);

// Re-export types
export type { FinanceStore } from './financeSlices/types';

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

export const selectUnitPrices = (state: FinanceStore) => state.unitPrices;
export const selectUnitPricesLoading = (state: FinanceStore) => state.unitPricesLoading;
export const selectUnitPricesInitialized = (state: FinanceStore) => state.unitPricesInitialized;

export const selectUnitPriceTemplates = (state: FinanceStore) => state.unitPriceTemplates;
export const selectUnitPriceTemplatesInitialized = (state: FinanceStore) => state.unitPriceTemplatesInitialized;

export const selectUnitPriceCategories = (state: FinanceStore) => state.unitPriceCategories;
export const selectUnitPriceCategoriesInitialized = (state: FinanceStore) => state.unitPriceCategoriesInitialized;

export const selectUnitPriceSpecifications = (state: FinanceStore) => state.unitPriceSpecifications;
export const selectUnitPriceSpecificationsInitialized = (state: FinanceStore) => state.unitPriceSpecificationsInitialized;
