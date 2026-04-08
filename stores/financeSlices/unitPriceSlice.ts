import { UnitPriceMaster, UnitPriceMasterInput, UnitPriceTemplateInput, UnitPriceCategoryInput, UnitPriceSpecificationInput } from '@/types/unitPrice';
import { logger } from '@/lib/logger';
import { FinanceSlice, FinanceState, FinanceActions } from './types';

function parseUnitPriceDates(unitPrice: UnitPriceMaster & { createdAt: string | Date; updatedAt: string | Date }): UnitPriceMaster {
    return {
        ...unitPrice,
        createdAt: new Date(unitPrice.createdAt),
        updatedAt: new Date(unitPrice.updatedAt),
    };
}

function parseDates<T extends { createdAt: string | Date; updatedAt: string | Date }>(item: T): T {
    return { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) };
}

type UnitPriceSlice = Pick<FinanceState,
    'unitPrices' | 'unitPricesLoading' | 'unitPricesInitialized' |
    'unitPriceTemplates' | 'unitPriceTemplatesLoading' | 'unitPriceTemplatesInitialized' |
    'unitPriceCategories' | 'unitPriceCategoriesLoading' | 'unitPriceCategoriesInitialized' |
    'unitPriceSpecifications' | 'unitPriceSpecificationsLoading' | 'unitPriceSpecificationsInitialized'
> & Pick<FinanceActions,
    'fetchUnitPrices' | 'addUnitPrice' | 'updateUnitPrice' | 'deleteUnitPrice' | 'getUnitPriceById' | 'getUnitPricesByTemplate' |
    'fetchUnitPriceTemplates' | 'addUnitPriceTemplate' | 'updateUnitPriceTemplate' | 'deleteUnitPriceTemplate' |
    'fetchUnitPriceCategories' | 'addUnitPriceCategory' | 'updateUnitPriceCategory' | 'deleteUnitPriceCategory' |
    'fetchUnitPriceSpecifications' | 'addUnitPriceSpecification' | 'updateUnitPriceSpecification' | 'deleteUnitPriceSpecification' | 'getSpecificationsByMaster'
>;

