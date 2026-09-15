'use client';

/**
 * 自社班の出来高のグラフ（kei 要望 2026-09-15）。表の上に置き、折りたためる（開閉はこの端末に覚えておく）。
 *
 *   班ごとの 人件費 と 外注換算 … 外注換算が人件費より長い班ほど、自社でやって得をしている（全班のときだけ）
 *   班ごとの 一人当たりの稼ぎ   … 最低ラインの縦線と比べる（全班のときだけ）
 *   日ごとの人工               … その日に出た延べ人数を 組立・解体・その他 で積む
 *   作業内容の割合             … 月の延べ人工の内訳
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { OwnCrewVolumeGroup, OwnCrewVolumeTotals } from '@/lib/ownCrewVolume';
import {
    CREW_CONTENT_KEYS,
    CREW_CONTENT_LABELS,
    buildOwnCrewDaily,
    summarizeOwnCrewContent,
    type CrewContentKey,
    type OwnCrewDailyPoint,
} from '@/lib/chartData';
import {
    AXIS_TICK,
    CATEGORY_TICK,
    CHART_COLORS,
    HOVER_CURSOR,
    formatYen,
    formatYenAxis,
    truncateLabel,
} from '@/components/charts/chartTheme';
import { ChartCard, ChartLegend, ChartTooltipBox, type ChartTooltipRow } from '@/components/charts/ChartParts';
import DonutChart from '@/components/charts/DonutChart';
import ThresholdBarChart, { type ThresholdBarDatum } from '@/components/charts/ThresholdBarChart';

const STORAGE_KEY = 'ownCrewVolume.chartsOpen';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const CONTENT_COLORS: Record<CrewContentKey, string> = {
    assembly: CHART_COLORS.violet,
    demolition: CHART_COLORS.yellow,
    other: CHART_COLORS.other,
};

interface ForemanDatum {
    key: string;
    label: string;
    laborCost: number;
    outsourcing: number;
    makeVsBuy: number;
    manDays: number;
}

interface Props {
    groups: OwnCrewVolumeGroup[];
    totals: OwnCrewVolumeTotals;
    /** 「全班」表示か（班ごとの比較グラフは全班のときだけ出す） */
    grouped: boolean;
    /** 取得済みデータの年月 */
    year: number;
    month: number;
    breakeven: number | null;
}

function ForemanTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ForemanDatum }> }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <ChartTooltipBox
            title={d.label}
            rows={[
                { key: 'labor', label: '人件費', value: formatYen(d.laborCost), color: CHART_COLORS.blue },
                { key: 'outsourcing', label: '外注換算', value: formatYen(d.outsourcing), color: CHART_COLORS.orange },
                { key: 'makeVsBuy', label: '自社でやった得', value: formatYen(d.makeVsBuy), tone: d.makeVsBuy < 0 ? 'negative' : 'default' },
                { key: 'manDays', label: '人工', value: `${d.manDays} 人工` },
            ]}
        />
    );
}

function LaborVsOutsourcingChart({ rows }: { rows: ForemanDatum[] }) {
    const isNarrow = useMediaQuery('(max-width: 639px)') === true;
    return (
        <>
            <ChartLegend
                className="mb-2"
                items={[
                    { key: 'labor', label: '人件費', color: CHART_COLORS.blue },
                    { key: 'outsourcing', label: '外注換算', color: CHART_COLORS.orange },
                ]}
            />
            <div role="img" aria-label="班ごとの人件費と外注換算の横棒グラフ">
                <ResponsiveContainer width="100%" height={rows.length * 40 + 28}>
                    <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barGap={2} barCategoryGap={8}>
                        <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
                        <XAxis
                            type="number"
                            tickFormatter={formatYenAxis}
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            axisLine={{ stroke: CHART_COLORS.grid }}
                            tickLine={false}
                        />
                        <YAxis
                            type="category"
                            dataKey="label"
                            width={isNarrow ? 76 : 112}
                            interval={0}
                            tickFormatter={(label: string) => truncateLabel(label, isNarrow ? 5 : 8)}
                            tick={CATEGORY_TICK}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={<ForemanTooltip />} cursor={HOVER_CURSOR} />
                        <Bar dataKey="laborCost" fill={CHART_COLORS.blue} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                        <Bar dataKey="outsourcing" fill={CHART_COLORS.orange} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </>
    );
}

function DailyTooltip({ active, payload, month }: { active?: boolean; payload?: Array<{ payload: OwnCrewDailyPoint }>; month: number }) {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    const title = `${month}/${p.day}（${WEEKDAYS[p.weekday]}）`;
    if (p.manDays === 0 && p.noReportCount === 0) {
        return <ChartTooltipBox title={title} rows={[]} note="自社班の作業はありません" />;
    }
    const rows: ChartTooltipRow[] = [
        ...CREW_CONTENT_KEYS.filter((k) => p[k] > 0).map((k) => ({
            key: k,
            label: CREW_CONTENT_LABELS[k],
            value: `${p[k]} 人工`,
            color: CONTENT_COLORS[k],
        })),
        { key: 'total', label: '合計', value: `${p.manDays} 人工` },
        { key: 'sites', label: '現場', value: `${p.siteCount} 件` },
        { key: 'earnings', label: '稼ぎ', value: formatYen(p.earnings) },
        { key: 'labor', label: '人件費', value: formatYen(p.laborCost) },
    ];
    return (
        <ChartTooltipBox
            title={title}
            rows={rows}
            note={p.noReportCount > 0 ? `日報なし ${p.noReportCount} 件（人数 0 で数えています）` : undefined}
        />
    );
}

