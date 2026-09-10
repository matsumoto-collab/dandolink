'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import MaterialSearchBar from './ui/MaterialSearchBar';

interface StorageLocation {
    id: string;
    name: string;
}

interface TrendItem {
    materialItemId: string;
    name: string;
    unit: string;
    isActive: boolean;
    values: (number | null)[];
    notes: (string | null)[];
}

interface TrendCategory {
    id: string;
    name: string;
    items: TrendItem[];
}

interface TrendResponse {
    dates: string[];
    categories: TrendCategory[];
}

const METHOD_LABEL: Record<string, string> = { standard: '通常足場', lock: 'ロック足場' };

function formatShortDate(value: string): string {
    const d = new Date(value);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${String(jst.getUTCFullYear()).slice(2)}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

/**
 * 棚卸の推移（品目 × 棚卸日）。
 * エクセルの横持ち表と同じ見え方だが、列は新しい方から一定回数だけ出すので
 * 何回棚卸しても横に伸び続けない。
 */
export default function StocktakeTrend() {
    const [locations, setLocations] = useState<StorageLocation[]>([]);
    const [locationId, setLocationId] = useState('');
    const [method, setMethod] = useState<'standard' | 'lock'>('standard');
    const [limit, setLimit] = useState(12);
    const [data, setData] = useState<TrendResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        void (async () => {
            try {
                const res = await fetch('/api/master-data/storage-locations', { cache: 'no-store' });
                if (!res.ok) return;
                const locs: StorageLocation[] = await res.json();
                setLocations(locs);
                setLocationId((prev) => prev || locs[0]?.id || '');
            } catch {
                toast.error('置き場所の読み込みに失敗しました');
            }
        })();
    }, []);

    const load = useCallback(async () => {
        if (!locationId) return;
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ locationId, scaffoldMethod: method, limit: String(limit) });
            const res = await fetch(`/api/materials/stocktakes/history?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error();
            setData(await res.json());
        } catch {
            toast.error('推移の読み込みに失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [locationId, method, limit]);

    useEffect(() => {
        void load();
    }, [load]);

    const filtered = useMemo(() => {
        if (!data) return [];
        const term = searchTerm.trim().toLowerCase();
        if (!term) return data.categories;
        return data.categories
            .map((c) => ({
                ...c,
                items: c.items.filter(
                    (i) => c.name.toLowerCase().includes(term) || i.name.toLowerCase().includes(term),
                ),
            }))
            .filter((c) => c.items.length > 0);
    }, [data, searchTerm]);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    aria-label="置き場所"
                    className="h-10 px-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                >
                    {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.name}
                        </option>
                    ))}
                </select>
                <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                    {(['standard', 'lock'] as const).map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setMethod(m)}
                            className={`px-3 h-10 text-sm transition-colors ${
                                method === m ? 'bg-teal-50 text-teal-700 font-medium' : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            {METHOD_LABEL[m]}
                        </button>
                    ))}
                </div>
                <select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    aria-label="表示する回数"
                    className="h-10 px-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                >
                    {[6, 12, 24, 40].map((n) => (
                        <option key={n} value={n}>
                            直近{n}回
                        </option>
                    ))}
                </select>
                <div className="flex-1 min-w-[180px]">
                    <MaterialSearchBar value={searchTerm} onChange={setSearchTerm} placeholder="品名で探す" />
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                </div>
            ) : !data || data.dates.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-12">
                    確定済みの棚卸がまだありません。
                </p>
            ) : (
                // 列が多いので表だけ横スクロールさせる（ページ全体は横に伸ばさない）
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="sticky left-0 z-10 bg-slate-50 text-left font-medium text-slate-600 px-3 py-2 min-w-[160px]">
                                    品目
                                </th>
                                {data.dates.map((d) => (
                                    <th key={d} className="text-right font-medium text-slate-600 px-3 py-2 whitespace-nowrap">
                                        {formatShortDate(d)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((cat) => (
                                <React.Fragment key={cat.id}>
                                    <tr className="bg-slate-50/60">
                                        <td
                                            colSpan={data.dates.length + 1}
                                            className="sticky left-0 px-3 py-1.5 text-xs font-semibold text-slate-500"
                                        >
                                            {cat.name}
                                        </td>
                                    </tr>
                                    {cat.items.map((item) => (
                                        // 列が多く横に長い表なので、カーソルを合わせた行を色で追えるようにする。
                                        // 品目名の列は sticky で自前の背景を持つため group-hover で一緒に塗る
                                        <tr
                                            key={item.materialItemId}
                                            className="group border-t border-slate-100 transition-colors hover:bg-teal-50"
                                        >
                                            <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-slate-700 whitespace-nowrap transition-colors group-hover:bg-teal-50 group-hover:text-teal-800">
                                                {item.name}
                                                {!item.isActive && (
                                                    <span className="ml-1 text-xs text-slate-400">（停止）</span>
                                                )}
                                            </td>
                                            {item.values.map((v, i) => (
                                                <td
                                                    key={`${item.materialItemId}-${i}`}
                                                    title={item.notes[i] ?? undefined}
                                                    className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${
                                                        v === null ? 'text-slate-300' : 'text-slate-700'
                                                    }`}
                                                >
                                                    {v === null ? (item.notes[i] ? '※' : '—') : v.toLocaleString()}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {data && data.dates.length > 0 && (
                <p className="text-xs text-slate-400">
                    「—」は数えていない品目。「※」は数量が読み取れず但し書きだけ残っているもの（マウスを乗せると内容が出ます）。
                </p>
            )}
        </div>
    );
}
