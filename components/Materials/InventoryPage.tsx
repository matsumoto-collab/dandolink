'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useMaterialData } from '@/hooks/useMaterialData';
import { useSession } from 'next-auth/react';
import { useNavigation } from '@/contexts/NavigationContext';
import {
    Save, History, Package, AlertTriangle, AlertCircle, Truck, Plus, RotateCcw, X, MapPin, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { InventoryTransaction, MaterialItemWithStock } from '@/types/material';
import type { LentOutSite } from '@/lib/materials/lentOutByItem';
import { computeStockStatus, type StockStatus } from '@/lib/materials/stockStatus';
import MaterialSearchBar from './ui/MaterialSearchBar';
import CollapsibleCategory from './ui/CollapsibleCategory';
import QtyStepper from './ui/QtyStepper';
import StockBar from './ui/StockBar';
import StockStatusBadge from './ui/StockStatusBadge';
import SearchableSelect from '@/components/ui/SearchableSelect';

type TabKey = 'list' | 'sites' | 'history';

interface OverviewData {
    summary: Record<string, number>;
    sites: LentOutSite[];
}

interface ItemRow {
    item: MaterialItemWithStock;
    categoryId: string;
    categoryName: string;
    stock: number;
    lentOut: number;
    total: number;
    status: StockStatus;
    excluded: boolean;
}

interface HistoryReq {
    id: string;
    date: string;
    type: string;
    status: string;
    foremanName: string;
    projectTitle?: string;
    items?: { quantity: number; materialItem?: { name?: string } }[];
}

export default function InventoryPage() {
    const { categories, fetchCategories, isCategoriesInitialized } = useMaterialData();
    const { data: session } = useSession();
    const { setActivePage } = useNavigation();

    // --- 編集モード（manager 限定の在庫調整・既存機能を維持）---
    const [editMode, setEditMode] = useState(false);
    const [editQuantities, setEditQuantities] = useState<Record<string, number>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    // --- 一覧表示 ---
    const [activeTab, setActiveTab] = useState<TabKey>('list');
    const [selectedCat, setSelectedCat] = useState<string>('all');
    const [query, setQuery] = useState('');

    // --- 貸出中サマリー（現場へ出庫 / 所有総数 / 現場別逆引き）---
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [isOverviewLoading, setIsOverviewLoading] = useState(false);

    // --- 入出庫履歴タブ（伝票フィード・遅延取得）---
    const [historyReqs, setHistoryReqs] = useState<HistoryReq[] | null>(null);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);

    // --- 品目詳細モーダル（現場別逆引き ＋ 入出庫履歴）---
    const [detailItem, setDetailItem] = useState<MaterialItemWithStock | null>(null);

    useEffect(() => {
        if (!isCategoriesInitialized) fetchCategories();
    }, [isCategoriesInitialized, fetchCategories]);

    const fetchOverview = useCallback(async () => {
        setIsOverviewLoading(true);
        try {
            const res = await fetch('/api/materials/lent-out-overview', { cache: 'no-store' });
            if (res.ok) {
                setOverview(await res.json());
            }
        } catch {
            // 貸出中サマリーが取れなくても在庫一覧自体は表示する（lentOut=0 扱い）
        } finally {
            setIsOverviewLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOverview();
    }, [fetchOverview]);

    const isManager = session?.user?.role === 'admin' || session?.user?.role === 'manager';

    // 全品目を VM 化（在庫 / 貸出中 / 所有総数 / 状態）
    const rows = useMemo<ItemRow[]>(() => {
        const summary = overview?.summary ?? {};
        const out: ItemRow[] = [];
        for (const cat of categories) {
            for (const item of cat.items) {
                const stock = item.stockQuantity ?? 0;
                const excluded = item.excludeFromStockDecrement === true;
                const lentOut = excluded ? 0 : (summary[item.id] ?? 0);
                const total = stock + lentOut;
                out.push({
                    item,
                    categoryId: cat.id,
                    categoryName: cat.name,
                    stock,
                    lentOut,
                    total,
                    status: computeStockStatus(stock, total),
                    excluded,
                });
            }
        }
        return out;
    }, [categories, overview]);

    // KPI
    const kpi = useMemo(() => {
        const tracked = rows.filter(r => !r.excluded);
        return {
            managed: rows.length,
            low: tracked.filter(r => r.status === 'low').length,
            shortage: tracked.filter(r => r.status === 'shortage').length,
            sites: overview?.sites.length ?? 0,
        };
    }, [rows, overview]);

    // 在庫一覧タブのフィルタ適用後の行
    const q = query.trim().toLowerCase();
    const visibleRows = useMemo(() => {
        return rows.filter(r => {
            if (selectedCat !== 'all' && r.categoryId !== selectedCat) return false;
            if (q) {
                return r.categoryName.toLowerCase().includes(q) || r.item.name.toLowerCase().includes(q) || (r.item.spec ?? '').toLowerCase().includes(q);
            }
            return true;
        });
    }, [rows, selectedCat, q]);

    // 履歴タブを開いたら伝票フィードを取得
    useEffect(() => {
        if (activeTab !== 'history' || historyReqs !== null || isHistoryLoading) return;
        let cancelled = false;
        (async () => {
            setIsHistoryLoading(true);
            try {
                const res = await fetch('/api/materials/requisitions', { cache: 'no-store' });
                if (res.ok && !cancelled) {
                    const data: HistoryReq[] = await res.json();
                    setHistoryReqs(
                        data
                            .filter(r => r.status === 'loaded' && (r.type === '出庫' || r.type === '返却'))
                            .slice(0, 80),
                    );
                }
            } catch {
                if (!cancelled) toast.error('履歴の取得に失敗しました');
            } finally {
                if (!cancelled) setIsHistoryLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [activeTab, historyReqs, isHistoryLoading]);

    // ---- 編集モード ----
    const toggleCategory = (catId: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(catId)) next.delete(catId); else next.add(catId);
            return next;
        });
    };

    const enterEditMode = () => {
        const quantities: Record<string, number> = {};
        categories.forEach(cat => cat.items.forEach(item => { quantities[item.id] = item.stockQuantity ?? 0; }));
        setEditQuantities(quantities);
        setEditMode(true);
    };

    const setQuantity = (itemId: string, value: number) => {
        setEditQuantities(prev => ({ ...prev, [itemId]: Math.max(0, value) }));
    };

    const saveAdjustments = async () => {
        const adjustments: { materialItemId: string; quantity: number }[] = [];
        categories.forEach(cat => cat.items.forEach(item => {
            const current = item.stockQuantity ?? 0;
            const newQty = editQuantities[item.id] ?? current;
            if (newQty !== current) adjustments.push({ materialItemId: item.id, quantity: newQty });
        }));

        if (adjustments.length === 0) {
            toast('変更はありません');
            setEditMode(false);
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('/api/materials/inventory', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adjustments }),
            });
            if (res.ok) {
                const data: { appliedCount?: number; excludedCount?: number } = await res.json().catch(() => ({}));
                const applied = data.appliedCount ?? adjustments.length;
                const excluded = data.excludedCount ?? 0;
                if (excluded > 0) {
                    toast.success(`${applied}件の在庫を更新しました（${excluded}件はネット/リース等の構造除外品目のため変更不可）`);
                } else {
                    toast.success(`${applied}件の在庫を更新しました`);
                }
                await fetchCategories();
                setEditMode(false);
            } else {
                toast.error('保存に失敗しました');
            }
        } catch {
            toast.error('保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    // 品目詳細モーダルへ渡す「出ている現場」一覧
    const detailSites = useMemo(() => {
        if (!detailItem || !overview) return [];
        return overview.sites
            .map(site => {
                const it = site.items.find(i => i.materialItemId === detailItem.id);
                if (!it) return null;
                return {
                    projectMasterId: site.projectMasterId,
                    projectName: site.projectName,
                    foremanName: site.foremanName,
                    lentOut: it.lentOut,
                    lastDispatchDate: site.lastDispatchDate,
                };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .sort((a, b) => b.lentOut - a.lentOut);
    }, [detailItem, overview]);

    return (
        <div className="w-full max-w-[1800px] mx-auto">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">材料在庫管理</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        全{categories.length}カテゴリ / {kpi.managed}品目
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {!editMode && (
                        <>
                            <button
                                onClick={() => setActivePage('material-returns')}
                                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:border-slate-400"
                            >
                                <RotateCcw className="w-4 h-4" />返却を登録
                            </button>
                            <button
                                onClick={() => setActivePage('materials')}
                                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-xl"
                            >
                                <Plus className="w-4 h-4" />出庫伝票を作成
                            </button>
                            {isManager && (
                                <button
                                    onClick={enterEditMode}
                                    className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:border-slate-400"
                                >
                                    在庫数を調整
                                </button>
                            )}
                        </>
                    )}
                    {editMode && (
                        <>
                            <button
                                onClick={saveAdjustments}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-xl disabled:opacity-50"
                            >
                                <Save className="w-4 h-4" />{isSaving ? '保存中...' : '保存'}
                            </button>
                            <button
                                onClick={() => setEditMode(false)}
                                className="h-9 px-4 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                            >
                                キャンセル
                            </button>
                        </>
                    )}
                </div>
            </div>

            {editMode ? (
                <EditModeList
                    categories={categories}
                    editQuantities={editQuantities}
                    expandedCategories={expandedCategories}
                    onToggleCategory={toggleCategory}
                    onSetQuantity={setQuantity}
                />
            ) : (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                        <KpiCard icon={<Package className="w-4 h-4" />} label="管理品目数" value={kpi.managed} unit="品目" />
                        <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="在庫わずか（要発注）" value={kpi.low} unit="品目" tone="warn" />
                        <KpiCard icon={<Truck className="w-4 h-4" />} label="現場へ出庫中" value={kpi.sites} unit="現場" />
                        <KpiCard icon={<AlertCircle className="w-4 h-4" />} label="要確認（在庫マイナス）" value={kpi.shortage} unit="品目" tone="danger" />
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 border-b border-slate-200 mb-4">
                        <TabButton active={activeTab === 'list'} onClick={() => setActiveTab('list')}>在庫一覧</TabButton>
                        <TabButton active={activeTab === 'sites'} onClick={() => setActiveTab('sites')}>現場別（どこに出ている？）</TabButton>
                        <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}>入出庫履歴</TabButton>
                    </div>

                    {activeTab === 'list' && (
                        <ListTab
                            categories={categories}
                            selectedCat={selectedCat}
                            onSelectCat={setSelectedCat}
                            query={query}
                            onQuery={setQuery}
                            rows={visibleRows}
                            isOverviewLoading={isOverviewLoading}
                            onItemClick={setDetailItem}
                        />
                    )}
                    {activeTab === 'sites' && (
                        <SitesTab sites={overview?.sites ?? []} isLoading={isOverviewLoading} />
                    )}
                    {activeTab === 'history' && (
                        <HistoryTab reqs={historyReqs} isLoading={isHistoryLoading} />
                    )}
                </>
            )}

            {/* 品目詳細モーダル */}
            {detailItem && (
                <ItemDetailModal
                    item={detailItem}
                    categoryName={categories.find(c => c.id === detailItem.categoryId)?.name ?? ''}
                    sites={detailSites}
                    onClose={() => setDetailItem(null)}
                />
            )}
        </div>
    );
}

/* ============================ KPI ============================ */

function KpiCard({ icon, label, value, unit, tone }: {
    icon: React.ReactNode; label: string; value: number; unit: string; tone?: 'warn' | 'danger';
}) {
    const toneCls = tone === 'warn'
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : tone === 'danger'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-white border-slate-200 text-slate-500';
    const valCls = tone === 'warn' ? 'text-amber-700' : tone === 'danger' ? 'text-red-700' : 'text-slate-900';
    return (
        <div className={`rounded-xl border p-4 ${toneCls}`}>
            <div className="flex items-center gap-1.5 text-xs font-medium">{icon}{label}</div>
            <div className={`mt-1.5 text-2xl font-bold tabular-nums ${valCls}`}>
                {value.toLocaleString()}<span className="text-sm font-medium ml-1 opacity-80">{unit}</span>
            </div>
        </div>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active ? 'text-teal-700 border-teal-600' : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
        >
            {children}
        </button>
    );
}

/* ====================== 在庫一覧タブ ====================== */

function ListTab({
    categories, selectedCat, onSelectCat, query, onQuery, rows, isOverviewLoading, onItemClick,
}: {
    categories: { id: string; name: string }[];
    selectedCat: string;
    onSelectCat: (id: string) => void;
    query: string;
    onQuery: (v: string) => void;
    rows: ItemRow[];
    isOverviewLoading: boolean;
    onItemClick: (item: MaterialItemWithStock) => void;
}) {
    return (
        <>
            {/* カテゴリ選択（ドロップダウン）＋ 品目検索 */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                <div className="w-full sm:w-64">
                    <SearchableSelect
                        options={categories.map(cat => ({ id: cat.id, label: cat.name }))}
                        value={selectedCat === 'all' ? '' : selectedCat}
                        onChange={(v) => onSelectCat(v === '' ? 'all' : v)}
                        allowEmpty
                        emptyLabel="すべてのカテゴリ"
                        placeholder="カテゴリを選択"
                    />
                </div>
                <div className="w-full sm:w-64 sm:ml-auto">
                    <MaterialSearchBar value={query} onChange={onQuery} placeholder="品目名で絞り込み" />
                </div>
            </div>

            {/* Desktop: テーブル */}
            <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500">
                            <th className="text-left font-medium px-4 py-3">品目 / 規格</th>
                            <th className="text-right font-medium px-4 py-3">倉庫在庫</th>
                            <th className="text-right font-medium px-4 py-3">現場へ出庫</th>
                            <th className="text-right font-medium px-4 py-3">所有総数</th>
                            <th className="text-left font-medium px-4 py-3 w-48">稼働状況</th>
                            <th className="text-left font-medium px-4 py-3">状態</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map(r => (
                            <tr
                                key={r.item.id}
                                onClick={() => onItemClick(r.item)}
                                className={`cursor-pointer ${r.status === 'shortage' && !r.excluded ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-slate-50'}`}
                            >
                                <td className="px-4 py-3">
                                    <span className="font-medium text-slate-800">{r.categoryName}</span>
                                    <span className="text-slate-600 ml-1.5">{r.item.name}</span>
                                    {r.item.spec && <span className="text-xs text-slate-400 ml-1">{r.item.spec}</span>}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <span className={`text-base font-semibold tabular-nums ${
                                        r.stock < 0 ? 'text-red-600' : r.excluded ? 'text-slate-700' : 'text-teal-700'
                                    }`}>
                                        {r.stock.toLocaleString()}
                                    </span>
                                </td>
                                {r.excluded ? (
                                    <>
                                        <td className="px-4 py-3 text-right text-sm text-slate-300">—</td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-300">—</td>
                                        <td className="px-4 py-3 text-xs text-slate-400" colSpan={2}>
                                            <span className="inline-flex items-center gap-1"><Info className="w-3.5 h-3.5" />管理対象外（ネット/シート/リース）</span>
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className="px-4 py-3 text-right text-sm text-slate-500 tabular-nums">{r.lentOut.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-400 tabular-nums">{r.total.toLocaleString()}</td>
                                        <td className="px-4 py-3"><StockBar stock={r.stock} total={r.total} status={r.status} /></td>
                                        <td className="px-4 py-3"><StockStatusBadge status={r.status} /></td>
                                    </>
                                )}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">該当する品目がありません</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile: カード */}
            <div className="md:hidden space-y-2.5">
                {rows.map(r => (
                    <button
                        key={r.item.id}
                        onClick={() => onItemClick(r.item)}
                        className={`w-full text-left bg-white border rounded-xl p-3.5 ${
                            r.status === 'shortage' && !r.excluded ? 'border-red-200 bg-red-50/40' : 'border-slate-200'
                        }`}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="font-semibold text-slate-800">
                                    {r.categoryName}<span className="font-normal text-slate-600 ml-1.5">{r.item.name}</span>{r.item.spec && <span className="text-xs text-slate-400 ml-1">{r.item.spec}</span>}
                                </div>
                                {!r.excluded && (
                                    <div className="text-xs text-slate-400 mt-0.5 tabular-nums">
                                        所有{r.total.toLocaleString()} ・ 現場へ{r.lentOut.toLocaleString()}
                                    </div>
                                )}
                            </div>
                            <div className="text-right shrink-0">
                                <div className={`text-2xl font-bold leading-none tabular-nums ${
                                    r.stock < 0 ? 'text-red-600' : r.excluded ? 'text-slate-700' : 'text-teal-700'
                                }`}>
                                    {r.stock.toLocaleString()}<span className="text-xs text-slate-400 font-medium ml-0.5">{r.item.unit}</span>
                                </div>
                                {r.excluded
                                    ? <span className="inline-block mt-1.5 text-xs text-slate-400">対象外</span>
                                    : <StockStatusBadge status={r.status} className="mt-1.5" />}
                            </div>
                        </div>
                        {!r.excluded && <StockBar stock={r.stock} total={r.total} status={r.status} showPercent={false} className="mt-2.5" />}
                    </button>
                ))}
                {rows.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-10">該当する品目がありません</p>
                )}
            </div>

            <p className="mt-4 text-xs text-slate-400 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                バーは「所有総数のうち、今どれだけ倉庫にあるか」を表します。倉庫が25%を切ると
                <span className="text-amber-700">わずか</span>、マイナスは<span className="text-red-700">要確認</span>として自動でハイライトされます。
                {isOverviewLoading && <span className="text-slate-400">（貸出中を集計中…）</span>}
            </p>
        </>
    );
}

/* ====================== 現場別タブ ====================== */

function SitesTab({ sites, isLoading }: { sites: LentOutSite[]; isLoading: boolean }) {
    if (isLoading && sites.length === 0) {
        return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500" /></div>;
    }
    if (sites.length === 0) {
        return <p className="text-center text-sm text-slate-400 py-12">現在、現場へ出庫中の材料はありません</p>;
    }
    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                {sites.map(site => (
                    <div key={site.projectMasterId} className="bg-white border border-slate-200 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3 mb-2.5">
                            <div className="min-w-0">
                                <div className="font-semibold text-slate-800">{site.projectName}</div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                    {site.lastDispatchDate && <>出庫 {fmtDate(site.lastDispatchDate)}</>}
                                    {site.foremanName && <> ・ 担当：{site.foremanName}</>}
                                </div>
                            </div>
                            <span className="shrink-0 text-xs font-medium px-2 py-1 rounded-md bg-teal-50 text-teal-700">出庫中</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {site.items.map(it => (
                                <span key={it.materialItemId} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-slate-500">
                                    {it.name}{it.spec ? ` ${it.spec}` : ''}
                                    <b className="text-slate-800 font-semibold ml-1 tabular-nums">{it.lentOut.toLocaleString()}</b>
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <p className="mt-4 text-xs text-slate-400 flex items-start gap-1.5">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                「この材料が今どの現場にあるか」の逆引きです。返却は「返却を登録」から、現場を選ぶと自動で戻し入力できます。
            </p>
        </>
    );
}

/* ====================== 入出庫履歴タブ ====================== */

function HistoryTab({ reqs, isLoading }: { reqs: HistoryReq[] | null; isLoading: boolean }) {
    if (isLoading || reqs === null) {
        return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500" /></div>;
    }
    if (reqs.length === 0) {
        return <p className="text-center text-sm text-slate-400 py-12">入出庫の履歴がありません</p>;
    }
    return (
        <>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full min-w-[560px]">
                    <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500">
                            <th className="text-left font-medium px-4 py-3">日付</th>
                            <th className="text-left font-medium px-4 py-3">種別</th>
                            <th className="text-left font-medium px-4 py-3">現場 / 取引先</th>
                            <th className="text-left font-medium px-4 py-3">主な品目</th>
                            <th className="text-right font-medium px-4 py-3">点数</th>
                            <th className="text-left font-medium px-4 py-3">担当</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {reqs.map(r => {
                            const isReturn = r.type === '返却';
                            const points = (r.items ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0);
                            const names = (r.items ?? []).map(i => i.materialItem?.name).filter(Boolean) as string[];
                            const summary = names.slice(0, 3).join('・') + (names.length > 3 ? ' ほか' : '');
                            return (
                                <tr key={r.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-sm text-slate-600 tabular-nums whitespace-nowrap">{fmtDate(r.date)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                            isReturn ? 'bg-teal-50 text-teal-700' : 'bg-blue-50 text-blue-700'
                                        }`}>{r.type}</span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">{r.projectTitle ?? '—'}</td>
                                    <td className="px-4 py-3 text-xs text-slate-400">{summary || '—'}</td>
                                    <td className="px-4 py-3 text-right text-sm text-slate-700 tabular-nums">{points.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-sm text-slate-600">{r.foremanName || '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="mt-4 text-xs text-slate-400 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                日付・現場・担当が別々の列なので、日付順・現場別・担当別に見られます（直近の積込完了済み伝票を表示）。
            </p>
        </>
    );
}

/* ====================== 編集モード（在庫調整・既存） ====================== */

function EditModeList({
    categories, editQuantities, expandedCategories, onToggleCategory, onSetQuantity,
}: {
    categories: { id: string; name: string; items: MaterialItemWithStock[] }[];
    editQuantities: Record<string, number>;
    expandedCategories: Set<string>;
    onToggleCategory: (id: string) => void;
    onSetQuantity: (itemId: string, value: number) => void;
}) {
    return (
        <div className="max-w-3xl space-y-2">
            <p className="text-xs text-slate-500 mb-1">倉庫在庫の実数を入力します（棚卸し調整）。ネット/シート/リース等の構造除外品目は変更できません。</p>
            {categories.map(cat => {
                const expanded = expandedCategories.has(cat.id);
                const catTotal = cat.items.reduce((s, i) => s + (editQuantities[i.id] ?? i.stockQuantity ?? 0), 0);
                return (
                    <CollapsibleCategory
                        key={cat.id}
                        name={cat.name}
                        itemCount={cat.items.length}
                        totalLabel={`計 ${catTotal.toLocaleString()}`}
                        isExpanded={expanded}
                        onToggle={() => onToggleCategory(cat.id)}
                    >
                        {cat.items.map(item => {
                            const original = item.stockQuantity ?? 0;
                            const qty = editQuantities[item.id] ?? 0;
                            const hasChanged = qty !== original;
                            const excluded = item.excludeFromStockDecrement === true;
                            return (
                                <div key={item.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${hasChanged ? 'bg-amber-50' : ''}`}>
                                    <span className="text-sm text-slate-800 min-w-0 flex-1">
                                        {item.name}
                                        {item.spec && <span className="text-xs text-slate-400 ml-1">({item.spec})</span>}
                                        {excluded && <span className="text-xs text-slate-400 ml-1.5">構造除外</span>}
                                    </span>
                                    {excluded ? (
                                        <span className="text-sm text-slate-300">変更不可</span>
                                    ) : (
                                        <QtyStepper value={qty} onChange={(v) => onSetQuantity(item.id, v)} />
                                    )}
                                </div>
                            );
                        })}
                    </CollapsibleCategory>
                );
            })}
        </div>
    );
}

/* ====================== 品目詳細モーダル ====================== */

function ItemDetailModal({
    item, categoryName, sites, onClose,
}: {
    item: MaterialItemWithStock;
    categoryName: string;
    sites: { projectMasterId: string; projectName: string; foremanName: string | null; lentOut: number; lastDispatchDate: string | null }[];
    onClose: () => void;
}) {
    const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/materials/inventory/transactions?materialItemId=${item.id}&limit=20`, { cache: 'no-store' });
                if (res.ok && !cancelled) setTransactions(await res.json());
            } catch {
                // 履歴が取れなくてもモーダルは表示する
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [item.id]);

    const getTypeLabel = (type: string) => ({ initial: '初期設定', dispatch: '出庫', return: '返却', adjustment: '調整' } as Record<string, string>)[type] ?? type;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800">
                        {categoryName && <span>{categoryName} </span>}
                        <span className="font-normal text-slate-600">{item.name}</span>
                        {item.spec && <span className="text-xs text-slate-400 ml-1.5">{item.spec}</span>}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                </div>
                <div className="overflow-y-auto p-4 space-y-5">
                    {/* 現場別逆引き */}
                    <section>
                        <h4 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />出ている現場</h4>
                        {sites.length === 0 ? (
                            <p className="text-sm text-slate-400">現在、現場へ出ている分はありません</p>
                        ) : (
                            <div className="space-y-1.5">
                                {sites.map(s => (
                                    <div key={s.projectMasterId} className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 rounded-xl">
                                        <div className="min-w-0">
                                            <div className="text-sm text-slate-800 truncate">{s.projectName}</div>
                                            <div className="text-xs text-slate-400">
                                                {s.lastDispatchDate && <>出庫 {fmtDate(s.lastDispatchDate)}</>}
                                                {s.foremanName && <> ・ {s.foremanName}</>}
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-sm font-semibold text-slate-800 tabular-nums">
                                            {s.lentOut.toLocaleString()}<span className="text-xs text-slate-400 font-normal ml-0.5">{item.unit}</span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* 入出庫履歴 */}
                    <section>
                        <h4 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" />入出庫履歴</h4>
                        {isLoading ? (
                            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-500" /></div>
                        ) : transactions.length === 0 ? (
                            <p className="text-sm text-slate-400">履歴がありません</p>
                        ) : (
                            <div className="space-y-1.5">
                                {transactions.map(tx => (
                                    <div key={tx.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-xl">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                                tx.quantity > 0 ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'
                                            }`}>{getTypeLabel(tx.type)}</span>
                                            {tx.notes && <span className="text-xs text-slate-500 truncate">{tx.notes}</span>}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className={`text-sm font-medium tabular-nums ${tx.quantity > 0 ? 'text-teal-600' : 'text-red-600'}`}>
                                                {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                                            </span>
                                            <div className="text-xs text-slate-400">
                                                {new Date(tx.createdAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

/* ====================== utils ====================== */

function fmtDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });
}
