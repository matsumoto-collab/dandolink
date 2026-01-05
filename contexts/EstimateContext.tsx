'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Estimate, EstimateInput } from '@/types/estimate';

interface EstimateContextType {
    estimates: Estimate[];
    isLoading: boolean;
    addEstimate: (estimate: EstimateInput) => Promise<Estimate>;
    updateEstimate: (id: string, estimate: Partial<EstimateInput>) => Promise<void>;
    deleteEstimate: (id: string) => Promise<void>;
    getEstimate: (id: string) => Estimate | undefined;
    getEstimatesByProject: (projectId: string) => Estimate[];
    refreshEstimates: () => Promise<void>;
}

const EstimateContext = createContext<EstimateContextType | undefined>(undefined);

export function EstimateProvider({ children }: { children: ReactNode }) {
    const { data: session, status } = useSession();
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch estimates from API
    const fetchEstimates = useCallback(async () => {
        // Skip if not authenticated
        if (status !== 'authenticated') {
            setEstimates([]);
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/estimates');
            if (response.ok) {
                const data = await response.json();
                // Convert date strings to Date objects
                const parsedEstimates = data.map((estimate: any) => ({
                    ...estimate,
                    validUntil: new Date(estimate.validUntil),
                    createdAt: new Date(estimate.createdAt),
                    updatedAt: new Date(estimate.updatedAt),
                }));

                // Always update state with fresh data
                setEstimates(parsedEstimates);
            }
        } catch (error) {
            console.error('Failed to fetch estimates:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    // Load estimates on mount and when session changes
    useEffect(() => {
        fetchEstimates();
    }, [fetchEstimates, session?.user?.email]);

    // Polling for real-time updates
    useEffect(() => {
        if (status !== 'authenticated') return;

        const POLLING_INTERVAL = 5000; // 5 seconds

        // Handle page visibility change
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                fetchEstimates(); // Refresh immediately when tab becomes active
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Start polling
        const intervalId = setInterval(() => {
            if (!document.hidden) {
                fetchEstimates();
            }
        }, POLLING_INTERVAL);

        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [status, fetchEstimates]);

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
