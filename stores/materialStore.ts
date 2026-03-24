import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { MaterialCategoryWithItems, MaterialRequisition } from '@/types/material';

interface MaterialState {
    categories: MaterialCategoryWithItems[];
    requisitions: MaterialRequisition[];
    isCategoriesLoading: boolean;
    isCategoriesInitialized: boolean;
    isRequisitionsLoading: boolean;
}

interface MaterialActions {
    // Categories (with items)
    fetchCategories: () => Promise<void>;
    addCategory: (name: string) => Promise<void>;
    updateCategory: (id: string, data: { name?: string; sortOrder?: number }) => Promise<void>;
    deleteCategory: (id: string) => Promise<void>;

    // Items
    addItem: (categoryId: string, name: string, spec?: string, unit?: string) => Promise<void>;
    updateItem: (id: string, data: { name?: string; spec?: string; unit?: string; sortOrder?: number }) => Promise<void>;
    deleteItem: (id: string) => Promise<void>;

    // Requisitions
    fetchRequisitions: (params?: { projectMasterId?: string; from?: string; to?: string; status?: string }) => Promise<void>;
    createRequisition: (data: Record<string, unknown>) => Promise<MaterialRequisition | null>;
    updateRequisition: (id: string, data: Record<string, unknown>) => Promise<void>;
    deleteRequisition: (id: string) => Promise<void>;

    reset: () => void;
}

type MaterialStore = MaterialState & MaterialActions;

const initialState: MaterialState = {
    categories: [],
    requisitions: [],
    isCategoriesLoading: false,
    isCategoriesInitialized: false,
    isRequisitionsLoading: false,
};

export const useMaterialStore = create<MaterialStore>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        fetchCategories: async () => {
            if (get().isCategoriesLoading) return;
            set({ isCategoriesLoading: true });
            try {
                const res = await fetch('/api/master-data/material-categories', { cache: 'no-store' });
                if (res.ok) {
                    const categories = await res.json();
                    set({ categories, isCategoriesInitialized: true });
                }
            } catch (error) {
                console.error('Failed to fetch material categories:', error);
            } finally {
                set({ isCategoriesLoading: false });
            }
        },

        addCategory: async (name: string) => {
            const res = await fetch('/api/master-data/material-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (res.ok) {
                await get().fetchCategories();
            }
        },

        updateCategory: async (id, data) => {
            const res = await fetch(`/api/master-data/material-categories/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (res.ok) {
                await get().fetchCategories();
            }
        },

        deleteCategory: async (id) => {
            const res = await fetch(`/api/master-data/material-categories/${id}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                set(state => ({
                    categories: state.categories.filter(c => c.id !== id),
                }));
            }
        },

        addItem: async (categoryId, name, spec, unit) => {
            const res = await fetch('/api/master-data/material-items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryId, name, spec, unit }),
            });
            if (res.ok) {
                await get().fetchCategories();
            }
        },

        updateItem: async (id, data) => {
            const res = await fetch(`/api/master-data/material-items/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (res.ok) {
                await get().fetchCategories();
            }
        },

        deleteItem: async (id) => {
            const res = await fetch(`/api/master-data/material-items/${id}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                await get().fetchCategories();
            }
        },

        fetchRequisitions: async (params) => {
            set({ isRequisitionsLoading: true });
            try {
                const query = new URLSearchParams();
                if (params?.projectMasterId) query.set('projectMasterId', params.projectMasterId);
                if (params?.from) query.set('from', params.from);
                if (params?.to) query.set('to', params.to);
                if (params?.status) query.set('status', params.status);

                const res = await fetch(`/api/materials/requisitions?${query}`, { cache: 'no-store' });
                if (res.ok) {
                    const requisitions = await res.json();
                    set({ requisitions });
                }
            } catch (error) {
                console.error('Failed to fetch requisitions:', error);
            } finally {
                set({ isRequisitionsLoading: false });
            }
        },

        createRequisition: async (data) => {
            const res = await fetch('/api/materials/requisitions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (res.ok) {
                const requisition = await res.json();
                set(state => ({
                    requisitions: [requisition, ...state.requisitions],
                }));
                return requisition;
            }
            const err = await res.json();
            throw new Error(err.error || '作成に失敗しました');
        },

        updateRequisition: async (id, data) => {
            const res = await fetch(`/api/materials/requisitions/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (res.ok) {
                const updated = await res.json();
                set(state => ({
                    requisitions: state.requisitions.map(r => r.id === id ? { ...r, ...updated } : r),
                }));
            }
        },

        deleteRequisition: async (id) => {
            const res = await fetch(`/api/materials/requisitions/${id}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                set(state => ({
                    requisitions: state.requisitions.filter(r => r.id !== id),
                }));
            }
        },

        reset: () => set(initialState),
    }))
);

// Selectors
export const selectCategories = (state: MaterialStore) => state.categories;
export const selectRequisitions = (state: MaterialStore) => state.requisitions;
