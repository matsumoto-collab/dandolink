'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useMasterStore } from '@/stores/masterStore';

// Re-export types for backward compatibility
export type { Vehicle, MasterData, MemberCountHistoryEntry } from '@/stores/masterStore';

// This hook wraps the Zustand store and handles initialization/realtime
export function useMasterData() {
    const { status } = useSession();

    // Get state from Zustand store
    const vehicles = useMasterStore((state) => state.vehicles);
    const constructionTypes = useMasterStore((state) => state.constructionTypes);
    const totalMembers = useMasterStore((state) => state.totalMembers);
    const memberCountHistory = useMasterStore((state) => state.memberCountHistory);
    const isLoading = useMasterStore((state) => state.isLoading);
    const isInitialized = useMasterStore((state) => state.isInitialized);

    // Get actions from Zustand store
    const fetchMasterData = useMasterStore((state) => state.fetchMasterData);
    const refreshMasterData = useMasterStore((state) => state.refreshMasterData);
    const addVehicle = useMasterStore((state) => state.addVehicle);
    const updateVehicle = useMasterStore((state) => state.updateVehicle);
    const deleteVehicle = useMasterStore((state) => state.deleteVehicle);
    const addMemberCountEntry = useMasterStore((state) => state.addMemberCountEntry);
    const updateMemberCountEntry = useMasterStore((state) => state.updateMemberCountEntry);
    const deleteMemberCountEntry = useMasterStore((state) => state.deleteMemberCountEntry);
    const getTotalMembersForDate = useMasterStore((state) => state.getTotalMembersForDate);
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
        constructionTypes,
        totalMembers,
        memberCountHistory,
        isLoading,

        // Vehicle operations
        addVehicle,
        updateVehicle,
        deleteVehicle,

        // Member count history
        addMemberCountEntry,
        updateMemberCountEntry,
        deleteMemberCountEntry,
        getTotalMembersForDate,

        // Refresh
        refreshMasterData,
    };
}
