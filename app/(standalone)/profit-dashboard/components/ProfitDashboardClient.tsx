'use client';

import React, { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatCurrency, getProfitMarginColor } from '@/utils/costCalculation';
import type { DashboardSummary, AggregateRow } from '@/lib/profitDashboard';

export interface SerializedProjectProfit {
    id: string;
    title: string;
    customerName: string | null;
    status: string;
    assignmentCount: number;
    estimateAmount: number;
    estimateCostTotal: number | null;
    revenue: number;
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
    currentStatus: string;
    onStatusChange?: (status: string) => void;
    onRefresh?: () => Promise<void>;
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

export default function ProfitDashboardClient({
    projects, summary, byCustomer, byConstructionType, byForeman,
    currentStatus, onStatusChange, onRefresh,
}: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [activeTab, setActiveTab] = useState<TabKey>('project');
    const [sortBy, setSortBy] = useState<SortKey>('profitMargin');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleSort = (field: SortKey) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        } else {
            setSortBy(field);
            setSortOrder('desc');
        }
    };

    const handleStatusChange = (status: string) => {
        if (onStatusChange) {
            onStatusChange(status);
        } else {
            const params = new URLSearchParams(searchParams.toString());
            if (status === 'all') params.delete('status');
            else params.set('status', status);
            router.push(`/profit-dashboard?${params.toString()}`);
        }
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        if (onRefresh) await onRefresh();
        else router.refresh();
        setIsRefreshing(false);
    };

    // 要注意案件: 利益率 < 10%(売上が0以外)
    const warningProjects = useMemo(() => {
        return projects
            .filter(p => p.revenue > 0 && p.profitMargin < 10)
            .sort((a, b) => a.profitMargin - b.profitMargin)
            .slice(0, 5);
    }, [projects]);

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
                            案件・顧客・工事種別・職長の各軸で利益状況を確認
                        </p>
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 text-sm shadow-sm"
                    >
                        {isRefreshing ? '更新中…' : '更新'}
                    </button>
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
                            <h2 className="text-sm font-semibold text-slate-700">
                                要注意案件（利益率 10% 未満）
                            </h2>
                            <span className="text-xs text-slate-500">{warningProjects.length}件</span>
                        </div>
                        <div className="divide-y divide-slate-200">
                            {warningProjects.map(p => (
                                <div key={p.id} className="py-2.5 flex items-center justify-between gap-4 text-sm">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium text-slate-800 truncate">{p.title}</div>
                                        <div className="text-xs text-slate-500 truncate">
                                            {p.customerName || '顧客未設定'}
                                        </div>
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

                {/* ステータスフィルター */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
                    <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-sm font-medium text-slate-600">ステータス</span>
                        <div className="flex gap-2">
                            {STATUS_OPTIONS.map(option => (
                                <button
                                    key={option.value}
                                    onClick={() => handleStatusChange(option.value)}
                                    className={`px-3 py-1.5 text-sm rounded-xl transition-colors border ${currentStatus === option.value
                                        ? 'bg-slate-700 text-white border-slate-700'
                                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                        }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <div className="ml-auto text-sm text-slate-500">
                            {summary.totalProjects}件の案件
                        </div>
                    </div>
                </div>

                {/* タブ */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex border-b border-slate-200 overflow-x-auto">
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
                    </div>

                    {activeTab === 'project' ? (
                        <ProjectTable
                            projects={projects}
                            sortBy={sortBy}
                            sortOrder={sortOrder}
                            onSort={handleSort}
                        />
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
                            note={activeTab === 'foreman'
                                ? '※ 各案件の売上・原価を職長のアサイン件数で按分しています'
                                : undefined}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function ProjectTable({
    projects, sortBy, sortOrder, onSort,
}: {
    projects: SerializedProjectProfit[];
    sortBy: SortKey;
    sortOrder: 'asc' | 'desc';
    onSort: (k: SortKey) => void;
}) {
    const sorted = projects.slice().sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        return sortOrder === 'desc' ? bv - av : av - bv;
    });

    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
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
                    ) : sorted.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                                <div className="font-medium text-slate-800">{p.title}</div>
                                <div className="text-xs text-slate-500">{p.status === 'completed' ? '完了' : '進行中'}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{p.customerName || '-'}</td>
                            <td className="px-4 py-3 text-right">
                                <div className="font-medium text-slate-800">{formatCurrency(p.revenue)}</div>
                                {p.estimateAmount > 0 && p.estimateAmount !== p.revenue && (
                                    <div className="text-xs text-slate-400">見積: {formatCurrency(p.estimateAmount)}</div>
                                )}
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
    );
}

function AggregateTable({
    label, rows, sortBy, sortOrder, onSort, note,
}: {
    label: string;
    rows: AggregateRow[];
    sortBy: SortKey;
    sortOrder: 'asc' | 'desc';
    onSort: (k: SortKey) => void;
    note?: string;
}) {
    const sorted = rows.slice().sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        return sortOrder === 'desc' ? bv - av : av - bv;
    });

    return (
        <div>
            {note && (
                <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">{note}</div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
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
                        ) : sorted.map(r => (
                            <tr key={r.key} className="hover:bg-slate-50 transition-colors">
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
        </div>
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-medium text-slate-500 mb-2">{title}</div>
            <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
        </div>
    );
}