function DailyManDaysChart({ points, month }: { points: OwnCrewDailyPoint[]; month: number }) {
    if (!points.some((p) => p.manDays > 0)) {
        return <p className="py-10 text-center text-sm text-slate-400">日報の人数が入った作業がありません</p>;
    }
    return (
        <>
            <ChartLegend
                className="mb-2"
                items={CREW_CONTENT_KEYS.map((k) => ({ key: k, label: CREW_CONTENT_LABELS[k], color: CONTENT_COLORS[k] }))}
            />
            <div role="img" aria-label="日ごとの延べ人工を作業内容別に積んだ棒グラフ">
                <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
                        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                        <XAxis
                            dataKey="day"
                            tick={{ ...AXIS_TICK, fontSize: 10 }}
                            minTickGap={2}
                            axisLine={{ stroke: CHART_COLORS.grid }}
                            tickLine={false}
                        />
                        <YAxis allowDecimals={false} tick={{ ...AXIS_TICK, fontSize: 10 }} width={32} axisLine={false} tickLine={false} />
                        <Tooltip content={<DailyTooltip month={month} />} cursor={HOVER_CURSOR} />
                        {CREW_CONTENT_KEYS.map((k) => (
                            <Bar
                                key={k}
                                dataKey={k}
                                stackId="content"
                                fill={CONTENT_COLORS[k]}
                                maxBarSize={20}
                                stroke="#ffffff"
                                strokeWidth={1}
                                isAnimationActive={false}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </>
    );
}

export default function OwnCrewVolumeCharts({ groups, totals, grouped, year, month, breakeven }: Props) {
    const [open, setOpen] = useState(true);

    useEffect(() => {
        try {
            if (window.localStorage.getItem(STORAGE_KEY) === '0') setOpen(false);
        } catch {
            // 保存場所が使えない端末（プライベートモード等）は開いたままにする
        }
    }, []);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
        } catch {
            // 覚えられなくても開け閉めはできる
        }
    };

    const daily = useMemo(() => buildOwnCrewDaily(groups, year, month), [groups, year, month]);
    const content = useMemo(() => summarizeOwnCrewContent(groups), [groups]);
    const foremen = useMemo<ForemanDatum[]>(
        () =>
            groups.map((g) => ({
                key: g.foremanId,
                label: g.foremanName,
                laborCost: g.totals.laborCost,
                outsourcing: g.totals.outsourcingEquivalent,
                makeVsBuy: g.totals.makeVsBuy,
                manDays: g.totals.manDays,
            })),
        [groups],
    );
    const perManday = useMemo<ThresholdBarDatum[]>(
        () =>
            groups.flatMap((g) =>
                g.totals.perManday === null
                    ? []
                    : [{
                        key: g.foremanId,
                        label: g.foremanName,
                        value: g.totals.perManday,
                        details: [
                            { key: 'earnings', label: '稼ぎ', value: formatYen(g.totals.earnings) },
                            { key: 'manDays', label: '人工', value: `${g.totals.manDays} 人工` },
                        ],
                    }],
            ),
        [groups],
    );

    const showForemanCharts = grouped && groups.length >= 2;

    return (
        <section className="flex flex-col gap-3" aria-label="自社班の出来高のグラフ">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                className="self-start inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-900"
            >
                {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <BarChart3 className="w-4 h-4 text-slate-400" />
                グラフ
                {!open && <span className="text-xs font-normal text-slate-400">（押すと開きます）</span>}
            </button>

            {open && (
                <>
                    {showForemanCharts && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                            <ChartCard
                                title="班ごとの 人件費 と 外注換算"
                                description="外注換算（橙）が人件費（青）より長い班ほど、自社でやって得をしています。"
                            >
                                <LaborVsOutsourcingChart rows={foremen} />
                            </ChartCard>
                            <ChartCard
                                title="班ごとの 一人当たりの稼ぎ"
                                description={
                                    breakeven != null
                                        ? '縦線が最低ライン。赤い棒の班は最低ラインに届いていません。'
                                        : '最低ラインは自社情報で設定すると縦線が出ます。'
                                }
                            >
                                {perManday.length > 0 ? (
                                    <ThresholdBarChart
                                        data={perManday}
                                        threshold={breakeven}
                                        valueLabel="一人当たりの稼ぎ"
                                        formatValue={formatYen}
                                        ariaLabel="班ごとの一人当たりの稼ぎの横棒グラフ"
                                    />
                                ) : (
                                    <p className="py-10 text-center text-sm text-slate-400">人工が入った班がありません</p>
                                )}
                            </ChartCard>
                        </div>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <ChartCard
                            className="lg:col-span-2"
                            title="日ごとの人工（作業内容別）"
                            description="棒の高さがその日に出た延べ人数です。棒にカーソルを当てると、その日の稼ぎと人件費が出ます。"
                        >
                            <DailyManDaysChart points={daily} month={month} />
                        </ChartCard>
                        <ChartCard title="作業内容の割合（人工）" description={`この月の延べ ${totals.manDays} 人工の内訳`}>
                            {totals.manDays > 0 ? (
                                <DonutChart
                                    segments={CREW_CONTENT_KEYS.map((k) => ({
                                        key: k,
                                        label: CREW_CONTENT_LABELS[k],
                                        value: content[k],
                                        color: CONTENT_COLORS[k],
                                    }))}
                                    formatValue={(v) => `${v} 人工`}
                                    valueLabel="人工"
                                    centerLabel="延べ"
                                    centerValue={`${totals.manDays}人工`}
                                    ariaLabel="作業内容ごとの人工の割合のドーナツグラフ"
                                />
                            ) : (
                                <p className="py-10 text-center text-sm text-slate-400">日報の人数が入った作業がありません</p>
                            )}
                        </ChartCard>
                    </div>
                </>
            )}
        </section>
    );
}
