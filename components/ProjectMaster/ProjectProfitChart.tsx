'use client';

import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrency } from '@/utils/costCalculation';

interface CostBreakdown {
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
}

interface ProjectProfitChartProps {
    costBreakdown: CostBreakdown;
    revenue: number;
    grossProfit: number;
}

const COLORS = ['#334155', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9'];

export default function ProjectProfitChart({ costBreakdown, revenue, grossProfit }: ProjectProfitChartProps) {
    const data = [
        { name: '人件費', value: costBreakdown.laborCost },
        { name: '積込費', value: costBreakdown.loadingCost },
        { name: '車両費', value: costBreakdown.vehicleCost },
        { name: '材料費', value: costBreakdown.materialCost },
        { name: '外注費', value: costBreakdown.subcontractorCost },
        { name: 'その他', value: costBreakdown.otherExpenses },
    ].filter(d => d.value > 0);

    const totalCost = data.reduce((sum, d) => sum + d.value, 0);

    if (data.length === 0 || totalCost === 0) return null;

    // 売上に対する利益と原価の比率バー
    const profitRatio = revenue > 0 ? Math.max(0, Math.min(100, (grossProfit / revenue) * 100)) : 0;

    return (
        <div className="space-y-4">
            {/* 売上に対する利益率バー */}
            {revenue > 0 && (
                <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>原価 {formatCurrency(totalCost)}</span>
                        <span>粗利 {formatCurrency(grossProfit)}</span>
                    </div>
                    <div className="h-3 bg-slate-200 rounded-full overflow-hidden flex">
                        <div
                            className="bg-slate-400 transition-all"
                            style={{ width: `${100 - profitRatio}%` }}
                        />
                        <div
                            className="bg-slate-700 transition-all"
                            style={{ width: `${profitRatio}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                        <span>{(100 - profitRatio).toFixed(1)}%</span>
                        <span>{profitRatio.toFixed(1)}%</span>
                    </div>
                </div>
            )}

            {/* 原価構成ドーナツ */}
            <div>
                <div className="text-xs font-medium text-slate-500 mb-2">原価構成</div>
                <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                        >
                            {data.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value, name) => [
                                `${formatCurrency(Number(value))}（${Math.round(Number(value) / totalCost * 100)}%）`,
                                name,
                            ]}
                        />
                    </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
                    {data.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-1 text-[11px] text-slate-600">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            {d.name}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
