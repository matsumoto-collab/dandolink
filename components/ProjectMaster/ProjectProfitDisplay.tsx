'use client';

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Truck, Users, Wrench, Package, MoreHorizontal } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { formatCurrency, getProfitMarginColor } from '@/utils/costCalculation';

interface CostBreakdown {
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
    totalCost: number;
}

interface ProfitData {
    projectMasterId: string;
    projectTitle: string;
    revenue: number;
    estimateAmount: number;
    costBreakdown: CostBreakdown;
    grossProfit: number;
    profitMargin: number;
}

interface ProjectProfitDisplayProps {
    projectMasterId: string;
}

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
                console.error('Error fetching profit data:', err);
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
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-center py-8">
                    <Loading text="利益情報を読み込み中..." />
                </div>
            </div>
        );
    }

    if (error || !profitData) {
        return (
            <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center py-8 text-gray-500">
                    {error || '利益情報がありません'}
                </div>
            </div>
        );
    }

    const { costBreakdown, grossProfit, profitMargin, revenue, estimateAmount } = profitData;
    const isProfit = grossProfit >= 0;

    return (
        <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* ヘッダー */}
            <div className="px-6 py-4 bg-gradient-to-r from-slate-700 to-slate-600">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    利益サマリー
                </h3>
            </div>

            <div className="p-6">
                {/* メイン指標 */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    {/* 売上 */}
                    <div className="bg-blue-50 rounded-lg p-4">
                        <div className="text-sm text-blue-600 font-medium">売上（請求済）</div>
                        <div className="text-2xl font-bold text-blue-700">{formatCurrency(revenue)}</div>
                        <div className="text-xs text-blue-500 mt-1">見積: {formatCurrency(estimateAmount)}</div>
                    </div>

                    {/* 原価 */}
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-sm text-gray-600 font-medium">原価合計</div>
                        <div className="text-2xl font-bold text-gray-700">{formatCurrency(costBreakdown.totalCost)}</div>
                    </div>

                    {/* 粗利 */}
                    <div className={`rounded-lg p-4 ${isProfit ? 'bg-green-50' : 'bg-red-50'}`}>
                        <div className={`text-sm font-medium ${isProfit ? 'text-green-600' : 'text-red-600'}`}>粗利</div>
                        <div className={`text-2xl font-bold flex items-center gap-1 ${isProfit ? 'text-green-700' : 'text-red-700'}`}>
                            {isProfit ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                            {formatCurrency(grossProfit)}
                        </div>
                        <div className={`text-sm font-medium mt-1 ${getProfitMarginColor(profitMargin)}`}>
                            利益率: {profitMargin}%
                        </div>
                    </div>
                </div>

                {/* 原価内訳 */}
                <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold text-gray-600 mb-3">原価内訳</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <CostItem
                            icon={Users}
                            label="人件費"
                            amount={costBreakdown.laborCost}
                            color="blue"
                        />
                        <CostItem
                            icon={Truck}
                            label="積込費"
                            amount={costBreakdown.loadingCost}
                            color="purple"
                        />
                        <CostItem
                            icon={Truck}
                            label="車両費"
                            amount={costBreakdown.vehicleCost}
                            color="indigo"
                        />
                        <CostItem
                            icon={Package}
                            label="材料費"
                            amount={costBreakdown.materialCost}
                            color="amber"
                        />
                        <CostItem
                            icon={Wrench}
                            label="外注費"
                            amount={costBreakdown.subcontractorCost}
                            color="orange"
                        />
                        <CostItem
                            icon={MoreHorizontal}
                            label="その他"
                            amount={costBreakdown.otherExpenses}
                            color="gray"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

interface CostItemProps {
    icon: React.ElementType;
    label: string;
    amount: number;
    color: 'blue' | 'purple' | 'indigo' | 'amber' | 'orange' | 'gray';
}

function CostItem({ icon: Icon, label, amount, color }: CostItemProps) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600',
        purple: 'bg-purple-50 text-purple-600',
        indigo: 'bg-indigo-50 text-indigo-600',
        amber: 'bg-amber-50 text-amber-600',
        orange: 'bg-orange-50 text-orange-600',
        gray: 'bg-gray-50 text-gray-600',
    };

    return (
        <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
            <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{label}</span>
            </div>
            <div className="text-lg font-bold">{formatCurrency(amount)}</div>
        </div>
    );
}