export const createUnitPriceSlice: FinanceSlice<UnitPriceSlice> = (set, get) => ({
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

    // ========== UnitPriceMaster ==========
    fetchUnitPrices: async () => {
        if (get().unitPricesLoading) return;

        set({ unitPricesLoading: true });
        try {
            const response = await fetch('/api/master-data/unit-prices', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                set({
                    unitPrices: data.map(parseUnitPriceDates),
                    unitPricesInitialized: true,
                });
            }
        } catch (error) {
            logger.error('Failed to fetch unit prices:', error);
        } finally {
            set({ unitPricesLoading: false });
        }
    },

    addUnitPrice: async (data: UnitPriceMasterInput) => {
        const response = await fetch('/api/master-data/unit-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '単価マスターの追加に失敗しました');
        }

        const newUnitPrice = await response.json();
        set((state) => ({
            unitPrices: [...state.unitPrices, parseUnitPriceDates(newUnitPrice)],
        }));
    },

    updateUnitPrice: async (id: string, data: Partial<UnitPriceMasterInput>) => {
        const response = await fetch(`/api/master-data/unit-prices/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '単価マスターの更新に失敗しました');
        }

        const updated = await response.json();
        set((state) => ({
            unitPrices: state.unitPrices.map((up) => (up.id === id ? parseUnitPriceDates(updated) : up)),
        }));
    },

    deleteUnitPrice: async (id: string) => {
        const response = await fetch(`/api/master-data/unit-prices/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '単価マスターの削除に失敗しました');
        }

        set((state) => ({
            unitPrices: state.unitPrices.filter((up) => up.id !== id),
        }));
    },

    getUnitPriceById: (id: string) => get().unitPrices.find((up) => up.id === id),

    getUnitPricesByTemplate: (templateId: string) =>
        get().unitPrices.filter((up) => up.templates.includes(templateId)),

    // ========== UnitPriceTemplates ==========
    fetchUnitPriceTemplates: async () => {
        if (get().unitPriceTemplatesLoading) return;

        set({ unitPriceTemplatesLoading: true });
        try {
            const response = await fetch('/api/master-data/unit-price-templates', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                set({
                    unitPriceTemplates: data.map(parseDates),
                    unitPriceTemplatesInitialized: true,
                });
            }
        } catch (error) {
            logger.error('Failed to fetch unit price templates:', error);
        } finally {
            set({ unitPriceTemplatesLoading: false });
        }
    },

    addUnitPriceTemplate: async (data: UnitPriceTemplateInput) => {
        const response = await fetch('/api/master-data/unit-price-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'テンプレートの追加に失敗しました');
        }

        const newTemplate = await response.json();
        set((state) => ({
            unitPriceTemplates: [...state.unitPriceTemplates, parseDates(newTemplate)],
        }));
    },

    updateUnitPriceTemplate: async (id: string, data: Partial<UnitPriceTemplateInput>) => {
        const response = await fetch(`/api/master-data/unit-price-templates/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'テンプレートの更新に失敗しました');
        }

        const updated = await response.json();
        set((state) => ({
            unitPriceTemplates: state.unitPriceTemplates.map((t) => (t.id === id ? parseDates(updated) : t)),
        }));
    },

    deleteUnitPriceTemplate: async (id: string) => {
        const response = await fetch(`/api/master-data/unit-price-templates/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'テンプレートの削除に失敗しました');
        }

        set((state) => ({
            unitPriceTemplates: state.unitPriceTemplates.filter((t) => t.id !== id),
        }));
    },

    // ========== UnitPriceCategories ==========
    fetchUnitPriceCategories: async () => {
        if (get().unitPriceCategoriesLoading) return;

        set({ unitPriceCategoriesLoading: true });
        try {
            const response = await fetch('/api/master-data/unit-price-categories', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                set({
                    unitPriceCategories: data.map(parseDates),
                    unitPriceCategoriesInitialized: true,
                });
            }
        } catch (error) {
            logger.error('Failed to fetch unit price categories:', error);
        } finally {
            set({ unitPriceCategoriesLoading: false });
        }
    },

    addUnitPriceCategory: async (data: UnitPriceCategoryInput) => {
        const response = await fetch('/api/master-data/unit-price-categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'カテゴリの追加に失敗しました');
        }

        const newCategory = await response.json();
        set((state) => ({
            unitPriceCategories: [...state.unitPriceCategories, parseDates(newCategory)],
        }));
    },

    updateUnitPriceCategory: async (id: string, data: Partial<UnitPriceCategoryInput>) => {
        const response = await fetch(`/api/master-data/unit-price-categories/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'カテゴリの更新に失敗しました');
        }

        const updated = await response.json();
        set((state) => ({
            unitPriceCategories: state.unitPriceCategories.map((c) => (c.id === id ? parseDates(updated) : c)),
        }));
    },

    deleteUnitPriceCategory: async (id: string) => {
        const response = await fetch(`/api/master-data/unit-price-categories/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'カテゴリの削除に失敗しました');
        }

        set((state) => ({
            unitPriceCategories: state.unitPriceCategories.filter((c) => c.id !== id),
        }));
    },

    // ========== UnitPriceSpecifications ==========
    fetchUnitPriceSpecifications: async () => {
        if (get().unitPriceSpecificationsLoading) return;

        set({ unitPriceSpecificationsLoading: true });
        try {
            const response = await fetch('/api/master-data/unit-price-specifications', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                set({
                    unitPriceSpecifications: data.map(parseDates),
                    unitPriceSpecificationsInitialized: true,
                });
            }
        } catch (error) {
            logger.error('Failed to fetch unit price specifications:', error);
        } finally {
            set({ unitPriceSpecificationsLoading: false });
        }
    },

    addUnitPriceSpecification: async (data: UnitPriceSpecificationInput) => {
        const response = await fetch('/api/master-data/unit-price-specifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '規格の追加に失敗しました');
        }

        const newSpec = await response.json();
        set((state) => ({
            unitPriceSpecifications: [...state.unitPriceSpecifications, parseDates(newSpec)],
        }));
    },

    updateUnitPriceSpecification: async (id: string, data: Partial<UnitPriceSpecificationInput>) => {
        const response = await fetch(`/api/master-data/unit-price-specifications/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '規格の更新に失敗しました');
        }

        const updated = await response.json();
        set((state) => ({
            unitPriceSpecifications: state.unitPriceSpecifications.map((s) => (s.id === id ? parseDates(updated) : s)),
        }));
    },

    deleteUnitPriceSpecification: async (id: string) => {
        const response = await fetch(`/api/master-data/unit-price-specifications/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '規格の削除に失敗しました');
        }

        set((state) => ({
            unitPriceSpecifications: state.unitPriceSpecifications.filter((s) => s.id !== id),
        }));
    },

    getSpecificationsByMaster: (unitPriceMasterId: string) =>
        get().unitPriceSpecifications.filter((s) => s.unitPriceMasterId === unitPriceMasterId),
});
