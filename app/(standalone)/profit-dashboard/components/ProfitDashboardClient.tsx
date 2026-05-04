'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronRight } from 'lucide-react';
import { logger } from '@/lib/logger';
import { useDebounce } from '@/hooks/useDebounce';
import { formatCurrency, getProfitMarginColor } from '@/utils/costCalculation';
import type {
    DashboardSummary, AggregateRow, FilterOptions, DashboardFilters,
} from '@/lib/profitDashboard';

export interface SerializedProjectProfit {
    id: string;
    title: string;
    customerName: string | null;
    status: string;
    assignmentCount: number;
    estimateAmount: number;
    estimateCostTotal: number | null;
    contractAmount: number;
    invoiceAmount: number;
    revenue: number;
    revenueSource: 'invoice' | 'contract' | 'estimate' | 'none';
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
    totalCost: number;
    grossProfit: number;
    profitMargin: number;
    updatedAt: string;
}

interface Props {
    projects: SerializedProjectProfit[];
    summary: DashboardSummary;
    byCustomer: AggregateRow[];
    byConstructionType: AggregateRow[];
    byForeman: AggregateRow[];
    filterOptions: FilterOptions;
    initialFilters: DashboardFilters;
}

type TabKey = 'project' | 'customer' | 'constructionType' | 'foreman';
type SortKey = 'profitMargin' | 'grossProfit' | 'revenue';

const TABS: { key: TabKey; label: string }[] = [
    { key: 'project', label: '案件別' },
    { key: 'customer', label: '顧客別' },
    { key: 'constructionType', label: '工事種別' },
    { key: 'foreman', label: '職長別' },
];

const STATUS_OPTIONS = [
    { value: 'all', label: 'すべて' },
    { value: 'active', label: '進行中' },
    { value: 'completed', label: '完了' },
];

function buildQuery(f: DashboardFilters): string {
    const params = new URLSearchParams();
    if (f.status && f.status !== 'all') params.set('status', f.status);
    else if (f.status === 'all') params.set('status', 'all');
    if (f.dateFrom) params.set('dateFrom', f.dateFrom);
    if (f.dateTo) params.set('dateTo', f.dateTo);
    if (f.customerNames?.length) params.set('customers', f.customerNames.join(','));
    if (f.foremanIds?.length) params.set('foremen', f.foremanIds.join(','));
    if (f.constructionTypeIds?.length) params.set('types', f.constructionTypeIds.join(','));
    return params.toString();
}

