'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CalendarDays, CheckCircle2, ClipboardList, Loader2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import { isManagerOrAbove } from '@/utils/permissions';
import StocktakeInput from './StocktakeInput';
import StocktakeTrend from './StocktakeTrend';

interface StorageLocation {
    id: string;
    name: string;
}

interface StocktakeSummary {
    id: string;
    date: string;
    status: string;
    scaffoldMethod: string;
    location: { id: string; name: string };
    notes: string | null;
    createdByName: string;
    confirmedAt: string | null;
    lineCount: number;
    countedCount: number;
    totalQuantity: number;
}

type TabKey = 'list' | 'trend';

const METHOD_LABEL: Record<string, string> = { standard: '通常足場', lock: 'ロック足場' };

function formatJstDate(value: string): string {
    const d = new Date(value);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')}`;
}

/** 今日を YYYY-MM-DD（JST）で返す */
function todayJst(): string {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
}

export default function StocktakePage() {
    const { data: session } = useSession();
    const canManage = isManagerOrAbove(session?.user);

    const [tab, setTab] = useState<TabKey>('list');
    const [locations, setLocations] = useState<StorageLocation[]>([]);
    const [stocktakes, setStocktakes] = useState<StocktakeSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [openId, setOpenId] = useState<string | null>(null);

    // 新規作成フォーム
    const [isCreating, setIsCreating] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ locationId: '', scaffoldMethod: 'standard', date: todayJst() });

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const [locRes, stRes] = await Promise.all([
                fetch('/api/master-data/storage-locations', { cache: 'no-store' }),
                fetch('/api/materials/stocktakes', { cache: 'no-store' }),
            ]);
            if (locRes.ok) {
                const locs: StorageLocation[] = await locRes.json();
                setLocations(locs);
                setForm((f) => (f.locationId ? f : { ...f, locationId: locs[0]?.id ?? '' }));
            }
            if (stRes.ok) setStocktakes(await stRes.json());
        } catch {
            toast.error('棚卸の読み込みに失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const create = useCallback(async () => {
        if (isCreating) return;
        if (!form.locationId) {
            toast.error('置き場所を選んでください');
            return;
        }
        setIsCreating(true);
        try {
            const res = await fetch('/api/materials/stocktakes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? '作成に失敗しました');
            toast.success(`棚卸を作成しました（${data.lineCount}品目）`);
            setShowCreate(false);
            await load();
            setOpenId(data.id);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '作成に失敗しました');
        } finally {
            setIsCreating(false);
        }
    }, [form, isCreating, load]);

    const remove = useCallback(
        async (id: string) => {
            if (!window.confirm('この棚卸を削除します。よろしいですか？')) return;
            try {
                const res = await fetch(`/api/materials/stocktakes/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error ?? '削除に失敗しました');
                toast.success('削除しました');
                await load();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : '削除に失敗しました');
            }
        },
        [load],
    );

    const grouped = useMemo(() => {
        const map = new Map<string, StocktakeSummary[]>();
        for (const s of stocktakes) {
            const key = `${s.location.name} / ${METHOD_LABEL[s.scaffoldMethod] ?? s.scaffoldMethod}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(s);
        }
        return [...map.entries()];
    }, [stocktakes]);

    if (openId) {
        return (
            <StocktakeInput
                stocktakeId={openId}
                canConfirm={canManage}
                onBack={() => {
                    setOpenId(null);
                    void load();
                }}
            />
        );
    }

    return (
        <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-lg font-semibold text-slate-800">棚卸</h1>
                    <p className="text-xs text-slate-400 mt-0.5">
                        置き場所ごとに実際に数えた数を記録します。確定すると在庫に反映されます。
                    </p>
                </div>
                {canManage && tab === 'list' && (
                    <Button variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
                        棚卸を始める
                    </Button>
                )}
            </div>

            {/* タブ */}
            <div className="flex gap-1 border-b border-slate-200">
                {([
                    { key: 'list' as const, label: '棚卸一覧', icon: ClipboardList },
                    { key: 'trend' as const, label: '推移', icon: CalendarDays },
                ]).map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            tab === key
                                ? 'border-teal-500 text-teal-700'
                                : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <Icon className="w-4 h-4" />
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'trend' ? (
                <StocktakeTrend />
            ) : isLoading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                </div>
            ) : stocktakes.length === 0 ? (
                <div className="text-center py-16 text-sm text-slate-400">
                    <ClipboardList className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                    まだ棚卸がありません。
                    {canManage && <br />}
                    {canManage && '「棚卸を始める」から作成してください。'}
                </div>
            ) : (
                <div className="space-y-6">
                    {grouped.map(([key, list]) => (
                        <div key={key}>
                            <h2 className="text-sm font-semibold text-slate-600 mb-2">{key}</h2>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {list.map((s) => {
                                    const confirmed = s.status === 'confirmed';
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            onClick={() => setOpenId(s.id)}
                                            className="text-left border border-slate-200 rounded-xl p-3 hover:border-teal-300 hover:bg-teal-50/30 transition-colors"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-base font-semibold text-slate-800">
                                                    {formatJstDate(s.date)}
                                                </span>
                                                {confirmed ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-medium">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        確定
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                                                        入力中
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1.5">
                                                {s.countedCount} / {s.lineCount} 品目
                                                {s.countedCount > 0 && ` ・ 合計 ${s.totalQuantity.toLocaleString()}`}
                                            </p>
                                            {s.createdByName && (
                                                <p className="text-xs text-slate-400 mt-0.5">{s.createdByName}</p>
                                            )}
                                            {canManage && !confirmed && (
                                                <span
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void remove(s.id);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.stopPropagation();
                                                            void remove(s.id);
                                                        }
                                                    }}
                                                    className="mt-2 inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    削除
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 新規作成 */}
            {showCreate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
                        <h2 className="text-base font-semibold text-slate-800">棚卸を始める</h2>
                        <div className="space-y-3">
                            <div>
                                <label htmlFor="stocktake-location" className="block text-xs text-slate-500 mb-1">
                                    置き場所
                                </label>
                                <select
                                    id="stocktake-location"
                                    value={form.locationId}
                                    onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                                    className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                                >
                                    {locations.map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {l.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <span className="block text-xs text-slate-500 mb-1">工法</span>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['standard', 'lock'] as const).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setForm((f) => ({ ...f, scaffoldMethod: m }))}
                                            className={`h-11 rounded-xl text-sm border transition-colors ${
                                                form.scaffoldMethod === m
                                                    ? 'bg-teal-50 border-teal-300 text-teal-700 font-medium'
                                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            {METHOD_LABEL[m]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label htmlFor="stocktake-date" className="block text-xs text-slate-500 mb-1">
                                    棚卸日
                                </label>
                                <input
                                    id="stocktake-date"
                                    type="date"
                                    value={form.date}
                                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                                    className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="outline" onClick={() => setShowCreate(false)}>
                                キャンセル
                            </Button>
                            <Button variant="primary" isLoading={isCreating} onClick={() => void create()}>
                                作成
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
