'use client';

import { useEffect } from 'react';
import toast, { useToasterStore } from 'react-hot-toast';
import { TOAST_DURATIONS } from '@/lib/toastConfig';

// react-hot-toast はトーストにマウスが乗ると自動消去を一時停止する(pausedAt)が、
// ホバー中のトーストが DOM から消えると mouseleave が発火せず一時停止が解除されないまま固着し、
// 以後セッション中の全トーストが自動で消えなくなる（コンテナは pointer-events:none のため
// マウスを動かしても mouseleave は二度と来ない）。
// このコンポーネントは一時停止状態を無視して「表示時間 + 猶予」で必ず dismiss する保険。
const GRACE_MS = 1000;

export default function ToastWatchdog() {
    // Toaster(layout.tsx) と同じ duration 設定を渡し、各トーストの解決済み表示時間を揃える
    const { toasts } = useToasterStore({
        duration: TOAST_DURATIONS.default,
        success: { duration: TOAST_DURATIONS.success },
        error: { duration: TOAST_DURATIONS.error },
    });

    useEffect(() => {
        const timers = toasts
            .filter(t => t.visible && t.duration !== Infinity)
            .map(t => {
                const expireAt = t.createdAt + (t.duration ?? TOAST_DURATIONS.default) + GRACE_MS;
                const left = expireAt - Date.now();
                if (left <= 0) {
                    toast.dismiss(t.id);
                    return undefined;
                }
                return setTimeout(() => toast.dismiss(t.id), left);
            });
        return () => {
            timers.forEach(id => id !== undefined && clearTimeout(id));
        };
    }, [toasts]);

    return null;
}
