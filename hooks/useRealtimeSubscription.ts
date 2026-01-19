import { useEffect, useRef, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseRealtimeSubscriptionOptions {
    /**
     * Supabaseテーブル名
     */
    table: string;
    /**
     * チャンネル名（一意である必要がある）
     */
    channelName: string;
    /**
     * データ変更時のコールバック
     */
    onDataChange: () => void;
    /**
     * サブスクリプションを有効にするかどうか
     */
    enabled?: boolean;
    /**
     * デバウンス時間（ミリ秒）
     */
    debounceMs?: number;
}

/**
 * Supabase Realtimeサブスクリプションを管理するカスタムフック
 *
 * @example
 * ```tsx
 * useRealtimeSubscription({
 *     table: 'Customer',
 *     channelName: 'customers-changes',
 *     onDataChange: fetchCustomers,
 *     enabled: status === 'authenticated' && isInitialized,
 * });
 * ```
 */
export function useRealtimeSubscription({
    table,
    channelName,
    onDataChange,
    enabled = true,
    debounceMs = 0,
}: UseRealtimeSubscriptionOptions) {
    const channelRef = useRef<RealtimeChannel | null>(null);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isSetupRef = useRef(false);

    // デバウンス付きのデータ変更ハンドラー
    const handleDataChange = useCallback(() => {
        if (debounceMs > 0) {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = setTimeout(() => {
                onDataChange();
            }, debounceMs);
        } else {
            onDataChange();
        }
    }, [onDataChange, debounceMs]);

    useEffect(() => {
        // 有効でない場合、または既にセットアップ済みの場合はスキップ
        if (!enabled || isSetupRef.current) return;

        isSetupRef.current = true;

        const setupSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                channelRef.current = supabase
                    .channel(channelName)
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table },
                        handleDataChange
                    )
                    .subscribe();
            } catch (error) {
                console.error(`[Realtime] Failed to setup ${channelName} subscription:`, error);
            }
        };

        setupSubscription();

        // クリーンアップ
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }

            const channel = channelRef.current;
            if (channel) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channel);
                });
                channelRef.current = null;
            }
        };
    }, [enabled, channelName, table, handleDataChange]);

    // 手動でサブスクリプションをリセット
    const reset = useCallback(() => {
        isSetupRef.current = false;
    }, []);

    return { reset };
}

/**
 * 複数テーブルのRealtimeサブスクリプションを管理
 *
 * @example
 * ```tsx
 * useMultipleRealtimeSubscriptions({
 *     channelPrefix: 'master-data',
 *     tables: ['Vehicle', 'Employee', 'Manager'],
 *     onDataChange: fetchMasterData,
 *     enabled: status === 'authenticated',
 * });
 * ```
 */
export function useMultipleRealtimeSubscriptions({
    channelPrefix,
    tables,
    onDataChange,
    enabled = true,
}: {
    channelPrefix: string;
    tables: string[];
    onDataChange: () => void;
    enabled?: boolean;
}) {
    const channelsRef = useRef<RealtimeChannel[]>([]);
    const isSetupRef = useRef(false);

    useEffect(() => {
        if (!enabled || isSetupRef.current) return;

        isSetupRef.current = true;

        const setupSubscriptions = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                channelsRef.current = tables.map((table) =>
                    supabase
                        .channel(`${channelPrefix}-${table.toLowerCase()}`)
                        .on(
                            'postgres_changes',
                            { event: '*', schema: 'public', table },
                            onDataChange
                        )
                        .subscribe()
                );
            } catch (error) {
                console.error(`[Realtime] Failed to setup ${channelPrefix} subscriptions:`, error);
            }
        };

        setupSubscriptions();

        return () => {
            const channels = channelsRef.current;
            if (channels.length > 0) {
                import('@/lib/supabase').then(({ supabase }) => {
                    channels.forEach((channel) => {
                        supabase.removeChannel(channel);
                    });
                });
                channelsRef.current = [];
            }
        };
    }, [enabled, channelPrefix, tables, onDataChange]);
}
