'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Smartphone, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

// 通知種別ラベル（API 側 ALL_TYPES と同期）
const SCOPED_TYPES = [
    { type: 'work-started', label: '開始報告' },
    { type: 'work-ended', label: '完了報告' },
    { type: 'project-master-created', label: '新規案件登録' },
    { type: 'road_permit_expiry', label: '道路使用許可期限' },
] as const;
const ONOFF_ONLY_TYPES = [
    { type: 'dispatch-confirmed', label: '手配確定' },
    { type: 'chat-message', label: 'チャット' },
] as const;
const SCOPED_TYPE_SET = new Set<string>(SCOPED_TYPES.map((t) => t.type));

type ScopeValue = 'all' | 'mine';
interface PreferenceRow {
    type: string;
    enabled: boolean;
    scope: ScopeValue;
}

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

    // 通知種別ごとの個人設定
    const [preferences, setPreferences] = useState<PreferenceRow[] | null>(null);
    const [prefsSaving, setPrefsSaving] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // 通知種別設定を取得
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/notification-preferences', { cache: 'no-store' });
                if (!res.ok) return;
                const json = (await res.json()) as { preferences: PreferenceRow[] };
                if (!cancelled) setPreferences(json.preferences);
            } catch {
                // 取得失敗時はサイレント。次回オープン時に再試行。
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // 設定変更を 400ms debounce でサーバーに反映
    const scheduleSave = (next: PreferenceRow[]) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            setPrefsSaving(true);
            try {
                const res = await fetch('/api/notification-preferences', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preferences: next }),
                });
                if (!res.ok) {
                    toast.error('通知設定の保存に失敗しました');
                }
            } catch {
                toast.error('通知設定の保存に失敗しました');
            } finally {
                setPrefsSaving(false);
            }
        }, 400);
    };

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, []);

    const updatePref = (type: string, patch: Partial<PreferenceRow>) => {
        if (!preferences) return;
        const next = preferences.map((p) => (p.type === type ? { ...p, ...patch } : p));
        setPreferences(next);
        scheduleSave(next);
    };

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

            {/* 通知種別ごとの設定 */}
            <div className="mt-8 pt-6 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-slate-900">通知の種類</h3>
                    {prefsSaving && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                            <Loader2 className="w-3 h-3 animate-spin" /> 保存中
                        </span>
                    )}
                </div>
                <p className="text-sm text-slate-500 mb-4">
                    受信する通知の種類と範囲を選択できます。「自分の現場のみ」は案件マスタの担当者に自分が含まれる案件のみ通知します。
                </p>

                {preferences === null ? (
                    <div className="py-6 text-center text-sm text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> 読み込み中...
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                        {[...SCOPED_TYPES, ...ONOFF_ONLY_TYPES].map(({ type, label }) => {
                            const pref = preferences.find((p) => p.type === type);
                            if (!pref) return null;
                            const isScoped = SCOPED_TYPE_SET.has(type);
                            return (
                                <li key={type} className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
                                    <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={pref.enabled}
                                            onChange={(e) => updatePref(type, { enabled: e.target.checked })}
                                            className="w-5 h-5 text-slate-700 border-slate-300 rounded focus:ring-slate-500 flex-shrink-0"
                                        />
                                        <span className="text-sm font-medium text-slate-800 truncate">{label}</span>
                                    </label>
                                    {isScoped && (
                                        <select
                                            value={pref.scope}
                                            disabled={!pref.enabled}
                                            onChange={(e) => updatePref(type, { scope: e.target.value as ScopeValue })}
                                            className="text-xs border border-slate-200 rounded-xl px-2 py-1.5 shadow-sm focus:ring-2 focus:ring-slate-500 disabled:bg-slate-50 disabled:text-slate-400 flex-shrink-0"
                                        >
                                            <option value="all">全件</option>
                                            <option value="mine">自分の現場のみ</option>
                                        </select>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <div className="mt-3 text-xs text-slate-500">
                    ・「自分の現場のみ」は案件マスタ画面の<span className="font-medium">案件担当</span>に自分が登録されている案件が対象です。
                </div>
            </div>
        </div>
    );
}
