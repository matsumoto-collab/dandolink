/**
 * Supabase Realtime broadcast シングルトン
 *
 * - チャンネルは1クライアントにつき1つだけ作成（重複接続防止）
 * - sendBroadcast: イベントを全接続クライアントへ即時送信
 * - onBroadcast: イベント受信リスナーを登録（クリーンアップ関数を返す）
 * - Supabase broadcast はデフォルト self: false のため自己送信は受信しない
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

type BroadcastListener = (payload: Record<string, unknown>) => void;

const listeners = new Map<string, Set<BroadcastListener>>();
let channel: RealtimeChannel | null = null;
let initialized = false;

/** 認証後に呼び出す。複数回呼んでも1回しか初期化しない */
export function initBroadcastChannel(): void {
    if (initialized) return;
    initialized = true;

    import('./supabase')
        .then(({ supabase }) => {
            const ch = supabase
                .channel('yusystem_broadcast_v1')
                .on(
                    'broadcast',
                    { event: '*' },
                    (msg: { event: string; payload: Record<string, unknown> }) => {
                        listeners.get(msg.event)?.forEach(fn => fn(msg.payload ?? {}));
                    }
                )
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        channel = ch;
                    }
                });
        })
        .catch((err) => {
            console.error('Failed to init broadcast channel:', err);
            initialized = false; // 失敗したらリトライ可能にする
        });
}

/** イベントを全接続クライアントへ送信（チャンネル未準備なら無視） */
export function sendBroadcast(event: string, payload: Record<string, unknown> = {}): void {
    channel?.send({ type: 'broadcast', event, payload });
}

/** イベント受信リスナーを登録。戻り値のクリーンアップ関数をuseEffectで呼ぶこと */
export function onBroadcast(event: string, callback: BroadcastListener): () => void {
    if (!listeners.has(event)) {
        listeners.set(event, new Set());
    }
    listeners.get(event)!.add(callback);
    return () => {
        listeners.get(event)?.delete(callback);
    };
}
