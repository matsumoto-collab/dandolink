'use client';

/**
 * 名前ごとの値を横棒で並べ、最低ラインを縦線で引くグラフ。
 * 最低ライン以上はティール・未満は赤。色だけに頼らないよう、凡例と棒の先の数字を必ず出す。
 * 使っている所: 自社班の出来高（班ごとの一人当たりの稼ぎ）／利益ダッシュボード（区分別の一人当たりの稼ぎ）
 */
import React from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    LabelList,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
    AXIS_TICK,
    CATEGORY_TICK,
    CHART_COLORS,
    HOVER_CURSOR,
    formatYenAxis,
    niceScale,
    truncateLabel,
} from './chartTheme';
import { ChartLegend, ChartTooltipBox, type ChartTooltipRow } from './ChartParts';

export interface ThresholdBarDatum {
    key: string;
    label: string;
    value: number;
    /** 吹き出しに足す行（稼ぎ・人工など） */
    details?: ChartTooltipRow[];
}

interface Props {
    data: ThresholdBarDatum[];
    /** 最低ライン。null（未設定）なら線を引かず、全部ティールで描く */
    threshold: number | null;
    /** 吹き出しでの値の名前（例: 一人当たりの稼ぎ） */
    valueLabel: string;
    formatValue: (value: number) => string;
    formatAxis?: (value: number) => string;
    thresholdLabel?: string;
    ariaLabel: string;
}

const ROW_HEIGHT = 30;

function ThresholdTooltip({
    active,
    payload,
    valueLabel,
    formatValue,
    threshold,
    thresholdLabel,
}: {
    active?: boolean;
    payload?: Array<{ payload: ThresholdBarDatum }>;
    valueLabel: string;
    formatValue: (value: number) => string;
    threshold: number | null;
    thresholdLabel: string;
}) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const below = threshold !== null && d.value < threshold;
    const rows: ChartTooltipRow[] = [
        { key: 'value', label: valueLabel, value: formatValue(d.value), tone: below ? 'negative' : 'default' },
    ];
    if (threshold !== null) {
        const diff = d.value - threshold;
        rows.push({
            key: 'diff',
            label: `${thresholdLabel}との差`,
            value: `${diff >= 0 ? '+' : '−'}${formatValue(Math.abs(diff))}`,
            tone: below ? 'negative' : 'default',
        });
    }
    return <ChartTooltipBox title={d.label} rows={[...rows, ...(d.details ?? [])]} />;
}

export default function ThresholdBarChart({
    data,
    threshold,
    valueLabel,
    formatValue,
    formatAxis = formatYenAxis,
    thresholdLabel = '最低ライン',
    ariaLabel,
}: Props) {
    const isNarrow = useMediaQuery('(max-width: 639px)') === true;
    if (data.length === 0) return null;

    const line = threshold !== null && threshold > 0 ? threshold : null;
    const values = data.map((d) => d.value);
    // 最低ラインの線が必ず見えるよう、線の値も範囲に入れて目盛りを決める
    const { domain, ticks } = niceScale(Math.min(0, ...values), Math.max(0, line ?? 0, ...values));
    const colorOf = (value: number) => (line !== null && value < line ? CHART_COLORS.red : CHART_COLORS.teal);

    return (
        <div>
            {line !== null && (
                <ChartLegend
                    className="mb-2"
                    items={[
                        { key: 'above', label: `${thresholdLabel}以上`, color: CHART_COLORS.teal },
                        { key: 'below', label: `${thresholdLabel}未満`, color: CHART_COLORS.red },
                        { key: 'line', label: `${thresholdLabel}（${formatValue(line)}）`, color: CHART_COLORS.reference, shape: 'line' },
                    ]}
                />
            )}
            <div role="img" aria-label={ariaLabel}>
                <ResponsiveContainer width="100%" height={data.length * ROW_HEIGHT + (line !== null ? 44 : 28)}>
                    <BarChart
                        data={data}
                        layout="vertical"
                        margin={{ top: line !== null ? 16 : 4, right: 72, bottom: 0, left: 0 }}
                        barCategoryGap={6}
                    >
                        <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
                        <XAxis
                            type="number"
                            domain={domain}
                            ticks={ticks}
                            tickFormatter={formatAxis}
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            axisLine={{ stroke: CHART_COLORS.grid }}
                            tickLine={false}
                        />
                        <YAxis
                            type="category"
                            dataKey="label"
                            width={isNarrow ? 76 : 120}
                            interval={0}
                            tickFormatter={(label: string) => truncateLabel(label, isNarrow ? 5 : 9)}
                            tick={CATEGORY_TICK}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            content={
                                <ThresholdTooltip
                                    valueLabel={valueLabel}
                                    formatValue={formatValue}
                                    threshold={line}
                                    thresholdLabel={thresholdLabel}
                                />
                            }
                            cursor={HOVER_CURSOR}
                        />
                        {line !== null && (
                            <ReferenceLine
                                x={line}
                                stroke={CHART_COLORS.reference}
                                strokeWidth={1.5}
                                label={{ value: thresholdLabel, position: 'top', fill: CHART_COLORS.reference, fontSize: 10 }}
                            />
                        )}
                        <Bar dataKey="value" barSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                            {data.map((d) => (
                                <Cell key={d.key} fill={colorOf(d.value)} />
                            ))}
                            {/* 最低ラインの縦線が数字を横切っても読めるよう、白い縁取りを付ける（文字は線より上に描かれる） */}
                            <LabelList
                                dataKey="value"
                                position="right"
                                formatter={(v) => formatValue(Number(v))}
                                fill="#475569"
                                fontSize={11}
                                stroke="#ffffff"
                                strokeWidth={3}
                                paintOrder="stroke"
                            />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
