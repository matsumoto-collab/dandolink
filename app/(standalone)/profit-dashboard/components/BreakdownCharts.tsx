'use client';

/**
 * 利益ダッシュボード「月次売上」タブの 担当者別／顧客別 のグラフ（kei 要望 2026-09-15）。
 *   左: 横棒（棒の長さ＝売上、そのうち濃い部分＝粗利、右の数字＝粗利率）
 *   右: 売上の割合のドーナツ（上位5件＋その他）
 * データは MonthlySalesPanel が取った内訳（下の表と同じ期間・同じ軸）。表の絞り込みはグラフには効かない。
 */
import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { MonthlyAssigneeBreakdown } from '@/lib/profitDashboard';
import { REST_KEY, buildSalesProfitBars, buildSalesShare, type SalesProfitBar } from '@/lib/chartData';
import {
    AXIS_TICK,
    CATEGORY_TICK,
    CHART_COLORS,
    HOVER_CURSOR,
    SHARE_COLORS,
    formatYen,
    formatYenAxis,
    formatYenCompact,
    niceScale,
    truncateLabel,
} from '@/components/charts/chartTheme';
import { ChartLegend, ChartTooltipBox } from '@/components/charts/ChartParts';
import DonutChart from '@/components/charts/DonutChart';

const BAR_TOP_N = 8;
const SHARE_TOP_N = SHARE_COLORS.length;

/**
 * 棒の先の文字。黒字は粗利の部分の先に粗利率、赤字は（粗利の部分が 0 で描かれないので）原価の部分の先に「赤字」
 */
type BarDatum = SalesProfitBar & { profitLabel: string; lossLabel: string };

function SalesProfitTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BarDatum }> }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const negative = d.grossProfit < 0;
    return (
        <ChartTooltipBox
            title={d.name}
            rows={[
                { key: 'sales', label: '売上', value: formatYen(d.sales) },
                { key: 'cost', label: '原価', value: formatYen(d.cost), color: CHART_COLORS.muted },
                { key: 'profit', label: '粗利', value: formatYen(d.grossProfit), color: CHART_COLORS.teal, tone: negative ? 'negative' : 'default' },
                { key: 'margin', label: '粗利率', value: `${d.margin}%`, tone: negative ? 'negative' : 'default' },
            ]}
            note={`案件 ${d.itemCount} 件`}
        />
    );
}

export default function BreakdownCharts({ data, isLoading }: { data: MonthlyAssigneeBreakdown | null; isLoading: boolean }) {
    const isNarrow = useMediaQuery('(max-width: 639px)') === true;
    const rows = data?.rows;

    const bars = useMemo<BarDatum[]>(
        () =>
            buildSalesProfitBars(rows ?? [], BAR_TOP_N).map((b) => ({
                ...b,
                profitLabel: b.grossProfit < 0 ? '' : `${b.margin}%`,
                lossLabel: b.grossProfit < 0 ? '赤字' : '',
            })),
        [rows],
    );
    const share = useMemo(
        () =>
            buildSalesShare(rows ?? [], SHARE_TOP_N).map((item, i) => ({
                ...item,
                color: item.key === REST_KEY ? CHART_COLORS.other : SHARE_COLORS[i],
            })),
        [rows],
    );

    if (!data || bars.length === 0) return null;

    const axisName = data.axis === 'assignee' ? '担当者' : '顧客';
    const totalSales = share.reduce((sum, s) => sum + s.value, 0);
    const folded = bars.some((b) => b.key === REST_KEY);
    // 目盛りを 100万・200万… のきりのいい刻みにする（recharts 任せだと 65万刻みなどになる）
    const { domain, ticks } = niceScale(0, Math.max(...bars.map((b) => b.sales)), 4);

    return (
        <div className={`mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4 transition-opacity ${isLoading ? 'opacity-50' : ''}`}>
            <div className="lg:col-span-2 min-w-0 rounded-lg border border-slate-200 p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-700">{axisName}別の売上と粗利（税抜）</h3>
                    <ChartLegend
                        items={[
                            { key: 'cost', label: '原価', color: CHART_COLORS.muted },
                            { key: 'profit', label: '粗利', color: CHART_COLORS.teal },
                        ]}
                    />
                </div>
                <p className="mt-0.5 mb-2 text-xs text-slate-400">
                    棒の長さが売上、そのうち色の濃い部分が粗利です。右の数字は粗利率。
                    {folded && `売上の多い上位${BAR_TOP_N}件のほかは「その他」にまとめています。`}
                </p>
                <div role="img" aria-label={`${axisName}別の売上と粗利の横棒グラフ`}>
                    <ResponsiveContainer width="100%" height={bars.length * 34 + 28}>
                        <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 48, bottom: 0, left: 0 }} barCategoryGap={8}>
                            <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
                            <XAxis
                                type="number"
                                domain={domain}
                                ticks={ticks}
                                tickFormatter={formatYenAxis}
                                tick={{ ...AXIS_TICK, fontSize: 10 }}
                                axisLine={{ stroke: CHART_COLORS.grid }}
                                tickLine={false}
                            />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={isNarrow ? 84 : 136}
                                interval={0}
                                tickFormatter={(name: string) => truncateLabel(name, isNarrow ? 6 : 10)}
                                tick={CATEGORY_TICK}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip content={<SalesProfitTooltip />} cursor={HOVER_CURSOR} />
                            <Bar dataKey="costPart" stackId="sales" fill={CHART_COLORS.muted} barSize={16} isAnimationActive={false}>
                                <LabelList dataKey="lossLabel" position="right" fill="#dc2626" fontSize={11} fontWeight={600} />
                            </Bar>
                            <Bar dataKey="profitPart" stackId="sales" fill={CHART_COLORS.teal} barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                                <LabelList dataKey="profitLabel" position="right" fill="#475569" fontSize={11} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 p-3 sm:p-4">
                <h3 className="text-sm font-semibold text-slate-700">{axisName}別の売上の割合</h3>
                <p className="mt-0.5 mb-3 text-xs text-slate-400">
                    売上（税抜）の多い上位{SHARE_TOP_N}{data.axis === 'assignee' ? '名' : '社'}＋その他
                </p>
                <DonutChart
                    segments={share}
                    formatValue={formatYen}
                    valueLabel="売上（税抜）"
                    centerLabel="売上"
                    centerValue={formatYenCompact(totalSales)}
                    size={140}
                    ariaLabel={`${axisName}別の売上の割合のドーナツグラフ`}
                />
            </div>
        </div>
    );
}
