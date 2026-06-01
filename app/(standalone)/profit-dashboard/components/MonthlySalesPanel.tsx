'use client';

import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatCurrency } from '@/utils/costCalculation';
import type { MonthlySalesData } from '@/lib/profitDashboard';

// 当月バーのみ teal-600（保存=ティールの配色方針）、過去月は slate-400
const SLATE_400 = '#94a3b8';
const TEAL_600 = '#0d9488';

function formatYAxis(value: number): string {
    if (value >= 100000000) return `${(value / 100000000).toFixed(1)}億`;
    if (value >= 10000000) return `${Math.round(value / 10000000)}千万`;
    if (value >= 10000) return `${Math.round(value / 10000)}万`;
    return `${value}`;
}

interface ChartDatum {
    label: string;       // 軸表示: "6月"（1月だけ "26/1" で年を補う）
    fullLabel: string;   // tooltip: "2026年6月"
    sales: number;
    invoiceCount: number;
    isCurrent: boolean;
}

function MonthlyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartDatum }> }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm">
            <p className="font-medium text-slate-800 mb-1">{d.fullLabel}{d.isCurrent && '（今月）'}</p>
            <p className="text-slate-600">売上: {formatCurrency(d.sales)}</p>
            <p className="text-slate-500 text-xs mt-0.5">請求 {d.invoiceCount}件</p>
        </div>
    );
}

export default function MonthlySalesPanel({ data }: { data: MonthlySalesData }) {
    const { current, previous, momDelta, momPercent } = data;

    const chartData = useMemo<ChartDatum[]>(() => data.trend.map((p, i) => ({
        // 年跨ぎで 1月 が重複しないよう、1月のみ "YY/1" 表記にする
        label: p.month === 1 ? `${String(p.year).slice(2)}/1` : `${p.month}月`,
        fullLabel: `${p.year}年${p.month}月`,
        sales: p.sales,
        invoiceCount: p.invoiceCount,
        isCurrent: i === data.trend.length - 1,
    })), [data.trend]);

    const up = momDelta > 0;
    const down = momDelta < 0;
    const trendColor = up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-slate-500';
    const TrendIcon = up ? TrendingUp : down ? TrendingDown : Minus;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
            <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="text-sm font-semibold text-slate-700">今月の売上（請求日ベース・税込）</h2>
                <span className="text-xs text-slate-400 text-right">フィルタの影響を受けない当月実績</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* ヘッドライン */}
                <div className="lg:col-span-1 flex flex-col justify-center min-w-0">
                    <div className="text-sm text-slate-500 mb-1">{current.year}年{current.month}月</div>
                    <div
                        className="text-3xl font-bold text-slate-800 tabular-nums truncate"
                        title={formatCurrency(current.sales)}
                    >
                        {formatCurrency(current.sales)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className={`inline-flex items-center gap-1 font-medium ${trendColor}`}>
                            <TrendIcon className="w-4 h-4 flex-shrink-0" />
                            {momPercent == null ? '—' : `${up ? '+' : ''}${momPercent}%`}
                        </span>
                        <span className="text-slate-400 whitespace-nowrap">
                            前月比 {momDelta >= 0 ? '+' : ''}{formatCurrency(momDelta)}
                        </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                        請求 {current.invoiceCount}件 ／ 前月 {formatCurrency(previous.sales)}
                    </div>
                </div>

                {/* 月次推移 */}
                <div className="lg:col-span-2 min-w-0">
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} />
                            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 11, fill: '#64748b' }} width={48} />
                            <Tooltip content={<MonthlyTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                            <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={48}>
                                {chartData.map((d, i) => (
                                    <Cell key={i} fill={d.isCurrent ? TEAL_600 : SLATE_400} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
