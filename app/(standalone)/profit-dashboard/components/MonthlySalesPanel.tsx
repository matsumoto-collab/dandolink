'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { formatCurrency } from '@/utils/costCalculation';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { MonthlySalesData, MonthlyAssigneeBreakdown, BreakdownAxis, BreakdownPeriod } from '@/lib/profitDashboard';
import MonthlyAssigneeTable, { Segmented } from './MonthlyAssigneeTable';

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
    isSelected: boolean; // 単月=選択月 / 年間・期間指定=対象期間内
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

const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
// <input type="month"> の値 'YYYY-MM' を {y, m} に。無効値は null。
const parseYm = (s: string): { y: number; m: number } | null => {
    const [y, m] = s.split('-').map(Number);
    return Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12 ? { y, m } : null;
};

export default function MonthlySalesPanel({ data }: { data: MonthlySalesData }) {
    const trend = data.trend;
    const lastIndex = trend.length - 1;
    // 既定は当月（末尾）。月送りで過去月も確認できる。
    const [selectedIndex, setSelectedIndex] = useState(lastIndex);
    // 期間モード: 当月 / 年間（選択月の暦年） / 期間指定（開始月〜終了月・trend より古い月も指定可）
    const [periodMode, setPeriodMode] = useState<BreakdownPeriod>('month');
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    // 内訳（担当者別/顧客別）の軸と取得データ。fetch はこのパネルが一元管理し、表とKPIで共有する。
    const [axis, setAxis] = useState<BreakdownAxis>('assignee');
    const [breakdown, setBreakdown] = useState<MonthlyAssigneeBreakdown | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    // モバイルは13ヶ月分のX軸ラベルが重なるため隔月に間引く
    const isNarrow = useMediaQuery('(max-width: 639px)') === true;

    // 再フェッチ等で trend 長が変わったら当月へ寄せ直す
    useEffect(() => {
        setSelectedIndex(trend.length - 1);
    }, [trend.length]);

    const safeIndex = Math.min(Math.max(selectedIndex, 0), lastIndex);
    const selected = trend.length > 0 ? trend[safeIndex] : null;
    const selYear = selected?.year ?? 0;
    const selMonth = selected?.month ?? 0;

    // 期間指定の実効レンジ（終了が開始より前・無効なら開始月に丸め＝単月と同じ）
    const rs = parseYm(rangeStart);
    const re = parseYm(rangeEnd);
    const effEnd = rs && re && re.y * 12 + re.m >= rs.y * 12 + rs.m ? re : rs;

    const switchMode = (mode: BreakdownPeriod) => {
        setPeriodMode(mode);
        if (mode === 'range' && selected) {
            // 開始・終了とも選択月で初期化（終了だけ動かせば「◯月〜◯月」になる）
            const k = ymKey(selected.year, selected.month);
            setRangeStart(prev => parseYm(prev) ? prev : k);
            setRangeEnd(() => k);
        }
    };

    // ---- 内訳フェッチ（期間・軸の変更に 200ms デバウンス）----
    useEffect(() => {
        if (!selYear) return;
        if (periodMode === 'range' && !parseYm(rangeStart)) return;
        let cancelled = false;
        setIsLoading(true);
        const start = periodMode === 'range' ? parseYm(rangeStart)! : { y: selYear, m: selMonth };
        const end = periodMode === 'range'
            ? (() => { const e = parseYm(rangeEnd); return e && e.y * 12 + e.m >= start.y * 12 + start.m ? e : start; })()
            : start;
        const params = periodMode === 'range'
            ? `year=${start.y}&month=${start.m}&axis=${axis}&period=range&endYear=${end.y}&endMonth=${end.m}`
            : `year=${start.y}&month=${start.m}&axis=${axis}&period=${periodMode}`;
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/profit-dashboard/monthly-detail?${params}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('failed');
                const json = await res.json();
                if (!cancelled) setBreakdown(json);
            } catch (e) {
                if (!cancelled) {
                    logger.error('Failed to load breakdown:', e);
                    toast.error('集計データの取得に失敗しました');
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }, 200);
        return () => { cancelled = true; clearTimeout(t); };
    }, [selYear, selMonth, axis, periodMode, rangeStart, rangeEnd]);

    // すべての Hook は早期 return より前で呼ぶ（rules-of-hooks）。trend 空でも map は安全。
    const chartData = useMemo<ChartDatum[]>(() => trend.map((p, i) => {
        const key = ymKey(p.year, p.month);
        const highlighted = periodMode === 'year'
            ? p.year === selYear
            : periodMode === 'range'
                ? (rs != null && effEnd != null && key >= ymKey(rs.y, rs.m) && key <= ymKey(effEnd.y, effEnd.m))
                : i === safeIndex;
        return {
            index: i,
            label: p.month === 1 ? `${String(p.year).slice(2)}/1` : `${p.month}月`,
            fullLabel: `${p.year}年${p.month}月`,
            sales: p.sales,
            invoiceCount: p.invoiceCount,
            isSelected: highlighted,
            isCurrent: i === lastIndex,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [trend, safeIndex, lastIndex, periodMode, selYear, rangeStart, rangeEnd]);

    if (trend.length === 0 || !selected) return null;

    const isCurrent = safeIndex === lastIndex;
    const prev = safeIndex > 0 ? trend[safeIndex - 1] : null;
    const delta = selected.sales - (prev?.sales ?? 0);
    const percent = prev && prev.sales > 0
        ? Math.round((delta / prev.sales) * 1000) / 10
        : null;
    const up = delta > 0;
    const down = delta < 0;
    const trendColor = up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-slate-500';
    const TrendIcon = up ? TrendingUp : down ? TrendingDown : Minus;

    // ヘッドラインの税込売上: 単月は trend（fetchMonthlySales）、年間・期間指定は内訳 API の税込合計（同じ計上規則で同値）
    const totals = breakdown?.totals ?? null;
    const headlineSales = periodMode === 'month' ? selected.sales : totals?.salesTaxIncluded ?? null;
    const marginPercent = totals && totals.sales > 0
        ? Math.round((totals.grossProfit / totals.sales) * 1000) / 10
        : null;
    const periodHeading = periodMode === 'year'
        ? `${selected.year}年（年間）`
        : periodMode === 'range' && rs && effEnd
            ? `${rs.y}年${rs.m}月〜${effEnd.y}年${effEnd.m}月`
            : `${selected.year}年${selected.month}月`;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-0.5 sm:gap-2">
                <h2 className="text-sm font-semibold text-slate-700">月次の売上・利益（送付済み以降・請求日ベース）</h2>
                <span className="text-xs text-slate-400 sm:text-right">大きな売上は税込（月商）／下段の売上・原価・粗利は税抜</span>
            </div>

            {/* 期間コントロール: 当月/年間/期間指定 ＋ 単月ナビ or 月範囲入力 */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <Segmented
                    value={periodMode}
                    onChange={(v) => switchMode(v as BreakdownPeriod)}
                    options={[{ value: 'month', label: '当月' }, { value: 'year', label: '年間' }, { value: 'range', label: '期間指定' }]}
                />
                {periodMode !== 'range' ? (
                    <div className="flex items-center gap-1">
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
                            <span className="tabular-nums whitespace-nowrap">{periodHeading}</span>
                            {isCurrent && periodMode === 'month' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-600 text-white">今月</span>}
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
                ) : (
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                        <input
                            type="month"
                            value={rangeStart}
                            onChange={e => setRangeStart(e.target.value)}
                            aria-label="開始月"
                            className="px-2 py-1 text-sm border border-slate-200 rounded-lg bg-white tabular-nums"
                        />
                        <span className="text-slate-400">〜</span>
                        <input
                            type="month"
                            value={rangeEnd}
                            onChange={e => setRangeEnd(e.target.value)}
                            aria-label="終了月"
                            className="px-2 py-1 text-sm border border-slate-200 rounded-lg bg-white tabular-nums"
                        />
                        {rs && re && re.y * 12 + re.m < rs.y * 12 + rs.m && (
                            <span className="text-xs text-amber-600">終了月が開始月より前のため開始月のみで集計します</span>
                        )}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* ヘッドライン（税込売上） */}
                <div className="lg:col-span-1 flex flex-col justify-center min-w-0">
                    <div className="text-xs text-slate-400 mb-0.5">{periodHeading} の売上（税込）</div>
                    <div
                        className={`text-3xl font-bold text-slate-800 tabular-nums truncate ${isLoading && periodMode !== 'month' ? 'opacity-50' : ''}`}
                        title={headlineSales != null ? formatCurrency(headlineSales) : undefined}
                    >
                        {headlineSales != null ? formatCurrency(headlineSales) : '—'}
                    </div>
                    {periodMode === 'month' ? (
                        <>
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
                        </>
                    ) : (
                        <div className="mt-2 text-xs text-slate-400">
                            {periodMode === 'year' ? '暦年1〜12月の合算' : '指定した月範囲の合算'}（前月比は当月表示で確認）
                        </div>
                    )}
                </div>

                {/* 月次推移（バーをクリックでその月の単月表示へ） */}
                <div className="lg:col-span-2 min-w-0" style={{ cursor: 'pointer' }}>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart
                            data={chartData}
                            margin={{ top: 5, right: 8, left: 0, bottom: 0 }}
                            onClick={(state) => {
                                const i = (state as { activeTooltipIndex?: number } | null)?.activeTooltipIndex;
                                if (typeof i === 'number') { setSelectedIndex(i); setPeriodMode('month'); }
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

            {/* 期間の原価・粗利KPI（税抜・内訳の合計と一致） */}
            <div className={`mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 ${isLoading ? 'opacity-50' : ''}`}>
                <MiniStat label="売上（税抜）" value={totals ? formatCurrency(totals.sales) : '—'} />
                <MiniStat label="原価（繰越方式）" value={totals ? formatCurrency(totals.cost) : '—'} />
                <MiniStat
                    label="粗利"
                    value={totals ? formatCurrency(totals.grossProfit) : '—'}
                    tone={totals && totals.grossProfit < 0 ? 'negative' : 'default'}
                />
                <MiniStat
                    label="利益率"
                    value={marginPercent == null ? '—' : `${marginPercent}%`}
                    tone={marginPercent != null && marginPercent < 10 ? 'warn' : 'default'}
                />
            </div>

            {/* 内訳（担当者別/顧客別・絞り込み可）。データは上の fetch を共有 */}
            <MonthlyAssigneeTable data={breakdown} isLoading={isLoading} axis={axis} onAxisChange={setAxis} />
        </div>
    );
}

function MiniStat({ label, value, tone = 'default' }: {
    label: string;
    value: string;
    tone?: 'default' | 'negative' | 'warn';
}) {
    const valueColor = tone === 'negative' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-800';
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`text-base sm:text-lg font-semibold tabular-nums ${valueColor}`}>{value}</div>
        </div>
    );
}
