'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { CompanyInfo, CompanyInfoInput } from '@/types/company';

interface CompanyContextType {
    companyInfo: CompanyInfo | null;
    isLoading: boolean;
    updateCompanyInfo: (data: CompanyInfoInput) => Promise<void>;
    refreshCompanyInfo: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
    const { status } = useSession();
    const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch from API
    const fetchCompanyInfo = useCallback(async () => {
        if (status !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        try {
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
        }
    }, [status]);

    useEffect(() => {
        fetchCompanyInfo();
    }, [fetchCompanyInfo]);

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
            isSubscribed = false;
            if (channel) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channel);
                });
            }
        };
    }, [status, fetchCompanyInfo]);

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
        <CompanyContext.Provider value={{ companyInfo, isLoading, updateCompanyInfo, refreshCompanyInfo: fetchCompanyInfo }}>
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
