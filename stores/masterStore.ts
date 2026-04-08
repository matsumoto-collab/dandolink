import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { ConstructionTypeMaster } from '@/types/calendar';
import { logger } from '@/lib/logger';

// Types
export interface Vehicle {
    id: string;
    name: string;
}

export interface Manager {
    id: string;
    name: string;
}

export interface MemberCountHistoryEntry {
    id: string;
    startDate: string; // ISO date string
    count: number;
}

export interface MasterData {
    vehicles: Vehicle[];
    managers: Manager[];
    constructionTypes: ConstructionTypeMaster[];
    totalMembers: number;
    memberCountHistory: MemberCountHistoryEntry[];
}

interface MasterState {
    // Data
    vehicles: Vehicle[];
    constructionTypes: ConstructionTypeMaster[];
    totalMembers: number;
    memberCountHistory: MemberCountHistoryEntry[];

    // Status
    isLoading: boolean;
    isInitialized: boolean;

    // Realtime
    _realtimeChannels: RealtimeChannel[];
}

interface MasterActions {
    // Fetch
    fetchMasterData: () => Promise<void>;
    refreshMasterData: () => Promise<void>;

    // Vehicle operations
    addVehicle: (name: string) => Promise<void>;
    updateVehicle: (id: string, name: string) => Promise<void>;
    deleteVehicle: (id: string) => Promise<void>;

    // Member count history
    fetchMemberCountHistory: () => Promise<void>;
    addMemberCountEntry: (startDate: string, count: number) => Promise<void>;
    updateMemberCountEntry: (id: string, startDate: string, count: number) => Promise<void>;
    deleteMemberCountEntry: (id: string) => Promise<void>;
    getTotalMembersForDate: (dateStr: string) => number;

    // Realtime
    setupRealtimeSubscription: () => Promise<void>;
    cleanupRealtimeSubscription: () => void;

    // Reset
    reset: () => void;
}

type MasterStore = MasterState & MasterActions;

const initialState: MasterState = {
    vehicles: [],
    constructionTypes: [],
    totalMembers: 20,
    memberCountHistory: [],
    isLoading: false,
    isInitialized: false,
    _realtimeChannels: [],
};

