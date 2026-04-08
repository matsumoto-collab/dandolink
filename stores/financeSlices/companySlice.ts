import { CompanyInfoInput } from '@/types/company';
import { logger } from '@/lib/logger';
import { FinanceSlice, FinanceState, FinanceActions } from './types';

type CompanySlice = Pick<FinanceState, 'companyInfo' | 'companyLoading' | 'companyInitialized'> &
    Pick<FinanceActions, 'fetchCompanyInfo' | 'updateCompanyInfo'>;

export const createCompanySlice: FinanceSlice<CompanySlice> = (set, get) => ({
    companyInfo: null,
    companyLoading: false,
    companyInitialized: false,

    fetchCompanyInfo: async () => {
        if (get().companyLoading) return;

        set({ companyLoading: true });
        try {
            const response = await fetch('/api/master-data/company', { cache: 'no-store' });
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
            logger.error('Failed to fetch company info:', error);
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
});
