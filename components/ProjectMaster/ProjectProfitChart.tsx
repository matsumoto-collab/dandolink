'use client';

/**
 * 利益サマリーの「お金の行き先」ドーナツ（kei 要望 2026-09-15）。
 * 売上があって黒字なら 売上 ＝ 利益 ＋ 原価の内訳 を 1 周で見せ、真ん中に利益率を出す。
 * 赤字・売上なしのときは原価の内訳だけを描き、赤字額を下に添える。
 */
import React from 'react';
import { formatCurrency } from '@/utils/costCalculation';
import DonutChart from '@/components/charts/DonutChart';
import { CHART_COLORS, formatYenCompact } from '@/components/charts/chartTheme';
import { buildProfitComposition, type ProfitCompositionCosts, type ProfitCompositionKey } from '@/lib/chartData';

/** 人件費はどの画面でも青、外注は橙、利益はティール（chartTheme の色の決め事） */
const SEGMENT_COLORS: Record<ProfitCompositionKey, string> = {
    profit: CHART_COLORS.teal,
    subcontractor: CHART_COLORS.orange,
    labor: CHART_COLORS.blue,
    material: CHART_COLORS.yellow,
    loading: CHART_COLORS.magenta,
    vehicle: CHART_COLORS.violet,
    other: CHART_COLORS.other,
};

interface Props {
    costBreakdown: ProfitCompositionCosts;
    revenue: number;
    grossProfit: number;
    /** API の利益率（見出しの「利益率 〇%」と同じ数字を真ん中に出す） */
    profitMargin: number;
}

export default function ProjectProfitChart({ costBreakdown, revenue, grossProfit, profitMargin }: Props) {
    const composition = buildProfitComposition(costBreakdown, revenue, grossProfit);
    if (!composition) return null;
    const isRevenue = composition.mode === 'revenue';

    return (
        <div data-testid="profit-composition-chart">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 mb-2">
                <span className="text-xs font-medium text-slate-500">
                    {isRevenue ? 'お金の行き先（売上の内訳）' : '原価の内訳'}
                </span>
                <span className="text-[11px] text-slate-400">
                    {isRevenue
                        ? `売上 ${formatCurrency(revenue)} を100%とした割合`
                        : `原価 ${formatCurrency(composition.totalCost)} を100%とした割合`}
                </span>
            </div>
            <DonutChart
                segments={composition.segments.map((s) => ({ ...s, color: SEGMENT_COLORS[s.key] }))}
                formatValue={formatCurrency}
                valueLabel="金額"
                centerLabel={isRevenue ? '利益率' : '原価'}
                centerValue={isRevenue ? `${profitMargin}%` : formatYenCompact(composition.totalCost)}
                ariaLabel={isRevenue ? '売上を利益と原価の内訳に分けたドーナツグラフ' : '原価の内訳のドーナツグラフ'}
            />
            {composition.lossAmount > 0 && (
                <p className="mt-2 text-xs text-red-600">
                    原価が売上を {formatCurrency(composition.lossAmount)} 上回っています（赤字）
                </p>
            )}
        </div>
    );
}
