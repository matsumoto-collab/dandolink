import { StateCreator } from 'zustand';
import { CompanyInfo, CompanyInfoInput } from '@/types/company';
import { Customer, CustomerInput } from '@/types/customer';
import { Estimate, EstimateInput } from '@/types/estimate';
import { Invoice, InvoiceInput } from '@/types/invoice';
import { UnitPriceMaster, UnitPriceMasterInput, UnitPriceTemplate, UnitPriceTemplateInput, UnitPriceCategory, UnitPriceCategoryInput, UnitPriceSpecification, UnitPriceSpecificationInput } from '@/types/unitPrice';

export interface FinanceState {
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

    // UnitPriceMaster
    unitPrices: UnitPriceMaster[];
    unitPricesLoading: boolean;
    unitPricesInitialized: boolean;

    // UnitPriceTemplates
    unitPriceTemplates: UnitPriceTemplate[];
    unitPriceTemplatesLoading: boolean;
    unitPriceTemplatesInitialized: boolean;

    // UnitPriceCategories
    unitPriceCategories: UnitPriceCategory[];
    unitPriceCategoriesLoading: boolean;
    unitPriceCategoriesInitialized: boolean;

    // UnitPriceSpecifications
    unitPriceSpecifications: UnitPriceSpecification[];
    unitPriceSpecificationsLoading: boolean;
    unitPriceSpecificationsInitialized: boolean;
}

export interface FinanceActions {
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
    getInvoicesByProject: (projectId: string) => Invoice[];

    // UnitPriceMaster
    fetchUnitPrices: () => Promise<void>;
    addUnitPrice: (data: UnitPriceMasterInput) => Promise<void>;
    updateUnitPrice: (id: string, data: Partial<UnitPriceMasterInput>) => Promise<void>;
    deleteUnitPrice: (id: string) => Promise<void>;
    getUnitPriceById: (id: string) => UnitPriceMaster | undefined;
    getUnitPricesByTemplate: (templateId: string) => UnitPriceMaster[];

    // UnitPriceTemplates
    fetchUnitPriceTemplates: () => Promise<void>;
    addUnitPriceTemplate: (data: UnitPriceTemplateInput) => Promise<void>;
    updateUnitPriceTemplate: (id: string, data: Partial<UnitPriceTemplateInput>) => Promise<void>;
    deleteUnitPriceTemplate: (id: string) => Promise<void>;

    // UnitPriceCategories
    fetchUnitPriceCategories: () => Promise<void>;
    addUnitPriceCategory: (data: UnitPriceCategoryInput) => Promise<void>;
    updateUnitPriceCategory: (id: string, data: Partial<UnitPriceCategoryInput>) => Promise<void>;
    deleteUnitPriceCategory: (id: string) => Promise<void>;

    // UnitPriceSpecifications
    fetchUnitPriceSpecifications: () => Promise<void>;
    addUnitPriceSpecification: (data: UnitPriceSpecificationInput) => Promise<void>;
    updateUnitPriceSpecification: (id: string, data: Partial<UnitPriceSpecificationInput>) => Promise<void>;
    deleteUnitPriceSpecification: (id: string) => Promise<void>;
    getSpecificationsByMaster: (unitPriceMasterId: string) => UnitPriceSpecification[];

    // Reset
    reset: () => void;
}

export type FinanceStore = FinanceState & FinanceActions;

export type FinanceSlice<T> = StateCreator<FinanceStore, [['zustand/subscribeWithSelector', never]], [], T>;
