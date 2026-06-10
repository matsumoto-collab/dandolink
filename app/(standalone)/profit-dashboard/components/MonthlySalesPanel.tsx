'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/utils/costCalculation';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { MonthlySalesData } from '@/lib/profitDashboard';
import MonthlyAssigneeTable from './MonthlyAssigneeTable';

// 選択中の月のバーのみ teal-600（保存=ティールの配色方針）、その他は slate-300
const SLATE_300 = '#cbd5e1';
const TEAL_600 = '#0d9488';

// 「千万」丸めだと 1,500万 が「2千万」になり 2,000万 と重複表示されるため、
// 億未満は万単位カンマ区切りで一意に表示する（600万 / 1,000万 / 1,500万 / 2,000万）
function formatYAxis(value: number): string {
    if (value === 0) return '0';
    if (value >= 100000000) {
        const v = value / 100000000;
        return `${Number.isInteger(v) ? v : v.toFixed(1)}億`;
    }
    if (value >= 10000) return `${Math.round(value / 10000).toLocaleString()}万`;
    return `${value}`;
}

interface ChartDatum {
    index: number;
    label: string;       // 軸表示: "6月"（1月だけ "26/1" で年を補う）
    fullLabel: string;   // tooltip: "2026年6月"
    sales: number;
    invoiceCount: number;
    isSelected: boolean;
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
    const trend = data.trend;
    const lastIndex = trend.length - 1;
    // 既定は当月（末尾）。月送りで過去月も確認できる。
    const [selectedIndex, setSelectedIndex] = useState(lastIndex);
    // モバイルは13ヶ月分のX軸ラベルが重なるため隔月に間引く
    const isNarrow = useMediaQuery('(max-width: 639px)') === true;

    // 再フェッチ等で trend 長が変わったら当月へ寄せ直す
    useEffect(() => {
        setSelectedIndex(trend.length - 1);
    }, [trend.length]);

    const safeIndex = Math.min(Math.max(selectedIndex, 0), lastIndex);

    // すべての Hook は早期 return より前で呼ぶ（rules-of-hooks）。trend 空でも map は安全。
    const chartData = useMemo<ChartDatum[]>(() => trend.map((p, i) => ({
        index: i,
        label: p.month === 1 ? `${String(p.year).slice(2)}/1` : `${p.month}月`,
        fullLabel: `${p.year}年${p.month}月`,
        sales: p.sales,
        invoiceCount: p.invoiceCount,
        isSelected: i === safeIndex,
        isCurrent: i === lastIndex,
    })), [trend, safeIndex, lastIndex]);

    if (trend.length === 0) return null;

    const selected = trend[safeIndex];
    const prev = safeIndex > 0 ? trend[safeIndex - 1] : null;
    const isCurrent = safeIndex === lastIndex;

    const delta = selected.sales - (prev?.sales ?? 0);
    const percent = prev && prev.sales > 0
        ? Math.round((delta / prev.sales) * 1000) / 10
        : null;

    const up = delta > 0;
    const down = delta < 0;
    const trendColor = up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-slate-500';
    const TrendIcon = up ? TrendingUp : down ? TrendingDown : Minus;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-0.5 sm:gap-2">
                <h2 className="text-sm font-semibold text-slate-700">月次売上（送付済み以降・作成日ベース・税抜）</h2>
                <span className="text-xs text-slate-400 sm:text-right">フィルタの影響を受けない実績値</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* ヘッドライン（月ナビ付き） */}
                <div className="lg:col-span-1 flex flex-col justify-center min-w-0">
                    {/* 月セレクタ */}
                    <div className="flex items-center gap-1 mb-1">
                        <button
                            type="button"
                            onClick={() => setSelectedIndex(Math.max(0, safeIndex - 1))}
                            disabled={safeIndex <= 0}
                            aria-label="前の月"
                            className="p-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="text-sm text-slate-600 min-w-0 px-1 flex items-center gap-1.5">
                            <span className="tabular-nums whitespace-nowrap">{selected.year}年{selected.month}月</span>
                            {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-600 text-white">今月</span>}
                        </div>
                        <button
                            type="button"
                            onClick={() => setSelectedIndex(Math.min(lastIndex, safeIndex + 1))}
                            disabled={safeIndex >= lastIndex}
                            aria-label="次の月"
                            className="p-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                        {!isCurrent && (
                            <button
                                type="button"
                                onClick={() => setSelectedIndex(lastIndex)}
                                className="ml-1 text-xs text-teal-700 hover:underline whitespace-nowrap"
                            >
                                今月へ
                            </button>
                        )}
                    </div>
                    <div
                        className="text-3xl font-bold text-slate-800 tabular-nums truncate"
                        title={formatCurrency(selected.sales)}
                    >
                        {formatCurrency(selected.sales)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className={`inline-flex items-center gap-1 font-medium ${trendColor}`}>
                            <TrendIcon className="w-4 h-4 flex-shrink-0" />
                            {percent == null ? '—' : `${up ? '+' : ''}${percent}%`}
                        </span>
                        <span className="text-slate-400 whitespace-nowrap">
                            前月比 {delta >= 0 ? '+' : ''}{formatCurrency(delta)}
                        </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                        請求 {selected.invoiceCount}件{prev && ` ／ 前月 ${formatCurrency(prev.sales)}`}
                    </div>
                </div>

                {/* 月次推移（バーをクリックでその月を選択） */}
                <div className="lg:col-span-2 min-w-0" style={{ cursor: 'pointer' }}>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart
                            data={chartData}
                            margin={{ top: 5, right: 8, left: 0, bottom: 0 }}
                            onClick={(state) => {
                                const i = (state as { activeTooltipIndex?: number } | null)?.activeTooltipIndex;
                                if (typeof i === 'number') setSelectedIndex(i);
                            }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: isNarrow ? 10 : 11, fill: '#64748b' }} interval={isNarrow ? 1 : 0} />
                            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: isNarrow ? 10 : 11, fill: '#64748b' }} width={isNarrow ? 44 : 48} />
                            <Tooltip content={<MonthlyTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                            <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={48}>
                                {chartData.map((d) => (
                                    <Cell key={d.index} fill={d.isSelected ? TEAL_600 : SLATE_300} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* 案件担当者別（選択中の月）：売上・原価（日報＋配置の自動／手修正可）・粗利 */}
            <MonthlyAssigneeTable year={selected.year} month={selected.month} />
        </div>
    );
}
