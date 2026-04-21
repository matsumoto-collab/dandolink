'use client';

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { formatCurrency, getProfitMarginColor } from '@/utils/costCalculation';
import { logger } from '@/lib/logger';

interface CostBreakdown {
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
    totalCost: number;
}

type RevenueSource = 'invoice' | 'estimate' | 'contract' | 'none';

interface ProfitData {
    projectMasterId: string;
    projectTitle: string;
    revenue: number;
    revenueSource?: RevenueSource;
    invoiceAmount?: number;
    estimateAmount: number;
    estimateSubtotal?: number;
    estimateCostTotal: number | null;
    costBreakdown: CostBreakdown;
    grossProfit: number;
    profitMargin: number;
}

interface ProjectProfitDisplayProps {
    projectMasterId: string;
}

const BADGE_STYLES: Record<RevenueSource, string> = {
    invoice: 'border-slate-300 text-slate-700 bg-white',
    estimate: 'border-amber-300 text-amber-700 bg-amber-50',
    contract: 'border-sky-300 text-sky-700 bg-sky-50',
    none: 'border-slate-200 text-slate-500 bg-slate-50',
};

const BADGE_LABELS: Record<RevenueSource, string> = {
    invoice: '請求済・税別',
    estimate: '見積・税別',
    contract: '足場工事金額',
    none: '未入力',
};

export default function ProjectProfitDisplay({ projectMasterId }: ProjectProfitDisplayProps) {
    const [profitData, setProfitData] = useState<ProfitData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchProfitData = async () => {
            try {
                setIsLoading(true);
                const response = await fetch(`/api/project-masters/${projectMasterId}/profit`);
                if (!response.ok) {
                    throw new Error('Failed to fetch profit data');
                }
                const data = await response.json();
                setProfitData(data);
            } catch (err) {
                logger.error('Error fetching profit data:', err);
                setError('利益情報の取得に失敗しました');
            } finally {
                setIsLoading(false);
            }
        };

        if (projectMasterId) {
            fetchProfitData();
        }
    }, [projectMasterId]);

    if (isLoading) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-center py-8">
                    <Loading text="利益情報を読み込み中..." />
                </div>
            </div>
        );
    }

    if (error || !profitData) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="text-center py-8 text-slate-500">
                    {error || '利益情報がありません'}
                </div>
            </div>
        );
    }

    const { costBreakdown, grossProfit, profitMargin, revenue } = profitData;
    const revenueSource: RevenueSource = profitData.revenueSource
        ?? (revenue > 0 ? 'invoice' : 'none');
    const isProfit = grossProfit >= 0;

    const costItems = [
        { label: '人件費', amount: costBreakdown.laborCost },
        { label: '車両費', amount: costBreakdown.vehicleCost },
        { label: '材料費', amount: costBreakdown.materialCost },
        { label: '外注費', amount: costBreakdown.subcontractorCost },
        { label: '積込費', amount: costBreakdown.loadingCost },
        { label: 'その他', amount: costBreakdown.otherExpenses },
    ].sort((a, b) => b.amount - a.amount);

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-[rgb(var(--color-navy-primary))]">
                <h3 className="text-base font-semibold text-white">利益サマリー</h3>
            </div>

            <div className="p-5 space-y-5">
                <div>
                    <div className="mb-2">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${BADGE_STYLES[revenueSource]}`}>
                            {BADGE_LABELS[revenueSource]}
                        </span>
                    </div>
                    <div className="text-sm text-slate-500 mb-1">利益</div>
                    <div className={`text-4xl font-bold tracking-tight tabular-nums ${isProfit ? 'text-slate-900' : 'text-red-600'}`}>
                        {formatCurrency(grossProfit)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                        {isProfit ? (
                            <TrendingUp className="w-4 h-4 text-slate-400" />
                        ) : (
                            <TrendingDown className="w-4 h-4 text-red-500" />
                        )}
                        <span className={`text-sm font-medium ${getProfitMarginColor(profitMargin)}`}>
                            利益率 {profitMargin}%
                        </span>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">売上</span>
                        <span className="text-base font-semibold text-slate-800 tabular-nums">{formatCurrency(revenue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">原価</span>
                        <span className="text-base font-semibold text-slate-800 tabular-nums">{formatCurrency(costBreakdown.totalCost)}</span>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">原価内訳</h4>
                    <div className="space-y-1.5">
                        {costItems.map(item => {
                            const isZero = item.amount === 0;
                            return (
                                <div key={item.label} className="flex items-center justify-between">
                                    <span className={`text-sm ${isZero ? 'text-slate-300' : 'text-slate-600'}`}>
                                        {item.label}
                                    </span>
                                    <span className={`text-sm font-medium tabular-nums ${isZero ? 'text-slate-300' : 'text-slate-700'}`}>
                                        {formatCurrency(item.amount)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
