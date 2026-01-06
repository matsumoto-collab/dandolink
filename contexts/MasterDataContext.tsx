'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

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

export interface MasterData {
    vehicles: Vehicle[];
    workers: Worker[];
    managers: Manager[];
    totalMembers: number;
}

interface MasterDataContextType extends MasterData {
    isLoading: boolean;
    addVehicle: (name: string) => Promise<void>;
    updateVehicle: (id: string, name: string) => Promise<void>;
    deleteVehicle: (id: string) => Promise<void>;
    addWorker: (name: string) => Promise<void>;
    updateWorker: (id: string, name: string) => Promise<void>;
    deleteWorker: (id: string) => Promise<void>;
    addManager: (name: string) => Promise<void>;
    updateManager: (id: string, name: string) => Promise<void>;
    deleteManager: (id: string) => Promise<void>;
    updateTotalMembers: (count: number) => Promise<void>;
    refreshMasterData: () => Promise<void>;
}

const MasterDataContext = createContext<MasterDataContextType | undefined>(undefined);

export function MasterDataProvider({ children }: { children: ReactNode }) {
    const { status } = useSession();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [totalMembers, setTotalMembers] = useState<number>(20);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch all master data from API
    const fetchMasterData = useCallback(async () => {
        if (status !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/master-data');
            if (response.ok) {
                const data = await response.json();
                setVehicles(data.vehicles || []);
                setWorkers(data.workers || []);
                setManagers(data.managers || []);
                setTotalMembers(data.totalMembers || 20);
            }
        } catch (error) {
            console.error('Failed to fetch master data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    // Load data on mount
    useEffect(() => {
        fetchMasterData();
    }, [fetchMasterData]);

    // Supabase Realtime subscription for master data
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channels: any[] = [];
        let isSubscribed = true;

        const setupRealtimeSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                if (!isSubscribed) return;

                const tables = ['Vehicle', 'Worker', 'Manager', 'SystemSettings'];

                tables.forEach(table => {
                    const channel = supabase
                        .channel(`master-data-${table.toLowerCase()}`)
                        .on(
                            'postgres_changes',
                            {
                                event: '*',
                                schema: 'public',
                                table: table,
                            },
                            () => {
                                console.log(`[Realtime] ${table} changed`);
                                fetchMasterData();
                            }
                        )
                        .subscribe();

                    channels.push(channel);
                });
            } catch (error) {
                console.error('[Realtime] Failed to setup master data subscription:', error);
            }
        };

        setupRealtimeSubscription();

        return () => {
            isSubscribed = false;
            import('@/lib/supabase').then(({ supabase }) => {
                channels.forEach(channel => {
                    supabase.removeChannel(channel);
                });
            });
        };
    }, [status, fetchMasterData]);

    // Vehicle operations
    const addVehicle = useCallback(async (name: string) => {
        const response = await fetch('/api/master-data/vehicles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (response.ok) {
            const newVehicle = await response.json();
            setVehicles(prev => [...prev, newVehicle]);
        }
    }, []);

    const updateVehicle = useCallback(async (id: string, name: string) => {
        const response = await fetch(`/api/master-data/vehicles/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (response.ok) {
            setVehicles(prev => prev.map(v => v.id === id ? { ...v, name } : v));
        }
    }, []);

    const deleteVehicle = useCallback(async (id: string) => {
        const response = await fetch(`/api/master-data/vehicles/${id}`, {
            method: 'DELETE',
        });
        if (response.ok) {
            setVehicles(prev => prev.filter(v => v.id !== id));
        }
    }, []);

    // Worker operations
    const addWorker = useCallback(async (name: string) => {
        const response = await fetch('/api/master-data/workers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (response.ok) {
            const newWorker = await response.json();
            setWorkers(prev => [...prev, newWorker]);
        }
    }, []);

    const updateWorker = useCallback(async (id: string, name: string) => {
        const response = await fetch(`/api/master-data/workers/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (response.ok) {
            setWorkers(prev => prev.map(w => w.id === id ? { ...w, name } : w));
        }
    }, []);

    const deleteWorker = useCallback(async (id: string) => {
        const response = await fetch(`/api/master-data/workers/${id}`, {
            method: 'DELETE',
        });
        if (response.ok) {
            setWorkers(prev => prev.filter(w => w.id !== id));
        }
    }, []);

    // Manager operations
    const addManager = useCallback(async (name: string) => {
        const response = await fetch('/api/master-data/managers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (response.ok) {
            const newManager = await response.json();
            setManagers(prev => [...prev, newManager]);
        }
    }, []);

    const updateManager = useCallback(async (id: string, name: string) => {
        const response = await fetch(`/api/master-data/managers/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (response.ok) {
            setManagers(prev => prev.map(m => m.id === id ? { ...m, name } : m));
        }
    }, []);

    const deleteManager = useCallback(async (id: string) => {
        const response = await fetch(`/api/master-data/managers/${id}`, {
            method: 'DELETE',
        });
        if (response.ok) {
            setManagers(prev => prev.filter(m => m.id !== id));
        }
    }, []);

    // Total members operations
    const updateTotalMembersCallback = useCallback(async (count: number) => {
        const response = await fetch('/api/master-data/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ totalMembers: count }),
        });
        if (response.ok) {
            setTotalMembers(count);
        }
    }, []);

    const value: MasterDataContextType = {
        vehicles,
        workers,
        managers,
        totalMembers,
        isLoading,
        addVehicle,
        updateVehicle,
        deleteVehicle,
        addWorker,
        updateWorker,
        deleteWorker,
        addManager,
        updateManager,
        deleteManager,
        updateTotalMembers: updateTotalMembersCallback,
        refreshMasterData: fetchMasterData,
    };

    return (
        <MasterDataContext.Provider value={value}>
            {children}
        </MasterDataContext.Provider>
    );
}

export function useMasterDataContext() {
    const context = useContext(MasterDataContext);
    if (context === undefined) {
        throw new Error('useMasterDataContext must be used within a MasterDataProvider');
    }
    return context;
}
