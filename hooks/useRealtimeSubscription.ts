import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * タブの可視状態を監視する共通フック
 * - バックグラウンド時に false を返し、WebSocket購読を停止してバッテリー消費を抑える
 */
export function usePageVisible(): boolean {
    const [isVisible, setIsVisible] = useState(() => {
        if (typeof document === 'undefined') return true;
        return document.visibilityState === 'visible';
    });

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const onChange = () => setIsVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onChange);
        return () => document.removeEventListener('visibilitychange', onChange);
    }, []);

    return isVisible;
}

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
    const isVisible = usePageVisible();
    const effectivelyEnabled = enabled && isVisible;

    // コールバックをrefで保持し、チャンネル再接続を防ぐ
    const onDataChangeRef = useRef(onDataChange);
    onDataChangeRef.current = onDataChange;

    useEffect(() => {
        if (!effectivelyEnabled) {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
            return;
        }

        // Clean up existing channel if any
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
        }

        try {
            const channel = supabase.channel(channelName)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table },
                    (payload: RealtimePayload) => {
                        if (debounceMs > 0) {
                            if (timeoutRef.current) {
                                clearTimeout(timeoutRef.current);
                            }
                            timeoutRef.current = setTimeout(() => {
                                onDataChangeRef.current(payload);
                            }, debounceMs);
                        } else {
                            onDataChangeRef.current(payload);
                        }
                    }
                )
                .subscribe();

            channelRef.current = channel;
        } catch (error) {
            logger.error(`[Realtime] Failed to setup ${channelName} subscription:`, error);
        }

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectivelyEnabled, channelName, table, debounceMs]);

    const reset = useCallback(() => {
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
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
    const isVisible = usePageVisible();
    const effectivelyEnabled = enabled && isVisible;

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
        if (!effectivelyEnabled) return;

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
    }, [effectivelyEnabled, configKeyRef.current]);
}
