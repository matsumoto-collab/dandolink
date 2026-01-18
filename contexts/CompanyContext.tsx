'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { CompanyInfo, CompanyInfoInput } from '@/types/company';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface CompanyContextType {
    companyInfo: CompanyInfo | null;
    isLoading: boolean;
    isInitialized: boolean;
    ensureDataLoaded: () => Promise<void>;
    updateCompanyInfo: (data: CompanyInfoInput) => Promise<void>;
    refreshCompanyInfo: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
    const { status } = useSession();
    const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [realtimeSetup, setRealtimeSetup] = useState(false);

    // Fetch from API
    const fetchCompanyInfo = useCallback(async () => {
        if (status !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            const response = await fetch('/api/master-data/company');
            if (response.ok) {
                const data = await response.json();
                setCompanyInfo({
                    ...data,
                    createdAt: new Date(data.createdAt),
                    updatedAt: new Date(data.updatedAt),
                });
            }
        } catch (error) {
            console.error('Failed to fetch company info:', error);
        } finally {
            setIsLoading(false);
            setIsInitialized(true);
        }
    }, [status]);

    // 遅延読み込み: ページから呼び出された時のみデータ取得
    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchCompanyInfo();
        }
    }, [status, isInitialized, fetchCompanyInfo]);

    // 未認証時はリセット
    useEffect(() => {
        if (status === 'unauthenticated') {
            setCompanyInfo(null);
            setIsInitialized(false);
        }
    }, [status]);

    // Realtime subscription（初回データ取得後のみ）
    useEffect(() => {
        if (status !== 'authenticated' || !isInitialized || realtimeSetup) return;

        let channel: RealtimeChannel | null = null;
        setRealtimeSetup(true);

        const setupRealtimeSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                channel = supabase
                    .channel('company-info-realtime')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'CompanyInfo' }, () => {
                        fetchCompanyInfo();
                    })
                    .subscribe();
            } catch (error) {
                console.error('[Realtime] Failed to setup company info subscription:', error);
            }
        };

        setupRealtimeSubscription();

        return () => {
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channelToRemove);
                });
            }
        };
    }, [status, isInitialized, realtimeSetup, fetchCompanyInfo]);

    const updateCompanyInfo = useCallback(async (data: CompanyInfoInput) => {
        const response = await fetch('/api/master-data/company', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (response.ok) {
            const updated = await response.json();
            setCompanyInfo({
                ...updated,
                createdAt: new Date(updated.createdAt),
                updatedAt: new Date(updated.updatedAt),
            });
        }
    }, []);

    return (
        <CompanyContext.Provider value={{ companyInfo, isLoading, isInitialized, ensureDataLoaded, updateCompanyInfo, refreshCompanyInfo: fetchCompanyInfo }}>
            {children}
        </CompanyContext.Provider>
    );
}

export function useCompany() {
    const context = useContext(CompanyContext);
    if (context === undefined) {
        throw new Error('useCompany must be used within a CompanyProvider');
    }
    return context;
}
