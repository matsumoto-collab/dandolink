'use client';

/**
 * ドーナツ（円）グラフ＋凡例。
 * 凡例には必ず値と割合を並べる（色だけに頼らない・白地で薄い色でも読めるように）。
 * 大きさは固定で描く（ResponsiveContainer を使わない）ので、狭いモーダルの中でも崩れない。
 */
import React from 'react';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import { ChartTooltipBox } from './ChartParts';

export interface DonutSegment {
    key: string;
    label: string;
    value: number;
    color: string;
}

interface Props {
    segments: DonutSegment[];
    formatValue: (value: number) => string;
    /** 吹き出しでの値の名前（例: 金額・人工） */
    valueLabel: string;
    /** 真ん中に出す見出しと数字 */
    centerLabel?: string;
    centerValue?: string;
    size?: number;
    ariaLabel: string;
}

const percent = (value: number, total: number) => Math.round((value / total) * 1000) / 10;

function DonutTooltip({
    active,
    payload,
    total,
    formatValue,
    valueLabel,
}: {
    active?: boolean;
    payload?: Array<{ payload: DonutSegment }>;
    total: number;
    formatValue: (value: number) => string;
    valueLabel: string;
}) {
    if (!active || !payload?.length) return null;
    const segment = payload[0].payload;
    return (
        <ChartTooltipBox
            title={segment.label}
            rows={[
                { key: 'value', label: valueLabel, value: formatValue(segment.value), color: segment.color },
                { key: 'percent', label: '割合', value: `${percent(segment.value, total)}%` },
            ]}
        />
    );
}

export default function DonutChart({
    segments,
    formatValue,
    valueLabel,
    centerLabel,
    centerValue,
    size = 148,
    ariaLabel,
}: Props) {
    const drawn = segments.filter((s) => s.value > 0);
    const total = drawn.reduce((sum, s) => sum + s.value, 0);
    if (drawn.length === 0 || total <= 0) return null;

    return (
        <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>
                <PieChart width={size} height={size}>
                    <Pie
                        data={drawn}
                        dataKey="value"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        innerRadius={Math.round(size * 0.32)}
                        outerRadius={Math.floor(size / 2) - 2}
                        startAngle={90}
                        endAngle={-270}
                        stroke="#ffffff"
                        strokeWidth={2}
                        isAnimationActive={false}
                    >
                        {drawn.map((s) => (
                            <Cell key={s.key} fill={s.color} />
                        ))}
                    </Pie>
                    <Tooltip
                        content={<DonutTooltip total={total} formatValue={formatValue} valueLabel={valueLabel} />}
                        wrapperStyle={{ zIndex: 20 }}
                        allowEscapeViewBox={{ x: true, y: true }}
                    />
                </PieChart>
                {(centerLabel || centerValue) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        {centerLabel && <span className="text-[10px] leading-tight text-slate-500">{centerLabel}</span>}
                        {centerValue && <span className="text-sm font-bold leading-tight text-slate-800">{centerValue}</span>}
                    </div>
                )}
            </div>
            <ul className="w-full min-w-0 flex-1 space-y-1">
                {drawn.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-3 text-xs">
                        <span className="inline-flex items-center gap-1.5 min-w-0 text-slate-600" title={s.label}>
                            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="truncate">{s.label}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-800">
                            {formatValue(s.value)}
                            <span className="inline-block w-12 text-right text-slate-400">{percent(s.value, total)}%</span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
