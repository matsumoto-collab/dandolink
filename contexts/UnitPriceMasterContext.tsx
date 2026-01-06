'use client';

import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { UnitPriceMaster, UnitPriceMasterInput, TemplateType, CategoryType } from '@/types/unitPrice';

interface UnitPriceMasterContextType {
    unitPrices: UnitPriceMaster[];
    isLoading: boolean;
    addUnitPrice: (unitPrice: UnitPriceMasterInput) => Promise<void>;
    updateUnitPrice: (id: string, unitPrice: Partial<UnitPriceMasterInput>) => Promise<void>;
    deleteUnitPrice: (id: string) => Promise<void>;
    getUnitPriceById: (id: string) => UnitPriceMaster | undefined;
    getUnitPricesByTemplate: (template: TemplateType) => UnitPriceMaster[];
    getUnitPricesByCategory: (category: CategoryType) => UnitPriceMaster[];
    refreshUnitPrices: () => Promise<void>;
}

const UnitPriceMasterContext = createContext<UnitPriceMasterContextType | undefined>(undefined);

export function UnitPriceMasterProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [unitPrices, setUnitPrices] = useState<UnitPriceMaster[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch from API
    const fetchUnitPrices = useCallback(async () => {
        if (status !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/master-data/unit-prices');
            if (response.ok) {
                const data = await response.json();
                setUnitPrices(data.map((up: UnitPriceMaster) => ({
                    ...up,
                    createdAt: new Date(up.createdAt),
                    updatedAt: new Date(up.updatedAt),
                })));
            }
        } catch (error) {
            console.error('Failed to fetch unit prices:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    useEffect(() => {
        fetchUnitPrices();
    }, [fetchUnitPrices]);

    // Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: any = null;
        let isSubscribed = true;

        const setupRealtimeSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                if (!isSubscribed) return;

                channel = supabase
                    .channel('unit-prices-realtime')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'UnitPriceMaster' }, () => {
                        fetchUnitPrices();
                    })
                    .subscribe();
            } catch (error) {
                console.error('[Realtime] Failed to setup unit prices subscription:', error);
            }
        };

        setupRealtimeSubscription();

        return () => {
            isSubscribed = false;
            if (channel) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channel);
                });
            }
        };
    }, [status, fetchUnitPrices]);

    const addUnitPrice = useCallback(async (unitPriceData: UnitPriceMasterInput) => {
        const response = await fetch('/api/master-data/unit-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(unitPriceData),
        });
        if (response.ok) {
            const newUnitPrice = await response.json();
            setUnitPrices(prev => [...prev, {
                ...newUnitPrice,
                createdAt: new Date(newUnitPrice.createdAt),
                updatedAt: new Date(newUnitPrice.updatedAt),
            }]);
        }
    }, []);

    const updateUnitPrice = useCallback(async (id: string, unitPriceData: Partial<UnitPriceMasterInput>) => {
        const response = await fetch(`/api/master-data/unit-prices/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(unitPriceData),
        });
        if (response.ok) {
            const updated = await response.json();
            setUnitPrices(prev => prev.map(up =>
                up.id === id ? { ...updated, createdAt: new Date(updated.createdAt), updatedAt: new Date(updated.updatedAt) } : up
            ));
        }
    }, []);

    const deleteUnitPrice = useCallback(async (id: string) => {
        const response = await fetch(`/api/master-data/unit-prices/${id}`, {
            method: 'DELETE',
        });
        if (response.ok) {
            setUnitPrices(prev => prev.filter(up => up.id !== id));
        }
    }, []);

    const getUnitPriceById = useCallback((id: string) => {
        return unitPrices.find(up => up.id === id);
    }, [unitPrices]);

    const getUnitPricesByTemplate = useCallback((template: TemplateType) => {
        return unitPrices.filter(up => up.templates.includes(template));
    }, [unitPrices]);

    const getUnitPricesByCategory = useCallback((category: CategoryType) => {
        return unitPrices.filter(up => up.category === category);
    }, [unitPrices]);

    return (
        <UnitPriceMasterContext.Provider
            value={{
                unitPrices,
                isLoading,
                addUnitPrice,
                updateUnitPrice,
                deleteUnitPrice,
                getUnitPriceById,
                getUnitPricesByTemplate,
                getUnitPricesByCategory,
                refreshUnitPrices: fetchUnitPrices,
            }}
        >
            {children}
        </UnitPriceMasterContext.Provider>
    );
}

export function useUnitPriceMaster() {
    const context = useContext(UnitPriceMasterContext);
    if (context === undefined) {
        throw new Error('useUnitPriceMaster must be used within a UnitPriceMasterProvider');
    }
    return context;
}
