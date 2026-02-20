'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TrendingUp, TrendingDown, DollarSign, BarChart3, Filter, Building, RefreshCw } from 'lucide-react';
import { formatCurrency, getProfitMarginColor } from '@/utils/costCalculation';
import type { DashboardSummary } from '@/lib/profitDashboard';

// Server Componentから渡されるシリアライズ済みの型
export interface SerializedProjectProfit {
    id: string;
    title: string;
    customerName: string | null;
    status: string;
    assignmentCount: number;
    estimateAmount: number;
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
    currentStatus: string;
    onStatusChange?: (status: string) => void; // Wrapper経由の場合に使用
    onRefresh?: () => Promise<void>; // Wrapper経由の場合に使用
}

export default function ProfitDashboardClient({ projects, summary, currentStatus, onStatusChange, onRefresh }: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [sortBy, setSortBy] = useState<'profitMargin' | 'grossProfit' | 'revenue'>('profitMargin');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [isRefreshing, setIsRefreshing] = useState(false);

    // ソート
    const sortedProjects = projects.slice().sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    const handleSort = (field: 'profitMargin' | 'grossProfit' | 'revenue') => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        } else {
            setSortBy(field);
            setSortOrder('desc');
        }
    };

    const handleStatusChange = (status: string) => {
        if (onStatusChange) {
            // Wrapper経由の場合はコールバックを使用
            onStatusChange(status);
        } else {
            // URL直接アクセスの場合はルーターを使用
            const params = new URLSearchParams(searchParams.toString());
            if (status === 'all') {
                params.delete('status');
            } else {
                params.set('status', status);
            }
            router.push(`/profit-dashboard?${params.toString()}`);
        }
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        if (onRefresh) {
            await onRefresh();
        } else {
            router.refresh();
        }
        setIsRefreshing(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
            <div className="max-w-7xl mx-auto">
                {/* ヘッダー */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <BarChart3 className="w-7 h-7" />
                            利益ダッシュボード
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">全案件の利益状況を一覧で確認</p>
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        更新
                    </button>
                </div>

                {/* サマリーカード */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <SummaryCard
                        title="総売上"
                        value={formatCurrency(summary.totalRevenue)}
                        icon={DollarSign}
                        color="blue"
                    />
                    <SummaryCard
                        title="総原価"
                        value={formatCurrency(summary.totalCost)}
                        icon={BarChart3}
                        color="gray"
                    />
                    <SummaryCard
                        title="総粗利"
                        value={formatCurrency(summary.totalGrossProfit)}
                        icon={summary.totalGrossProfit >= 0 ? TrendingUp : TrendingDown}
                        color={summary.totalGrossProfit >= 0 ? 'green' : 'red'}
                    />
                    <SummaryCard
                        title="平均利益率"
                        value={`${summary.averageProfitMargin}%`}
                        icon={BarChart3}
                        color="purple"
                    />
                </div>

                {/* フィルター */}
                <div className="bg-white rounded-lg shadow p-4 mb-6">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Filter className="w-4 h-4 text-slate-500" />
                            <span className="text-sm font-medium text-slate-600">ステータス:</span>
                        </div>
                        <div className="flex gap-2">
                            {[
                                { value: 'all', label: 'すべて' },
                                { value: 'active', label: '進行中' },
                                { value: 'completed', label: '完了' },
                            ].map(option => (
                                <button
                                    key={option.value}
                                    onClick={() => handleStatusChange(option.value)}
                                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${currentStatus === option.value
                                        ? 'bg-slate-700 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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

                {/* テーブル */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        案件名
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        顧客
                                    </th>
                                    <th
                                        className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                                        onClick={() => handleSort('revenue')}
                                    >
                                        売上 {sortBy === 'revenue' && (sortOrder === 'desc' ? '↓' : '↑')}
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        原価
                                    </th>
                                    <th
                                        className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                                        onClick={() => handleSort('grossProfit')}
                                    >
                                        粗利 {sortBy === 'grossProfit' && (sortOrder === 'desc' ? '↓' : '↑')}
                                    </th>
                                    <th
                                        className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                                        onClick={() => handleSort('profitMargin')}
                                    >
                                        利益率 {sortBy === 'profitMargin' && (sortOrder === 'desc' ? '↓' : '↑')}
                                    </th>
                                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        配置
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {sortedProjects.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                            該当する案件がありません
                                        </td>
                                    </tr>
                                ) : (
                                    sortedProjects.map(project => (
                                        <tr key={project.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-slate-800">{project.title}</div>
                                                <div className="text-xs text-slate-500">
                                                    {project.status === 'completed' ? '完了' : '進行中'}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1 text-sm text-slate-600">
                                                    <Building className="w-3.5 h-3.5" />
                                                    {project.customerName || '-'}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="font-medium text-slate-800">
                                                    {formatCurrency(project.revenue)}
                                                </div>
                                                {project.estimateAmount > 0 && project.estimateAmount !== project.revenue && (
                                                    <div className="text-xs text-slate-400">
                                                        見積: {formatCurrency(project.estimateAmount)}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-600">
                                                {formatCurrency(project.totalCost)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`font-medium ${project.grossProfit >= 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                                                    {formatCurrency(project.grossProfit)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`font-bold ${getProfitMarginColor(project.profitMargin)}`}>
                                                    {project.profitMargin}%
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center text-sm text-slate-500">
                                                {project.assignmentCount}件
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface SummaryCardProps {
    title: string;
    value: string;
    icon: React.ElementType;
    color: 'blue' | 'gray' | 'green' | 'red' | 'purple';
}

function SummaryCard({ title, value, icon: Icon, color }: SummaryCardProps) {
    const colorClasses = {
        blue: 'bg-slate-50 text-slate-600 border-slate-200',
        gray: 'bg-slate-50 text-slate-600 border-slate-200',
        green: 'bg-slate-50 text-slate-600 border-slate-200',
        red: 'bg-slate-50 text-slate-600 border-slate-200',
        purple: 'bg-slate-50 text-slate-600 border-slate-200',
    };

    const iconColorClasses = {
        blue: 'text-slate-500',
        gray: 'text-slate-500',
        green: 'text-slate-500',
        red: 'text-slate-500',
        purple: 'text-slate-500',
    };

    return (
        <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
            <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-5 h-5 ${iconColorClasses[color]}`} />
                <span className="text-sm font-medium">{title}</span>
            </div>
            <div className="text-2xl font-bold">{value}</div>
        </div>
    );
}
