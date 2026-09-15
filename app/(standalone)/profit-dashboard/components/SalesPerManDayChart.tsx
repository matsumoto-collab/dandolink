'use client';

/**
 * 「売上 ÷ 人工」の推移グラフ（利益ダッシュボード「一人当たりの稼ぎ」タブ・kei 要望 2026-09-15）。
 * 月別: 売上÷人工 と 3か月移動平均 の折れ線（単位が同じなので軸は 1 本）。過去データから DandoLink に変わる月に線を引く。
 * 日別: 延べ人工 と 売上 を上下 2 段の棒で並べる（単位が違うので軸を分ける。日別に 売上÷人工 は出さない＝kei 決定）。
 */
import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SalesPerManDayBucket, SalesPerManDaySummary } from '@/lib/salesPerManDay';
import { AXIS_TICK, CHART_COLORS, HOVER_CURSOR, formatYen, formatYenAxis } from '@/components/charts/chartTheme';
import { ChartLegend, ChartTooltipBox, type ChartTooltipRow } from '@/components/charts/ChartParts';

interface Point extends SalesPerManDayBucket {
    /** 軸の文字（月別 '26/5'・日別 '5/14'） */
    label: string;
}

const manDaysText = (n: number) => `${n.toLocaleString('ja-JP')} 人工`;

function toLabel(key: string, isDaily: boolean): string {
    const [y, m, d] = key.split('-');
    return isDaily ? `${Number(m)}/${Number(d)}` : `${y.slice(2)}/${Number(m)}`;
}

function toTitle(key: string, isDaily: boolean): string {
    const [y, m, d] = key.split('-');
    return isDaily ? `${y}年${Number(m)}月${Number(d)}日` : `${y}年${Number(m)}月`;
}

function MonthlyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    const rows: ChartTooltipRow[] = [
        { key: 'ratio', label: '売上 ÷ 人工', value: formatYen(p.salesPerManDay), color: CHART_COLORS.teal },
        { key: 'avg', label: '3か月移動平均', value: formatYen(p.movingAvg3), color: CHART_COLORS.orange },
        { key: 'sales', label: '売上（税抜）', value: formatYen(p.sales) },
        { key: 'manDays', label: '延べ人工', value: manDaysText(p.manDays) },
    ];
    return (
        <ChartTooltipBox
            title={toTitle(p.key, false)}
            rows={rows}
            note={p.source === 'backfill' ? '過去データで数えた月' : 'DandoLink のデータで数えた月'}
        />
    );
}

function MonthlyLines({ points }: { points: Point[] }) {
    // 過去データと DandoLink の両方が入っているときだけ、切り替わる月に線を引く
    const firstLive = points.find((p) => p.source === 'live');
    const showLiveStart = firstLive !== undefined && points[0].source === 'backfill';
    // 線がグラフの右半分にあるときは文字を線の左に置く（スマホで右端が切れないように）
    const liveIndex = firstLive ? points.indexOf(firstLive) : -1;
    const liveLabelPosition = liveIndex > points.length / 2 ? 'insideTopRight' : 'insideTopLeft';
    return (
        <div className="mb-3">
            <ChartLegend
                className="mb-2"
                items={[
                    { key: 'ratio', label: '売上 ÷ 人工', color: CHART_COLORS.teal, shape: 'line' },
                    { key: 'avg', label: '3か月移動平均', color: CHART_COLORS.orange, shape: 'line' },
                ]}
            />
            <div role="img" aria-label="月別の売上÷人工と3か月移動平均の折れ線グラフ">
                <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                        <XAxis
                            dataKey="label"
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            minTickGap={8}
                            axisLine={{ stroke: CHART_COLORS.grid }}
                            tickLine={false}
                        />
                        <YAxis
                            tickFormatter={(v: number) => v.toLocaleString('ja-JP')}
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            width={56}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={<MonthlyTooltip />} cursor={{ stroke: CHART_COLORS.axisText, strokeWidth: 1 }} />
                        {showLiveStart && (
                            <ReferenceLine
                                x={firstLive.label}
                                stroke={CHART_COLORS.other}
                                label={{ value: 'ここから DandoLink', position: liveLabelPosition, fill: CHART_COLORS.axisText, fontSize: 10 }}
                            />
                        )}
                        <Line
                            type="linear"
                            dataKey="salesPerManDay"
                            stroke={CHART_COLORS.teal}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
                            connectNulls
                            isAnimationActive={false}
                        />
                        <Line
                            type="linear"
                            dataKey="movingAvg3"
                            stroke={CHART_COLORS.orange}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
                            connectNulls
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function DailyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
        <ChartTooltipBox
            title={toTitle(p.key, true)}
            rows={[
                { key: 'manDays', label: '延べ人工', value: manDaysText(p.manDays) },
                { key: 'sales', label: '売上（税抜）', value: formatYen(p.sales) },
            ]}
        />
    );
}

function DailyColumn({
    title,
    dataKey,
    color,
    points,
    tickFormatter,
}: {
    title: string;
    dataKey: 'manDays' | 'sales';
    color: string;
    points: Point[];
    tickFormatter: (value: number) => string;
}) {
    return (
        <div>
            <h4 className="text-xs font-medium text-slate-500 mb-1">{title}</h4>
            <div role="img" aria-label={`日別の${title}の棒グラフ`}>
                <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={points} syncId="sales-per-manday-daily" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                        <XAxis
                            dataKey="label"
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            minTickGap={6}
                            axisLine={{ stroke: CHART_COLORS.grid }}
                            tickLine={false}
                        />
                        <YAxis
                            tickFormatter={tickFormatter}
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            width={56}
                            axisLine={false}
                            tickLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip content={<DailyTooltip />} cursor={HOVER_CURSOR} />
                        <Bar dataKey={dataKey} fill={color} maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default function SalesPerManDayChart({ data }: { data: SalesPerManDaySummary }) {
    const isDaily = data.granularity === 'day';
    const points = useMemo<Point[]>(
        () => data.buckets.map((b) => ({ ...b, label: toLabel(b.key, isDaily) })),
        [data.buckets, isDaily],
    );
    if (points.length < 2) return null;

    if (!isDaily) return <MonthlyLines points={points} />;
    return (
        <div className="mb-3 space-y-3">
            <DailyColumn
                title="延べ人工"
                dataKey="manDays"
                color={CHART_COLORS.headcount}
                points={points}
                tickFormatter={(v) => v.toLocaleString('ja-JP')}
            />
            <DailyColumn
                title="売上（税抜・請求した日）"
                dataKey="sales"
                color={CHART_COLORS.teal}
                points={points}
                tickFormatter={formatYenAxis}
            />
        </div>
    );
}
