import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/** Realtimeペイロードの型 */
export type RealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

export interface UseRealtimeSubscriptionOptions {
    table: string;
    channelName: string;
    onDataChange: (payload: RealtimePayload) => void;
    enabled?: boolean;
    debounceMs?: number;
}

export function useRealtimeSubscription({
    table,
    channelName,
    onDataChange,
    enabled = true,
    debounceMs = 0,
}: UseRealtimeSubscriptionOptions) {
    const channelRef = useRef<RealtimeChannel | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isSetupRef = useRef(false);

    const handleDataChange = useCallback((payload: RealtimePayload) => {
        if (debounceMs > 0) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                onDataChange(payload);
            }, debounceMs);
        } else {
            onDataChange(payload);
        }
    }, [onDataChange, debounceMs]);

    useEffect(() => {
        if (!enabled) {
            // Disable subscription if not enabled
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
                isSetupRef.current = false;
            }
            return;
        }

        const setupSubscription = () => {
            if (isSetupRef.current) return;

            // Clean up existing channel if any
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
            }

            try {
                const channel = supabase.channel(channelName)
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table },
                        handleDataChange
                    )
                    .subscribe();

                channelRef.current = channel;
                isSetupRef.current = true;
            } catch (error) {
                console.error(`[Realtime] Failed to setup ${channelName} subscription:`, error);
            }
        };

        setupSubscription();

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
                isSetupRef.current = false;
            }
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [enabled, channelName, table, handleDataChange]);

    const reset = useCallback(() => {
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
            isSetupRef.current = false;
        }
    }, []);

    return { reset };
}

/** 複数テーブルサブスクリプションの設定 */
export interface MultipleSubscriptionConfig {
    table: string;
    channelName: string;
    onDataChange: (payload: RealtimePayload) => void;
}

// 複数テーブルのサブスクリプション用Hook
export function useMultipleRealtimeSubscriptions(
    config: MultipleSubscriptionConfig[],
    enabled: boolean = true
) {
    // configをrefで保持してJSON.stringifyを避ける
    const configRef = useRef(config);
    const configKeyRef = useRef(config.map(c => `${c.table}:${c.channelName}`).join(','));

    // configの実質的な変更を検出
    const currentKey = config.map(c => `${c.table}:${c.channelName}`).join(',');
    if (currentKey !== configKeyRef.current) {
        configRef.current = config;
        configKeyRef.current = currentKey;
    }

    useEffect(() => {
        if (!enabled) return;

        const channels: RealtimeChannel[] = [];

        configRef.current.forEach(({ table, channelName, onDataChange }) => {
            const channel = supabase
                .channel(channelName)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table },
                    onDataChange
                )
                .subscribe();
            channels.push(channel);
        });

        return () => {
            channels.forEach((channel) => {
                supabase.removeChannel(channel);
            });
        };
    }, [enabled, configKeyRef.current]);
}
