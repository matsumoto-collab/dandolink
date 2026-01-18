'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Estimate, EstimateInput } from '@/types/estimate';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface EstimateContextType {
    estimates: Estimate[];
    isLoading: boolean;
    isInitialized: boolean;
    ensureDataLoaded: () => Promise<void>;
    addEstimate: (estimate: EstimateInput) => Promise<Estimate>;
    updateEstimate: (id: string, estimate: Partial<EstimateInput>) => Promise<void>;
    deleteEstimate: (id: string) => Promise<void>;
    getEstimate: (id: string) => Estimate | undefined;
    getEstimatesByProject: (projectId: string) => Estimate[];
    refreshEstimates: () => Promise<void>;
}

const EstimateContext = createContext<EstimateContextType | undefined>(undefined);

export function EstimateProvider({ children }: { children: ReactNode }) {
    const { status } = useSession();
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [realtimeSetup, setRealtimeSetup] = useState(false);

    // Fetch estimates from API
    const fetchEstimates = useCallback(async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/estimates');
            if (response.ok) {
                const data = await response.json();
                const parsedEstimates = data.map((estimate: Estimate) => ({
                    ...estimate,
                    validUntil: new Date(estimate.validUntil),
                    createdAt: new Date(estimate.createdAt),
                    updatedAt: new Date(estimate.updatedAt),
                }));
                setEstimates(parsedEstimates);
            }
        } catch (error) {
            console.error('Failed to fetch estimates:', error);
        } finally {
            setIsLoading(false);
            setIsInitialized(true);
        }
    }, []);

    // 遅延読み込み: ページから呼び出された時のみデータ取得
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchEstimates();
        }
    }, [status, isInitialized, fetchEstimates]);

    // 未認証時はリセット
    useEffect(() => {
        if (status === 'unauthenticated') {
            setEstimates([]);
            setIsInitialized(false);
        }
    }, [status]);

    // Supabase Realtime subscription（初回データ取得後のみ）
    useEffect(() => {
        if (status !== 'authenticated' || !isInitialized || realtimeSetup) return;

        let channel: RealtimeChannel | null = null;
        setRealtimeSetup(true);

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('estimates-changes')
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'Estimate' },
                        () => fetchEstimates()
                    )
                    .subscribe();
            } catch (error) {
                console.error('Failed to setup realtime:', error);
            }
        };

        setupRealtime();

        return () => {
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channelToRemove);
                });
            }
        };
    }, [status, isInitialized, realtimeSetup, fetchEstimates]);

    const addEstimate = useCallback(async (input: EstimateInput): Promise<Estimate> => {
        try {
            const response = await fetch('/api/estimates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (response.ok) {
                const newEstimate = await response.json();
                const parsedEstimate = {
                    ...newEstimate,
                    validUntil: new Date(newEstimate.validUntil),
                    createdAt: new Date(newEstimate.createdAt),
                    updatedAt: new Date(newEstimate.updatedAt),
                };
                setEstimates(prev => [...prev, parsedEstimate]);
                return parsedEstimate;
            } else {
                const error = await response.json();
                throw new Error(error.error || '見積の追加に失敗しました');
            }
        } catch (error) {
            console.error('Failed to add estimate:', error);
            throw error;
        }
    }, []);

    const updateEstimate = useCallback(async (id: string, input: Partial<EstimateInput>) => {
        try {
            const response = await fetch(`/api/estimates/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (response.ok) {
                const updatedEstimate = await response.json();
                const parsedEstimate = {
                    ...updatedEstimate,
                    validUntil: new Date(updatedEstimate.validUntil),
                    createdAt: new Date(updatedEstimate.createdAt),
                    updatedAt: new Date(updatedEstimate.updatedAt),
                };
                setEstimates(prev => prev.map(est => est.id === id ? parsedEstimate : est));
            } else {
                const error = await response.json();
                throw new Error(error.error || '見積の更新に失敗しました');
            }
        } catch (error) {
            console.error('Failed to update estimate:', error);
            throw error;
        }
    }, []);

    const deleteEstimate = useCallback(async (id: string) => {
        try {
            const response = await fetch(`/api/estimates/${id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setEstimates(prev => prev.filter(est => est.id !== id));
            } else {
                const error = await response.json();
                throw new Error(error.error || '見積の削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete estimate:', error);
            throw error;
        }
    }, []);

    const getEstimate = useCallback((id: string) => {
        return estimates.find(est => est.id === id);
    }, [estimates]);

    const getEstimatesByProject = useCallback((projectId: string) => {
        return estimates.filter(est => est.projectId === projectId);
    }, [estimates]);

    return (
        <EstimateContext.Provider
            value={{
                estimates,
                isLoading,
                isInitialized,
                ensureDataLoaded,
                addEstimate,
                updateEstimate,
                deleteEstimate,
                getEstimate,
                getEstimatesByProject,
                refreshEstimates: fetchEstimates,
            }}
        >
            {children}
        </EstimateContext.Provider>
    );
}

export function useEstimates() {
    const context = useContext(EstimateContext);
    if (context === undefined) {
        throw new Error('useEstimates must be used within an EstimateProvider');
    }
    return context;
}