export default function ProfitDashboardClient({
    projects: initialProjects,
    summary: initialSummary,
    byCustomer: initialByCustomer,
    byConstructionType: initialByConstructionType,
    byForeman: initialByForeman,
    filterOptions,
    initialFilters,
}: Props) {
    const [filters, setFilters] = useState<DashboardFilters>({
        status: initialFilters.status ?? 'active',
        dateFrom: initialFilters.dateFrom,
        dateTo: initialFilters.dateTo,
        customerNames: initialFilters.customerNames,
        foremanIds: initialFilters.foremanIds,
        constructionTypeIds: initialFilters.constructionTypeIds,
    });
    const [projects, setProjects] = useState(initialProjects);
    const [summary, setSummary] = useState(initialSummary);
    const [byCustomer, setByCustomer] = useState(initialByCustomer);
    const [byConstructionType, setByConstructionType] = useState(initialByConstructionType);
    const [byForeman, setByForeman] = useState(initialByForeman);
    const [activeTab, setActiveTab] = useState<TabKey>('project');
    const [sortBy, setSortBy] = useState<SortKey>('profitMargin');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // フィルタ連打時に重い集計APIを叩かないよう300msデバウンス
    const debouncedFilters = useDebounce(filters, 300);

    const isFirstRender = useRef(true);
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        let cancelled = false;
        const run = async () => {
            setIsLoading(true);
            try {
                const qs = buildQuery(debouncedFilters);
                const res = await fetch(`/api/profit-dashboard?${qs}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('fetch failed');
                const data = await res.json();
                if (cancelled) return;
                setProjects(data.projects);
                setSummary(data.summary);
                setByCustomer(data.byCustomer);
                setByConstructionType(data.byConstructionType);
                setByForeman(data.byForeman);
            } catch (e) {
                logger.error('Failed to refetch profit dashboard:', e);
                toast.error('データの取得に失敗しました');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [debouncedFilters]);

    const handleSort = (field: SortKey) => {
        if (sortBy === field) setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        else { setSortBy(field); setSortOrder('desc'); }
    };

    const updateFilter = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const resetFilters = () => {
        setFilters({ status: 'active' });
    };

    const warningProjects = useMemo(() => {
        return projects
            .filter(p => p.revenue > 0 && p.profitMargin < 10)
            .sort((a, b) => a.profitMargin - b.profitMargin)
            .slice(0, 5);
    }, [projects]);

    const filteredProjects = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return projects;
        return projects.filter(p =>
            p.title.toLowerCase().includes(q)
            || (p.customerName ?? '').toLowerCase().includes(q),
        );
    }, [projects, searchQuery]);

    const hasActiveFilters = !!(
        filters.dateFrom || filters.dateTo
        || filters.customerNames?.length
        || filters.foremanIds?.length
        || filters.constructionTypeIds?.length
        || (filters.status && filters.status !== 'active')
    );

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-[1800px] mx-auto">
                {/* ヘッダー */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                            利益ダッシュボード
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">
                            期間・顧客・職長・工事種別を自由に組み合わせて閲覧できます
                        </p>
                    </div>
                    {isLoading && <div className="text-sm text-slate-500">読み込み中…</div>}
                </div>

                {/* フィルタパネル */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
                    <div className="mb-4">
                        <label className="block text-xs font-medium text-slate-600 mb-1.5">案件名で検索</label>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="案件名・顧客名で絞り込み"
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-500 shadow-sm"
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <FilterField label="開始日">
                            <input
                                type="date"
                                value={filters.dateFrom ?? ''}
                                onChange={e => updateFilter('dateFrom', e.target.value || undefined)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-500 shadow-sm"
                            />
                        </FilterField>
                        <FilterField label="終了日">
                            <input
                                type="date"
                                value={filters.dateTo ?? ''}
                                onChange={e => updateFilter('dateTo', e.target.value || undefined)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-500 shadow-sm"
                            />
                        </FilterField>
                        <FilterField label="ステータス">
                            <div className="flex gap-2">
                                {STATUS_OPTIONS.map(o => (
                                    <button
                                        key={o.value}
                                        onClick={() => updateFilter('status', o.value)}
                                        className={`flex-1 px-2 py-2 text-xs rounded-xl border transition-colors ${(filters.status ?? 'active') === o.value
                                            ? 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                            }`}
                                    >
                                        {o.label}
                                    </button>
                                ))}
                            </div>
                        </FilterField>
                        <FilterField label="操作">
                            <button
                                onClick={resetFilters}
                                disabled={!hasActiveFilters}
                                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                            >
                                条件をリセット
                            </button>
                        </FilterField>
                        <FilterField label={`顧客（${filters.customerNames?.length ?? 0}件選択中）`}>
                            <MultiSelect
                                options={filterOptions.customers.map(c => ({ value: c, label: c }))}
                                selected={filters.customerNames ?? []}
                                onChange={v => updateFilter('customerNames', v.length ? v : undefined)}
                                placeholder="顧客を検索"
                            />
                        </FilterField>
                        <FilterField label={`職長（${filters.foremanIds?.length ?? 0}件選択中）`}>
                            <MultiSelect
                                options={filterOptions.foremen.map(f => ({ value: f.id, label: f.name }))}
                                selected={filters.foremanIds ?? []}
                                onChange={v => updateFilter('foremanIds', v.length ? v : undefined)}
                                placeholder="職長を検索"
                            />
                        </FilterField>
                        <FilterField label={`工事種別（${filters.constructionTypeIds?.length ?? 0}件選択中）`}>
                            <MultiSelect
                                options={filterOptions.constructionTypes.map(t => ({ value: t.id, label: t.name }))}
                                selected={filters.constructionTypeIds ?? []}
                                onChange={v => updateFilter('constructionTypeIds', v.length ? v : undefined)}
                                placeholder="工事種別を検索"
                            />
                        </FilterField>
                    </div>
                </div>

                {/* サマリーカード */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <SummaryCard title="総売上" value={formatCurrency(summary.totalRevenue)} />
                    <SummaryCard title="総原価" value={formatCurrency(summary.totalCost)} />
                    <SummaryCard
                        title="総粗利"
                        value={formatCurrency(summary.totalGrossProfit)}
                        emphasis={summary.totalGrossProfit < 0 ? 'negative' : 'default'}
                    />
                    <SummaryCard
                        title="平均利益率"
                        value={`${summary.averageProfitMargin}%`}
                        emphasis={summary.averageProfitMargin < 10 ? 'warn' : 'default'}
                    />
                </div>

                {/* 要注意案件 */}
                {warningProjects.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-semibold text-slate-700">要注意案件（利益率 10% 未満）</h2>
                            <span className="text-xs text-slate-500">{warningProjects.length}件</span>
                        </div>
                        <div className="divide-y divide-slate-200">
                            {warningProjects.map(p => (
                                <div key={p.id} className="py-2.5 flex items-center justify-between gap-4 text-sm">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium text-slate-800 truncate">{p.title}</div>
                                        <div className="text-xs text-slate-500 truncate">{p.customerName || '顧客未設定'}</div>
                                    </div>
                                    <div className="text-right text-slate-600 shrink-0">
                                        <div>粗利 {formatCurrency(p.grossProfit)}</div>
                                    </div>
                                    <div className={`shrink-0 w-16 text-right font-bold ${getProfitMarginColor(p.profitMargin)}`}>
                                        {p.profitMargin}%
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* タブ */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* モバイルでタブが多い時の折返し対応 + 件数表示が縦書き化しないよう whitespace-nowrap */}
                    <div className="flex items-center border-b border-slate-200 overflow-x-auto flex-wrap">
                        {TABS.map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.key
                                    ? 'border-slate-700 text-slate-800'
                                    : 'border-transparent text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                        <div className="ml-auto px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                            {activeTab === 'project' && searchQuery.trim()
                                ? `${filteredProjects.length} / ${summary.totalProjects}件の案件`
                                : `${summary.totalProjects}件の案件`}
                        </div>
                    </div>

                    {activeTab === 'project' ? (
                        <>
                            <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
                                売上の採用ロジック: <strong className="text-slate-700">請求済</strong> → <strong className="text-slate-700">契約</strong> → <strong className="text-slate-700">見積</strong> の優先順位
                            </div>
                            <ProjectTable projects={filteredProjects} sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} setSortBy={setSortBy} setSortOrder={setSortOrder} />
                        </>
                    ) : (
                        <AggregateTable
                            label={TABS.find(t => t.key === activeTab)!.label.replace('別', '')}
                            rows={
                                activeTab === 'customer' ? byCustomer
                                    : activeTab === 'constructionType' ? byConstructionType
                                        : byForeman
                            }
                            sortBy={sortBy}
                            sortOrder={sortOrder}
                            onSort={handleSort}
                            setSortBy={setSortBy}
                            setSortOrder={setSortOrder}
                            note={activeTab === 'foreman'
                                ? '※ 各案件の売上・原価を職長のアサイン件数で按分しています'
                                : undefined}
                            onRowClick={
                                activeTab === 'customer'
                                    ? (row) => updateFilter('customerNames', [row.key])
                                    : activeTab === 'constructionType'
                                        ? (row) => updateFilter('constructionTypeIds', [row.key])
                                        : (row) => updateFilter('foremanIds', [row.key])
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
            {children}
        </div>
    );
}

function MultiSelect({
    options, selected, onChange, placeholder,
}: {
    options: { value: string; label: string }[];
    selected: string[];
    onChange: (v: string[]) => void;
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const filtered = useMemo(
        () => options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())),
        [options, query],
    );

    const toggle = (v: string) => {
        if (selected.includes(v)) onChange(selected.filter(x => x !== v));
        else onChange([...selected, v]);
    };

    const summaryText = selected.length === 0
        ? (placeholder ?? '選択してください')
        : selected.length <= 2
            ? selected.map(v => options.find(o => o.value === v)?.label ?? v).join(', ')
            : `${selected.length}件選択中`;

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full text-left border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white hover:bg-slate-50 shadow-sm truncate"
            >
                {summaryText}
            </button>
            {open && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-slate-200">
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="検索"
                            className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-slate-500"
                            autoFocus
                        />
                    </div>
                    <div className="overflow-y-auto">
                        {filtered.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-slate-500 text-center">該当なし</div>
                        ) : filtered.map(o => (
                            <label
                                key={o.value}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.includes(o.value)}
                                    onChange={() => toggle(o.value)}
                                />
                                <span className="text-slate-700 truncate">{o.label}</span>
                            </label>
                        ))}
                    </div>
                    {selected.length > 0 && (
                        <div className="border-t border-slate-200 p-2">
                            <button
                                type="button"
                                onClick={() => onChange([])}
                                className="w-full text-xs text-slate-600 hover:text-slate-800 py-1"
                            >
                                選択をクリア
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

const PAGE_SIZE = 20;

function ProjectTable({
    projects, sortBy, sortOrder, onSort, setSortBy, setSortOrder,
}: {
    projects: SerializedProjectProfit[];
    sortBy: SortKey;
    sortOrder: 'asc' | 'desc';
    onSort: (k: SortKey) => void;
    setSortBy: (k: SortKey) => void;
    setSortOrder: (o: 'asc' | 'desc') => void;
}) {
    const sorted = useMemo(() => projects.slice().sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        return sortOrder === 'desc' ? bv - av : av - bv;
    }), [projects, sortBy, sortOrder]);

    const [page, setPage] = useState(1);
    useEffect(() => { setPage(1); }, [projects, sortBy, sortOrder]);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
        <div>
        {/* モバイル用カードビュー */}
        <div className="md:hidden">
            <MobileSortSelector sortBy={sortBy} sortOrder={sortOrder} setSortBy={setSortBy} setSortOrder={setSortOrder} />
            {sorted.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">該当する案件がありません</div>
            ) : (
                <div className="space-y-3 px-4 py-4">
                    {pageItems.map(p => (
                        <div key={p.id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                            <div className="font-medium text-slate-800 break-words">{p.title}</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                                {p.status === 'completed' ? '完了' : '進行中'}
                                {p.customerName && <span className="mx-1.5 text-slate-300">|</span>}
                                {p.customerName}
                            </div>
                            <div className="mt-3 divide-y divide-slate-100 text-sm">
                                <div className="flex items-start justify-between py-1.5 gap-2">
                                    <span className="text-slate-500 flex-shrink-0">売上</span>
                                    <div className="text-right min-w-0">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className="font-medium text-slate-800 tabular-nums">{formatCurrency(p.revenue)}</span>
                                            <RevenueSourceBadge source={p.revenueSource} />
                                        </div>
                                        {(p.invoiceAmount > 0 || p.contractAmount > 0 || p.estimateAmount > 0) && (
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                {p.invoiceAmount > 0 && p.revenueSource !== 'invoice' && <>請求 {formatCurrency(p.invoiceAmount)} </>}
                                                {p.contractAmount > 0 && p.revenueSource !== 'contract' && <>足場工事 {formatCurrency(p.contractAmount)} </>}
                                                {p.estimateAmount > 0 && p.revenueSource !== 'estimate' && <>見積 {formatCurrency(p.estimateAmount)}</>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-start justify-between py-1.5 gap-2">
                                    <span className="text-slate-500 flex-shrink-0">原価</span>
                                    <div className="text-right min-w-0">
                                        <div className="text-slate-600 tabular-nums">{formatCurrency(p.totalCost)}</div>
                                        {p.estimateCostTotal != null && (
                                            <div className="text-[10px] text-slate-400">
                                                見積: {formatCurrency(p.estimateCostTotal)}
                                                {p.totalCost > 0 && (
                                                    <span className={`ml-1 ${p.totalCost > p.estimateCostTotal ? 'text-red-500' : 'text-emerald-600'}`}>
                                                        ({p.totalCost > p.estimateCostTotal ? '+' : ''}{formatCurrency(p.totalCost - p.estimateCostTotal)})
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between py-1.5 gap-2">
                                    <span className="text-slate-500 flex-shrink-0">粗利</span>
                                    <span className={`font-medium tabular-nums ${p.grossProfit >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                                        {formatCurrency(p.grossProfit)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between py-1.5 gap-2">
                                    <span className="text-slate-500 flex-shrink-0">利益率</span>
                                    <span className={`font-bold tabular-nums ${getProfitMarginColor(p.profitMargin)}`}>{p.profitMargin}%</span>
                                </div>
                                <div className="flex items-center justify-between py-1.5 gap-2">
                                    <span className="text-slate-500 flex-shrink-0">配置</span>
                                    <span className="text-slate-500 tabular-nums">{p.assignmentCount}件</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* PC用テーブルビュー（既存挙動を維持） */}
        <div className="hidden md:block overflow-auto max-h-[70vh]">
            <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                    <tr>
                        <Th>案件名</Th>
                        <Th>顧客</Th>
                        <ThSort field="revenue" label="売上" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
                        <Th align="right">原価</Th>
                        <ThSort field="grossProfit" label="粗利" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
                        <ThSort field="profitMargin" label="利益率" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
                        <Th align="center">配置</Th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {sorted.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500">該当する案件がありません</td>
                        </tr>
                    ) : pageItems.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                                <div className="font-medium text-slate-800">{p.title}</div>
                                <div className="text-xs text-slate-500">{p.status === 'completed' ? '完了' : '進行中'}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{p.customerName || '-'}</td>
                            <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    <span className="font-medium text-slate-800">{formatCurrency(p.revenue)}</span>
                                    <RevenueSourceBadge source={p.revenueSource} />
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                    {p.invoiceAmount > 0 && p.revenueSource !== 'invoice' && <>請求 {formatCurrency(p.invoiceAmount)} </>}
                                    {p.contractAmount > 0 && p.revenueSource !== 'contract' && <>足場工事 {formatCurrency(p.contractAmount)} </>}
                                    {p.estimateAmount > 0 && p.revenueSource !== 'estimate' && <>見積 {formatCurrency(p.estimateAmount)}</>}
                                </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                                <div className="text-slate-600">{formatCurrency(p.totalCost)}</div>
                                {p.estimateCostTotal != null && (
                                    <div className="text-xs text-slate-400">
                                        見積: {formatCurrency(p.estimateCostTotal)}
                                        {p.totalCost > 0 && (
                                            <span className={`ml-1 ${p.totalCost > p.estimateCostTotal ? 'text-red-500' : 'text-emerald-600'}`}>
                                                ({p.totalCost > p.estimateCostTotal ? '+' : ''}{formatCurrency(p.totalCost - p.estimateCostTotal)})
                                            </span>
                                        )}
                                    </div>
                                )}
                            </td>
                            <td className="px-4 py-3 text-right">
                                <span className={`font-medium ${p.grossProfit >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                                    {formatCurrency(p.grossProfit)}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                                <span className={`font-bold ${getProfitMarginColor(p.profitMargin)}`}>{p.profitMargin}%</span>
                            </td>
                            <td className="px-4 py-3 text-center text-sm text-slate-500">{p.assignmentCount}件</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        <Pagination page={page} totalPages={totalPages} totalItems={sorted.length} onChange={setPage} />
        </div>
    );
}

function AggregateTable({
    label, rows, sortBy, sortOrder, onSort, setSortBy, setSortOrder, note, onRowClick,
}: {
    label: string;
    rows: AggregateRow[];
    sortBy: SortKey;
    sortOrder: 'asc' | 'desc';
    onSort: (k: SortKey) => void;
    setSortBy: (k: SortKey) => void;
    setSortOrder: (o: 'asc' | 'desc') => void;
    note?: string;
    onRowClick?: (row: AggregateRow) => void;
}) {
    const sorted = useMemo(() => rows.slice().sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        return sortOrder === 'desc' ? bv - av : av - bv;
    }), [rows, sortBy, sortOrder]);

    const [page, setPage] = useState(1);
    useEffect(() => { setPage(1); }, [rows, sortBy, sortOrder]);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
        <div>
            {note && (
                <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">{note}</div>
            )}
            {onRowClick && (
                <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
                    行をクリックすると、その項目で絞り込んで案件別タブで詳細を確認できます
                </div>
            )}

            {/* モバイル用カードビュー */}
            <div className="md:hidden">
                <MobileSortSelector sortBy={sortBy} sortOrder={sortOrder} setSortBy={setSortBy} setSortOrder={setSortOrder} />
                {sorted.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">データがありません</div>
                ) : (
                    <div className="space-y-3 px-4 py-4">
                        {pageItems.map(r => {
                            // タップでフィードバックが出るよう active:bg-slate-100 + scale を併用
                            const cardClass = `w-full text-left rounded-xl border border-slate-200 bg-white shadow-sm p-4 transition-all ${onRowClick ? 'active:bg-slate-100 active:scale-[0.99]' : ''}`;
                            const inner = (
                                <>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-medium text-slate-800 break-words">{r.name}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">案件数: {r.projectCount}件</div>
                                        </div>
                                        {onRowClick && <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-1" />}
                                    </div>
                                    <div className="mt-3 divide-y divide-slate-100 text-sm">
                                        <div className="flex items-center justify-between py-1.5 gap-2">
                                            <span className="text-slate-500 flex-shrink-0">売上</span>
                                            <span className="font-medium text-slate-800 tabular-nums">{formatCurrency(r.revenue)}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-1.5 gap-2">
                                            <span className="text-slate-500 flex-shrink-0">原価</span>
                                            <span className="text-slate-600 tabular-nums">{formatCurrency(r.totalCost)}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-1.5 gap-2">
                                            <span className="text-slate-500 flex-shrink-0">粗利</span>
                                            <span className={`font-medium tabular-nums ${r.grossProfit >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                                                {formatCurrency(r.grossProfit)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between py-1.5 gap-2">
                                            <span className="text-slate-500 flex-shrink-0">利益率</span>
                                            <span className={`font-bold tabular-nums ${getProfitMarginColor(r.profitMargin)}`}>{r.profitMargin}%</span>
                                        </div>
                                    </div>
                                </>
                            );
                            return onRowClick ? (
                                <button key={r.key} type="button" onClick={() => onRowClick(r)} className={cardClass}>{inner}</button>
                            ) : (
                                <div key={r.key} className={cardClass}>{inner}</div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* PC用テーブルビュー（既存挙動を維持） */}
            <div className="hidden md:block overflow-auto max-h-[70vh]">
                <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <Th>{label}</Th>
                            <Th align="center">案件数</Th>
                            <ThSort field="revenue" label="売上" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
                            <Th align="right">原価</Th>
                            <ThSort field="grossProfit" label="粗利" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
                            <ThSort field="profitMargin" label="利益率" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {sorted.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">データがありません</td>
                            </tr>
                        ) : pageItems.map(r => (
                            <tr
                                key={r.key}
                                className={`hover:bg-slate-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                                onClick={() => onRowClick?.(r)}
                            >
                                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                                <td className="px-4 py-3 text-center text-sm text-slate-500">{r.projectCount}件</td>
                                <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCurrency(r.revenue)}</td>
                                <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(r.totalCost)}</td>
                                <td className="px-4 py-3 text-right">
                                    <span className={`font-medium ${r.grossProfit >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                                        {formatCurrency(r.grossProfit)}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <span className={`font-bold ${getProfitMarginColor(r.profitMargin)}`}>{r.profitMargin}%</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalItems={sorted.length} onChange={setPage} />
        </div>
    );
}

function Pagination({
    page, totalPages, totalItems, onChange,
}: {
    page: number;
    totalPages: number;
    totalItems: number;
    onChange: (p: number) => void;
}) {
    if (totalItems === 0) return null;
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalItems);
    return (
        // モバイルでは縦積み・件数表示を中央寄せ。md: 以上は従来の左右両端配置
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between px-4 py-3 border-t border-slate-200 bg-white text-sm">
            <div className="text-slate-500 text-center md:text-left whitespace-nowrap">
                {start}〜{end} / {totalItems}件
            </div>
            <div className="flex items-center gap-2 justify-center md:justify-end">
                {/* 「最初」「最後」はモバイルで非表示にしてコンパクト化 */}
                <button
                    onClick={() => onChange(1)}
                    disabled={page <= 1}
                    className="hidden md:inline-flex flex-shrink-0 px-2 py-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                    最初
                </button>
                <button
                    onClick={() => onChange(page - 1)}
                    disabled={page <= 1}
                    className="flex-shrink-0 px-3 py-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                    前へ
                </button>
                <span className="text-slate-600 px-2 whitespace-nowrap">{page} / {totalPages}</span>
                <button
                    onClick={() => onChange(page + 1)}
                    disabled={page >= totalPages}
                    className="flex-shrink-0 px-3 py-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                    次へ
                </button>
                <button
                    onClick={() => onChange(totalPages)}
                    disabled={page >= totalPages}
                    className="hidden md:inline-flex flex-shrink-0 px-2 py-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                    最後
                </button>
            </div>
        </div>
    );
}

// モバイル用のソート切替（昇順/降順を選択肢として明示）
function MobileSortSelector({
    sortBy, sortOrder, setSortBy, setSortOrder,
}: {
    sortBy: SortKey;
    sortOrder: 'asc' | 'desc';
    setSortBy: (k: SortKey) => void;
    setSortOrder: (o: 'asc' | 'desc') => void;
}) {
    const value = `${sortBy}:${sortOrder}`;
    const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const [k, o] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
        setSortBy(k);
        setSortOrder(o);
    };
    return (
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">並び順</label>
            <select
                value={value}
                onChange={onChange}
                className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white shadow-sm focus:ring-2 focus:ring-slate-500"
            >
                <option value="revenue:desc">売上 ↓（高い順）</option>
                <option value="revenue:asc">売上 ↑（低い順）</option>
                <option value="grossProfit:desc">粗利 ↓（高い順）</option>
                <option value="grossProfit:asc">粗利 ↑（低い順）</option>
                <option value="profitMargin:desc">利益率 ↓（高い順）</option>
                <option value="profitMargin:asc">利益率 ↑（低い順）</option>
            </select>
        </div>
    );
}

function RevenueSourceBadge({ source }: { source: 'invoice' | 'contract' | 'estimate' | 'none' }) {
    if (source === 'none') {
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">未確定</span>;
    }
    const label = source === 'invoice' ? '請求済' : source === 'contract' ? '足場工事' : '見積';
    const cls = source === 'invoice'
        ? 'bg-slate-700 text-white border-slate-700'
        : source === 'contract'
            ? 'bg-slate-200 text-slate-700 border-slate-300'
            : 'bg-white text-slate-500 border-slate-300';
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
    );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
    const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
    return (
        <th className={`px-4 py-3 ${alignClass} text-xs font-semibold text-slate-600 uppercase tracking-wider`}>
            {children}
        </th>
    );
}

function ThSort({
    field, label, sortBy, sortOrder, onSort,
}: {
    field: SortKey;
    label: string;
    sortBy: SortKey;
    sortOrder: 'asc' | 'desc';
    onSort: (k: SortKey) => void;
}) {
    return (
        <th
            className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
            onClick={() => onSort(field)}
        >
            {label}{sortBy === field && (sortOrder === 'desc' ? ' ↓' : ' ↑')}
        </th>
    );
}

function SummaryCard({
    title, value, emphasis = 'default',
}: {
    title: string;
    value: string;
    emphasis?: 'default' | 'warn' | 'negative';
}) {
    const valueColor = emphasis === 'negative' ? 'text-red-600'
        : emphasis === 'warn' ? 'text-amber-600'
            : 'text-slate-800';
    return (
        // モバイル(2列レイアウト)で大きな数値（億単位等）がはみ出すのを防ぐため
        // フォントを縮小し、数字幅を tabular-nums で均一化
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm min-w-0">
            <div className="text-sm font-medium text-slate-500 mb-2">{title}</div>
            <div className={`text-xl md:text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
        </div>
    );
}
