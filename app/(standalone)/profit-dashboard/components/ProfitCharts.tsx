'use client';

import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell,
} from 'recharts';
import { formatCurrency } from '@/utils/costCalculation';
import type { SerializedProjectProfit } from './ProfitDashboardClient';

interface ProfitChartsProps {
    projects: SerializedProjectProfit[];
}

const COLORS = {
    revenue: '#334155',    // slate-700
    cost: '#94a3b8',       // slate-400
    profit: '#475569',     // slate-600
    pie: ['#334155', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9'],
};

const MARGIN_COLORS = [
    { range: '赤字', color: '#ef4444', min: -Infinity, max: 0 },
    { range: '0-10%', color: '#f59e0b', min: 0, max: 10 },
    { range: '10-20%', color: '#94a3b8', min: 10, max: 20 },
    { range: '20-30%', color: '#64748b', min: 20, max: 30 },
    { range: '30%+', color: '#334155', min: 30, max: Infinity },
];

function formatYAxis(value: number): string {
    if (value >= 10000000) return `${(value / 10000000).toFixed(0)}千万`;
    if (value >= 10000) return `${(value / 10000).toFixed(0)}万`;
    return `${value}`;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm">
            <p className="font-medium text-slate-800 mb-1">{label}</p>
            {payload.map((entry, i) => (
                <p key={i} className="text-slate-600">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: entry.color }} />
                    {entry.name}: {formatCurrency(entry.value)}
                </p>
            ))}
        </div>
    );
}

export default function ProfitCharts({ projects }: ProfitChartsProps) {
    // 売上TOP10の棒グラフデータ
    const topProjectsData = useMemo(() => {
        return projects
            .filter(p => p.revenue > 0 || p.totalCost > 0)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map(p => ({
                name: p.title.length > 10 ? p.title.slice(0, 10) + '…' : p.title,
                売上: p.revenue,
                原価: p.totalCost,
                粗利: p.grossProfit,
            }));
    }, [projects]);

    // 全案件の原価構成ドーナツ
    const costBreakdownData = useMemo(() => {
        const totals = {
            人件費: 0, 積込費: 0, 車両費: 0, 材料費: 0, 外注費: 0, その他: 0,
        };
        projects.forEach(p => {
            totals['人件費'] += p.laborCost;
            totals['積込費'] += p.loadingCost;
            totals['車両費'] += p.vehicleCost;
            totals['材料費'] += p.materialCost;
            totals['外注費'] += p.subcontractorCost;
            totals['その他'] += p.otherExpenses;
        });
        return Object.entries(totals)
            .filter(([, v]) => v > 0)
            .map(([name, value]) => ({ name, value }));
    }, [projects]);

    // 利益率分布ドーナツ
    const marginDistribution = useMemo(() => {
        return MARGIN_COLORS.map(({ range, color, min, max }) => ({
            name: range,
            value: projects.filter(p => p.profitMargin >= min && p.profitMargin < max).length,
            color,
        })).filter(d => d.value > 0);
    }, [projects]);

    const totalCost = costBreakdownData.reduce((sum, d) => sum + d.value, 0);

    if (projects.length === 0) return null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* 売上TOP10 棒グラフ */}
            {topProjectsData.length > 0 && (
                <div className="bg-white rounded-lg shadow p-5 lg:col-span-2">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">案件別 売上・原価・粗利（TOP10）</h3>
                    <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={topProjectsData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} angle={-20} textAnchor="end" height={60} />
                            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 11, fill: '#64748b' }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="売上" fill={COLORS.revenue} radius={[4, 4, 0, 0]} />
                            <Bar dataKey="原価" fill={COLORS.cost} radius={[4, 4, 0, 0]} />
                            <Bar dataKey="粗利" fill={COLORS.profit} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* 原価構成ドーナツ */}
            {costBreakdownData.length > 0 && (
                <div className="bg-white rounded-lg shadow p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">原価構成</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie
                                data={costBreakdownData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={100}
                                paddingAngle={2}
                                dataKey="value"
                            >
                                {costBreakdownData.map((_, i) => (
                                    <Cell key={i} fill={COLORS.pie[i % COLORS.pie.length]} />
                                ))}
                            </Pie>
                            <Tooltip
                                formatter={(value, name) => [
                                    `${formatCurrency(Number(value))}（${totalCost > 0 ? Math.round(Number(value) / totalCost * 100) : 0}%）`,
                                    name,
                                ]}
                            />
                            <Legend
                                wrapperStyle={{ fontSize: 12 }}
                                formatter={(value: string) => <span className="text-slate-600">{value}</span>}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* 利益率分布ドーナツ */}
            {marginDistribution.length > 0 && (
                <div className="bg-white rounded-lg shadow p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">利益率分布（案件数）</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie
                                data={marginDistribution}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={100}
                                paddingAngle={2}
                                dataKey="value"
                                label={({ name, value }) => `${name}: ${value}件`}
                            >
                                {marginDistribution.map((d, i) => (
                                    <Cell key={i} fill={d.color} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value) => [`${value}件`]} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
