'use client';

import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Smartphone, CheckCircle2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const buf = new ArrayBuffer(raw.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
    return buf;
}

function detectIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const iPadOS = navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1;
    return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

function isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS Safari は display-mode を返さないので navigator.standalone を見る
    return Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
}

export default function NotificationSettings() {
    const [permission, setPermission] = useState<PermissionState>('default');
    const [subscribed, setSubscribed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [ios, setIos] = useState(false);
    const [standalone, setStandalone] = useState(false);

    useEffect(() => {
        setIos(detectIOS());
        setStandalone(isStandalone());

        if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
            setPermission('unsupported');
            return;
        }
        setPermission(Notification.permission as PermissionState);

        navigator.serviceWorker.ready
            .then((reg) => reg.pushManager.getSubscription())
            .then((sub) => setSubscribed(!!sub))
            .catch(() => setSubscribed(false));
    }, []);

    const handleEnable = async () => {
        if (permission === 'unsupported') {
            toast.error('このブラウザは通知に対応していません');
            return;
        }
        setLoading(true);
        try {
            const perm = await Notification.requestPermission();
            setPermission(perm as PermissionState);
            if (perm !== 'granted') {
                toast.error('通知が許可されませんでした');
                return;
            }

            const keyRes = await fetch('/api/push/vapid-public-key', { cache: 'no-store' });
            if (!keyRes.ok) {
                toast.error('サーバー側のプッシュ通知設定が未完了です');
                return;
            }
            const { publicKey } = (await keyRes.json()) as { publicKey: string };

            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToArrayBuffer(publicKey),
                });
            }

            const res = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub.toJSON() }),
            });
            if (!res.ok) {
                toast.error('購読の登録に失敗しました');
                return;
            }
            setSubscribed(true);
            toast.success('通知を有効にしました');
        } catch (err) {
            console.error('[Push] enable failed', err);
            toast.error('通知の有効化に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleDisable = async () => {
        setLoading(true);
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await fetch('/api/push/subscribe', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint }),
                });
                await sub.unsubscribe();
            }
            setSubscribed(false);
            toast.success('通知を無効にしました');
        } catch (err) {
            console.error('[Push] disable failed', err);
            toast.error('通知の解除に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleTest = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/push/test', { method: 'POST' });
            const json = await res.json();
            if (!res.ok) {
                toast.error('テスト通知の送信に失敗しました');
                return;
            }
            if (json.sent === 0) {
                toast('購読済みの端末がありません');
            } else {
                toast.success(`テスト通知を送信しました（${json.sent}端末）`);
            }
        } finally {
            setLoading(false);
        }
    };

    const iosNeedsInstall = ios && !standalone;

    return (
        <div className="max-w-2xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">プッシュ通知</h3>
            <p className="text-sm text-slate-500 mb-6">
                手配が確定されたときなどに、端末に通知を送信します。
            </p>

            {permission === 'unsupported' && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">
                        このブラウザは Web Push に対応していません。最新の Chrome / Edge / Safari をご利用ください。
                    </div>
                </div>
            )}

            {iosNeedsInstall && (
                <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl mb-4">
                    <Smartphone className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900 space-y-1">
                        <div className="font-semibold">iPhone / iPad では「ホーム画面に追加」が必要です</div>
                        <ol className="list-decimal list-inside space-y-0.5 text-blue-800">
                            <li>Safari で共有ボタン（□↑）をタップ</li>
                            <li>「ホーム画面に追加」を選択</li>
                            <li>ホーム画面の DandoLink アイコンから開く</li>
                            <li>この設定画面に戻り、改めて「通知を有効にする」を押す</li>
                        </ol>
                        <div className="text-xs text-blue-700 pt-1">※ iOS 16.4 以降が必要です。</div>
                    </div>
                </div>
            )}

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4">
                <div className="flex items-center gap-2 mb-1 text-sm">
                    <span className="text-slate-500">状態:</span>
                    {subscribed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-4 h-4" /> この端末で通知は有効
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                            <BellOff className="w-4 h-4" /> この端末で通知は未設定
                        </span>
                    )}
                </div>
                <div className="text-xs text-slate-500">
                    許可状態: {permission === 'granted' ? '許可済み' : permission === 'denied' ? '拒否済み（ブラウザ設定から変更してください）' : '未設定'}
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {!subscribed ? (
                    <button
                        onClick={handleEnable}
                        disabled={loading || permission === 'unsupported' || iosNeedsInstall}
                        className="px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all duration-200 font-medium flex items-center justify-center gap-2 shadow-md hover:shadow-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Bell className="w-4 h-4" />
                        通知を有効にする
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handleTest}
                            disabled={loading}
                            className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-100 transition-all duration-200 font-medium flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                        >
                            <Bell className="w-4 h-4" />
                            テスト通知を送る
                        </button>
                        <button
                            onClick={handleDisable}
                            disabled={loading}
                            className="px-4 py-2.5 border border-slate-300 text-slate-600 rounded-xl hover:bg-slate-100 transition-all duration-200 font-medium flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                        >
                            <BellOff className="w-4 h-4" />
                            通知を無効にする
                        </button>
                    </>
                )}
            </div>

            <div className="mt-6 text-xs text-slate-500 space-y-1">
                <div>・通知は端末ごとに設定が必要です（スマホ・iPad・PCで別々）。</div>
                <div>・通知を許可後にブラウザ設定で再度ブロックした場合は、ブラウザの通知設定から許可に戻してください。</div>
            </div>
        </div>
    );
}
