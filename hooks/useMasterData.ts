'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useMasterStore } from '@/stores/masterStore';

// Re-export types for backward compatibility
export type { Vehicle, Worker, Manager, MasterData } from '@/stores/masterStore';

// This hook wraps the Zustand store and handles initialization/realtime
export function useMasterData() {
    const { status } = useSession();

    // Get state from Zustand store
    const vehicles = useMasterStore((state) => state.vehicles);
    const workers = useMasterStore((state) => state.workers);
    const managers = useMasterStore((state) => state.managers);
    const constructionTypes = useMasterStore((state) => state.constructionTypes);
    const totalMembers = useMasterStore((state) => state.totalMembers);
    const isLoading = useMasterStore((state) => state.isLoading);
    const isInitialized = useMasterStore((state) => state.isInitialized);

    // Get actions from Zustand store
    const fetchMasterData = useMasterStore((state) => state.fetchMasterData);
    const refreshMasterData = useMasterStore((state) => state.refreshMasterData);
    const addVehicle = useMasterStore((state) => state.addVehicle);
    const updateVehicle = useMasterStore((state) => state.updateVehicle);
    const deleteVehicle = useMasterStore((state) => state.deleteVehicle);
    const addWorker = useMasterStore((state) => state.addWorker);
    const updateWorker = useMasterStore((state) => state.updateWorker);
    const deleteWorker = useMasterStore((state) => state.deleteWorker);
    const addManager = useMasterStore((state) => state.addManager);
    const updateManager = useMasterStore((state) => state.updateManager);
    const deleteManager = useMasterStore((state) => state.deleteManager);
    const updateTotalMembers = useMasterStore((state) => state.updateTotalMembers);
    const setupRealtimeSubscription = useMasterStore((state) => state.setupRealtimeSubscription);

    // Initialize data when authenticated
    useEffect(() => {
        if (status === 'authenticated' && !isInitialized) {
            fetchMasterData();
        }
    }, [status, isInitialized, fetchMasterData]);

    // Setup realtime subscription when authenticated
    useEffect(() => {
        if (status === 'authenticated') {
            setupRealtimeSubscription();
        }

        return () => {
            // Cleanup is handled by the store
        };
    }, [status, setupRealtimeSubscription]);

    return {
        // Data
        vehicles,
        workers,
        managers,
        constructionTypes,
        totalMembers,
        isLoading,

        // Vehicle operations
        addVehicle,
        updateVehicle,
        deleteVehicle,

        // Worker operations
        addWorker,
        updateWorker,
        deleteWorker,

        // Manager operations
        addManager,
        updateManager,
        deleteManager,

        // Total members
        updateTotalMembers,

        // Refresh
        refreshMasterData,
    };
}
