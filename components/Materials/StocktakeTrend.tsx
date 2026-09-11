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
    // 最初は読み込み中にしておく。false で始めると、置き場所を取りに行っている間に
    // 「確定済みの棚卸がまだありません」が一瞬出てしまう
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        void (async () => {
            try {
                const res = await fetch('/api/master-data/storage-locations', { cache: 'no-store' });
                if (!res.ok) throw new Error();
                const locs: StorageLocation[] = await res.json();
                setLocations(locs);
                setLocationId((prev) => prev || locs[0]?.id || '');
                // 置き場所が 1 つも無いと推移の読み込みが始まらないので、ここで読み込み中を解く
                if (locs.length === 0) setIsLoading(false);
            } catch {
                toast.error('置き場所の読み込みに失敗しました');
                setIsLoading(false);
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

    // 開いたときは右端（最新の棚卸）が見える位置から始める（kei 指定）。
    // 日付は古い→新しいの順に左から並べているので、何もしないと最新が画面の外の右にある。
    // 表は読み込み中に一度消えて作り直されるので、置き場所・工法・回数を切り替えるたびに右端へ戻る。
    // 品名で絞り込むだけなら表は作り直されず、見ていた位置のまま。
    // useEffect だと一瞬左端が映ってから飛ぶので、描画前に走る callback ref で動かす
    const scrollToLatest = useCallback((el: HTMLDivElement | null) => {
        if (el) el.scrollLeft = el.scrollWidth;
    }, []);

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
                // 表の中だけで縦横にスクロールさせる（ページ全体は伸ばさない）。
                // 高さを約 20 行分に抑え、画面が低いときは画面に収まる高さにして、
                // 下までスクロールしなくても横スクロールバーに届くようにする（kei 指定）。
                // 見出し行は上、品目名の列は左に固定するので、どこまでスクロールしても何の数か分かる。
                // 地の色（main の slate-50）が透けないよう背景は白で塗る
                <div
                    ref={scrollToLatest}
                    className="max-h-[max(320px,min(700px,calc(100vh_-_270px)))] overflow-auto rounded-xl border border-slate-200 bg-white"
                >
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr>
                                <th className="sticky left-0 top-0 z-30 min-w-[160px] bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 shadow-[inset_-1px_-1px_0_#e2e8f0]">
                                    品目
                                </th>
                                {data.dates.map((d) => (
                                    <th
                                        key={d}
                                        className="sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 text-right font-medium text-slate-600 shadow-[inset_0_-1px_0_#e2e8f0]"
                                    >
                                        {formatShortDate(d)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((cat) => (
                                <React.Fragment key={cat.id}>
                                    {/* カテゴリ名は品目名の列に置いて左に固定する（横にスクロールしても消えないように） */}
                                    <tr>
                                        <td className="sticky left-0 z-10 whitespace-nowrap bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-[inset_-1px_0_0_#e2e8f0]">
                                            {cat.name}
                                        </td>
                                        <td colSpan={data.dates.length} className="bg-slate-100" />
                                    </tr>
                                    {cat.items.map((item) => (
                                        // カーソルを合わせた行を色で追えるようにする。
                                        // 行（tr）の背景だけだと自前の背景を持つ固定列が塗られないので、全セルに group-hover を付ける。
                                        // 色は teal-100。teal-50 は地の slate-50 とほぼ同じ色で見分けがつかなかった。
                                        // 素早く動かしたときに色が遅れて付いて行を見失わないよう transition は付けない
                                        <tr key={item.materialItemId} className="group border-t border-slate-100">
                                            <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 text-slate-700 shadow-[inset_-1px_0_0_#e2e8f0] group-hover:bg-teal-100 group-hover:text-teal-900">
                                                {item.name}
                                                {!item.isActive && (
                                                    <span className="ml-1 text-xs text-slate-400">（停止）</span>
                                                )}
                                            </td>
                                            {item.values.map((v, i) => (
                                                <td
                                                    key={`${item.materialItemId}-${i}`}
                                                    title={item.notes[i] ?? undefined}
                                                    className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums group-hover:bg-teal-100 ${
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
