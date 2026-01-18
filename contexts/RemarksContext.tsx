'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface RemarksData {
    [dateKey: string]: string; // dateKey (YYYY-MM-DD) -> remark text
}

interface RemarksContextType {
    remarks: RemarksData;
    isLoading: boolean;
    setRemark: (dateKey: string, text: string) => Promise<void>;
    getRemark: (dateKey: string) => string;
    refreshRemarks: () => Promise<void>;
}

const RemarksContext = createContext<RemarksContextType | undefined>(undefined);

export function RemarksProvider({ children }: { children: ReactNode }) {
    const { status } = useSession();
    const [remarks, setRemarks] = useState<RemarksData>({});
    const [isLoading, setIsLoading] = useState(true);

    // Fetch from API
    const fetchRemarks = useCallback(async () => {
        if (status !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/calendar/remarks');
            if (response.ok) {
                const data = await response.json();
                setRemarks(data);
            }
        } catch (error) {
            console.error('Failed to fetch remarks:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    useEffect(() => {
        fetchRemarks();
    }, [fetchRemarks]);

    // Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: RealtimeChannel | null = null;
        let isSubscribed = true;

        const setupRealtimeSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                if (!isSubscribed) return;

                channel = supabase
                    .channel('remarks-realtime')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'CalendarRemark' }, () => {
                        fetchRemarks();
                    })
                    .subscribe();
            } catch (error) {
                console.error('[Realtime] Failed to setup remarks subscription:', error);
            }
        };

        setupRealtimeSubscription();

        return () => {
            isSubscribed = false;
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channelToRemove);
                });
            }
        };
    }, [status, fetchRemarks]);

    const setRemark = useCallback(async (dateKey: string, text: string) => {
        // Optimistic update
        setRemarks(prev => ({
            ...prev,
            [dateKey]: text,
        }));

        try {
            await fetch('/api/calendar/remarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateKey, text }),
            });
        } catch (error) {
            console.error('Failed to set remark:', error);
            // Revert on error
            fetchRemarks();
        }
    }, [fetchRemarks]);

    const getRemark = useCallback((dateKey: string): string => {
        return remarks[dateKey] || '';
    }, [remarks]);

    return (
        <RemarksContext.Provider value={{ remarks, isLoading, setRemark, getRemark, refreshRemarks: fetchRemarks }}>
            {children}
        </RemarksContext.Provider>
    );
}

export function useRemarks() {
    const context = useContext(RemarksContext);
    if (context === undefined) {
        throw new Error('useRemarks must be used within a RemarksProvider');
    }
    return context;
}
