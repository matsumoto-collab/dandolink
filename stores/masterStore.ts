import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// Types
export interface Vehicle {
    id: string;
    name: string;
}

export interface Worker {
    id: string;
    name: string;
}

export interface Manager {
    id: string;
    name: string;
}

interface MasterState {
    // Data
    vehicles: Vehicle[];
    workers: Worker[];
    managers: Manager[];
    totalMembers: number;

    // Status
    isLoading: boolean;
    isInitialized: boolean;
}

interface MasterActions {
    // Fetch
    fetchMasterData: () => Promise<void>;

    // Vehicle operations
    addVehicle: (name: string) => Promise<void>;
    updateVehicle: (id: string, name: string) => Promise<void>;
    deleteVehicle: (id: string) => Promise<void>;

    // Worker operations
    addWorker: (name: string) => Promise<void>;
    updateWorker: (id: string, name: string) => Promise<void>;
    deleteWorker: (id: string) => Promise<void>;

    // Manager operations
    addManager: (name: string) => Promise<void>;
    updateManager: (id: string, name: string) => Promise<void>;
    deleteManager: (id: string) => Promise<void>;

    // Total members
    updateTotalMembers: (count: number) => Promise<void>;

    // Reset
    reset: () => void;
}

type MasterStore = MasterState & MasterActions;

const initialState: MasterState = {
    vehicles: [],
    workers: [],
    managers: [],
    totalMembers: 20,
    isLoading: false,
    isInitialized: false,
};

export const useMasterStore = create<MasterStore>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        fetchMasterData: async () => {
            if (get().isLoading) return;

            set({ isLoading: true });
            try {
                const response = await fetch('/api/master-data');
                if (response.ok) {
                    const data = await response.json();
                    set({
                        vehicles: data.vehicles || [],
                        workers: data.workers || [],
                        managers: data.managers || [],
                        totalMembers: data.totalMembers || 20,
                        isInitialized: true,
                    });
                }
            } catch (error) {
                console.error('Failed to fetch master data:', error);
            } finally {
                set({ isLoading: false });
            }
        },

        // Vehicle operations
        addVehicle: async (name: string) => {
            const response = await fetch('/api/master-data/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (response.ok) {
                const newVehicle = await response.json();
                set((state) => ({ vehicles: [...state.vehicles, newVehicle] }));
            }
        },

        updateVehicle: async (id: string, name: string) => {
            const response = await fetch(`/api/master-data/vehicles/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (response.ok) {
                set((state) => ({
                    vehicles: state.vehicles.map((v) => (v.id === id ? { ...v, name } : v)),
                }));
            }
        },

        deleteVehicle: async (id: string) => {
            const response = await fetch(`/api/master-data/vehicles/${id}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                set((state) => ({
                    vehicles: state.vehicles.filter((v) => v.id !== id),
                }));
            }
        },

        // Worker operations
        addWorker: async (name: string) => {
            const response = await fetch('/api/master-data/workers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (response.ok) {
                const newWorker = await response.json();
                set((state) => ({ workers: [...state.workers, newWorker] }));
            }
        },

        updateWorker: async (id: string, name: string) => {
            const response = await fetch(`/api/master-data/workers/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (response.ok) {
                set((state) => ({
                    workers: state.workers.map((w) => (w.id === id ? { ...w, name } : w)),
                }));
            }
        },

        deleteWorker: async (id: string) => {
            const response = await fetch(`/api/master-data/workers/${id}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                set((state) => ({
                    workers: state.workers.filter((w) => w.id !== id),
                }));
            }
        },

        // Manager operations
        addManager: async (name: string) => {
            const response = await fetch('/api/master-data/managers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (response.ok) {
                const newManager = await response.json();
                set((state) => ({ managers: [...state.managers, newManager] }));
            }
        },

        updateManager: async (id: string, name: string) => {
            const response = await fetch(`/api/master-data/managers/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (response.ok) {
                set((state) => ({
                    managers: state.managers.map((m) => (m.id === id ? { ...m, name } : m)),
                }));
            }
        },

        deleteManager: async (id: string) => {
            const response = await fetch(`/api/master-data/managers/${id}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                set((state) => ({
                    managers: state.managers.filter((m) => m.id !== id),
                }));
            }
        },

        // Total members
        updateTotalMembers: async (count: number) => {
            const response = await fetch('/api/master-data/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ totalMembers: count }),
            });
            if (response.ok) {
                set({ totalMembers: count });
            }
        },

        reset: () => set(initialState),
    }))
);

// Selectors for optimized re-renders
export const selectVehicles = (state: MasterStore) => state.vehicles;
export const selectWorkers = (state: MasterStore) => state.workers;
export const selectManagers = (state: MasterStore) => state.managers;
export const selectTotalMembers = (state: MasterStore) => state.totalMembers;
export const selectIsLoading = (state: MasterStore) => state.isLoading;
export const selectIsInitialized = (state: MasterStore) => state.isInitialized;