export const useMasterStore = create<MasterStore>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        fetchMasterData: async () => {
            if (get().isLoading) return;

            set({ isLoading: true });
            try {
                // Fetch master data and construction types in parallel
                const [masterResponse, constructionTypesResponse, historyResponse] = await Promise.all([
                    fetch('/api/master-data', { cache: 'no-store' }),
                    fetch('/api/master-data/construction-types', { cache: 'no-store' }),
                    fetch('/api/master-data/member-count-history', { cache: 'no-store' }),
                ]);

                let constructionTypes: ConstructionTypeMaster[] = [];
                if (constructionTypesResponse.ok) {
                    constructionTypes = await constructionTypesResponse.json();
                }

                let memberCountHistory: MemberCountHistoryEntry[] = [];
                if (historyResponse.ok) {
                    memberCountHistory = await historyResponse.json();
                }

                if (masterResponse.ok) {
                    const data = await masterResponse.json();
                    set({
                        vehicles: data.vehicles || [],
                        constructionTypes,
                        totalMembers: data.totalMembers || 20,
                        memberCountHistory,
                        isInitialized: true,
                    });
                }
            } catch (error) {
                logger.error('Failed to fetch master data:', error);
            } finally {
                set({ isLoading: false });
            }
        },

        refreshMasterData: async () => {
            // Force refresh without checking isLoading
            try {
                const [masterResponse, constructionTypesResponse, historyResponse] = await Promise.all([
                    fetch('/api/master-data', { cache: 'no-store' }),
                    fetch('/api/master-data/construction-types', { cache: 'no-store' }),
                    fetch('/api/master-data/member-count-history', { cache: 'no-store' }),
                ]);

                let constructionTypes: ConstructionTypeMaster[] = [];
                if (constructionTypesResponse.ok) {
                    constructionTypes = await constructionTypesResponse.json();
                }

                let memberCountHistory: MemberCountHistoryEntry[] = [];
                if (historyResponse.ok) {
                    memberCountHistory = await historyResponse.json();
                }

                if (masterResponse.ok) {
                    const data = await masterResponse.json();
                    set({
                        vehicles: data.vehicles || [],
                        constructionTypes,
                        totalMembers: data.totalMembers || 20,
                        memberCountHistory,
                        isInitialized: true,
                    });
                }
            } catch (error) {
                logger.error('Failed to refresh master data:', error);
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

        // Member count history
        fetchMemberCountHistory: async () => {
            try {
                const res = await fetch('/api/master-data/member-count-history', { cache: 'no-store' });
                if (res.ok) {
                    const history: MemberCountHistoryEntry[] = await res.json();
                    set({ memberCountHistory: history });
                }
            } catch (error) {
                logger.error('Failed to fetch member count history:', error);
            }
        },

        addMemberCountEntry: async (startDate: string, count: number) => {
            const res = await fetch('/api/master-data/member-count-history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, count }),
            });
            if (res.ok) {
                await get().fetchMemberCountHistory();
            }
        },

        updateMemberCountEntry: async (id: string, startDate: string, count: number) => {
            const res = await fetch('/api/master-data/member-count-history', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, startDate, count }),
            });
            if (res.ok) {
                await get().fetchMemberCountHistory();
            }
        },

        deleteMemberCountEntry: async (id: string) => {
            const res = await fetch('/api/master-data/member-count-history', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            if (res.ok) {
                await get().fetchMemberCountHistory();
            }
        },

        getTotalMembersForDate: (dateStr: string) => {
            const history = get().memberCountHistory;
            if (history.length === 0) return get().totalMembers;
            // history is sorted by startDate asc
            // Find the latest entry whose startDate <= dateStr
            let result = history[0].count;
            for (const entry of history) {
                const entryDate = entry.startDate.slice(0, 10);
                if (entryDate <= dateStr) {
                    result = entry.count;
                } else {
                    break;
                }
            }
            return result;
        },

        // Realtime subscription
        setupRealtimeSubscription: async () => {
            const existingChannels = get()._realtimeChannels;
            if (existingChannels.length > 0) return;

            try {
                const { supabase } = await import('@/lib/supabase');
                const channels: RealtimeChannel[] = [];
                const tables = ['Vehicle', 'SystemSettings', 'ConstructionType', 'MemberCountHistory'];

                tables.forEach(table => {
                    const channel = supabase
                        .channel(`master-data-${table.toLowerCase()}-zustand`)
                        .on(
                            'postgres_changes',
                            {
                                event: '*',
                                schema: 'public',
                                table: table,
                            },
                            () => {
                                get().refreshMasterData();
                            }
                        )
                        .subscribe();

                    channels.push(channel);
                });

                set({ _realtimeChannels: channels });
            } catch (error) {
                logger.error('[Zustand] Failed to setup master data realtime subscription:', error);
            }
        },

        cleanupRealtimeSubscription: () => {
            const channels = get()._realtimeChannels;
            if (channels.length === 0) return;

            import('@/lib/supabase').then(({ supabase }) => {
                channels.forEach(channel => {
                    supabase.removeChannel(channel);
                });
            });

            set({ _realtimeChannels: [] });
        },

        reset: () => {
            get().cleanupRealtimeSubscription();
            set(initialState);
        },
    }))
);

// Selectors for optimized re-renders
export const selectVehicles = (state: MasterStore) => state.vehicles;
export const selectConstructionTypes = (state: MasterStore) => state.constructionTypes;
export const selectTotalMembers = (state: MasterStore) => state.totalMembers;
export const selectMemberCountHistory = (state: MasterStore) => state.memberCountHistory;
export const selectGetTotalMembersForDate = (state: MasterStore) => state.getTotalMembersForDate;
export const selectIsLoading = (state: MasterStore) => state.isLoading;
export const selectIsInitialized = (state: MasterStore) => state.isInitialized;
