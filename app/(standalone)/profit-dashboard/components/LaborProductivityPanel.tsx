'use client';

/**
 * 利益ダッシュボード「一人当たりの稼ぎ」タブ（仕様3-4）。
 *
 * 区分別の表では **1件あたりの稼ぎと1件あたり人工を必ず併記する**。一人当たりの稼ぎだけを見ると
 * 「大規模も住宅も同じ」という誤った結論になるため（実測で1件あたりは約9倍の差）。
 *
 * 期間・担当者・顧客・工事内容の絞り込みはタブ上部のバーが持っていて、ここは受け取った条件で取りに行く
 * （kei 要望 2026-09-12）。稼ぎには原価が要るので、2026年4月までの過去データは対象にできない。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { LaborProductivityGroup, LaborProductivitySummary } from '@/lib/laborProductivity';
import { ValueAddedDot } from '@/components/ui/ValueAddedBadge';
import ThresholdBarChart, { type ThresholdBarDatum } from '@/components/charts/ThresholdBarChart';
import { formatYen } from '@/components/charts/chartTheme';
import { effectiveProfitFrom, isBackfillOnlyRange, spansBackfill, toQuery, type ProductivityFilter } from './productivityFilter';

type Axis = 'content' | 'customer' | 'assignee';

/** 区分別の横棒に出す件数（顧客別は数十件になるので、表の上から順に上位だけ） */
const CHART_TOP_N = 12;

const AXIS_LABELS: { key: Axis; label: string }[] = [
    { key: 'content', label: '工事内容別' },
    { key: 'customer', label: '顧客別' },
    { key: 'assignee', label: '担当者別' },
];

function yen(value: number): string {
    return value.toLocaleString('ja-JP');
}

function GroupTable({ rows, axisLabel }: { rows: LaborProductivityGroup[]; axisLabel: string }) {
    if (rows.length === 0) {
        return <p className="text-sm text-slate-400 py-6 text-center">対象の案件がありません</p>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="px-3 py-2 text-left font-medium">{axisLabel}</th>
                        <th className="px-3 py-2 text-right font-medium">案件数</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">稼ぎ（会社に残るお金）</th>
                        <th className="px-3 py-2 text-right font-medium">総人数</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">一人当たりの稼ぎ</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">1件あたりの稼ぎ</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">1件あたり人工</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map(row => (
                        <tr key={row.key} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700">{row.label}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.projectCount}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">{yen(row.valueAddedTotal)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.headcountTotal}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                                {row.perManday !== null ? yen(row.perManday) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">{yen(row.valueAddedPerProject)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.headcountPerProject}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function LaborProductivityPanel({ filter }: { filter: ProductivityFilter }) {
    const [summary, setSummary] = useState<LaborProductivitySummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [axis, setAxis] = useState<Axis>('content');
    const reqId = useRef(0);

    // 期間が丸ごと 2026-04 以前なら原価が無いので取りに行かない
    const backfillOnly = isBackfillOnlyRange(filter);
    const query = toQuery(filter);

    const load = useCallback(async (qs: string) => {
        const id = ++reqId.current;
        setLoading(true);
        try {
            const res = await fetch(`/api/profit-dashboard/labor-productivity?${qs}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`labor-productivity ${res.status}`);
            const json = await res.json() as { months: number; summary: LaborProductivitySummary };
            if (id !== reqId.current) return; // 後から投げた方が正（原価エンジンは重く、順番が前後する）
            setSummary(json.summary);
        } catch (e) {
            if (id !== reqId.current) return;
            logger.error('人工生産性の取得に失敗:', e);
            toast.error('一人当たりの稼ぎの集計に失敗しました');
        } finally {
            if (id === reqId.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (backfillOnly) { setSummary(null); setLoading(false); return; }
        void load(query);
    }, [load, query, backfillOnly]);

    if (backfillOnly) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
                <h2 className="text-base font-semibold text-slate-800">一人当たりの稼ぎ</h2>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                    選んでいる期間は 2026年4月まで（過去データ）です。過去データには案件ごとの原価が入っていないので、
                    稼ぎ（会社に残るお金）は出せません。上の「売上 ÷ 人工」で比べてください。
                    <br />
                    2026年5月からの期間を選ぶと、この下に一人当たりの稼ぎが出ます。
                </p>
            </div>
        );
    }

    if (loading && !summary) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-400">
                集計中...
            </div>
        );
    }
    if (!summary) return null;

    const rows =
        axis === 'content' ? summary.byContent
            : axis === 'customer' ? summary.byCustomer
                : summary.byAssignee;
    const axisLabel = AXIS_LABELS.find(a => a.key === axis)?.label ?? '';
    // 区分別の横棒（表と同じ並び＝稼ぎの多い順の上位だけ）。一人当たりの稼ぎが出ない区分は棒にしない
    const chartData: ThresholdBarDatum[] = rows
        .slice(0, CHART_TOP_N)
        .flatMap(row => row.perManday === null ? [] : [{
            key: row.key,
            label: row.label,
            value: row.perManday,
            details: [
                { key: 'valueAdded', label: '稼ぎ', value: formatYen(row.valueAddedTotal) },
                { key: 'headcount', label: '総人数', value: `${row.headcountTotal} 人工` },
                { key: 'projects', label: '案件数', value: `${row.projectCount} 件` },
            ],
        }]);
    const achievement = summary.threshold !== null && summary.threshold > 0 && summary.overall.perManday !== null
        ? Math.round((summary.overall.perManday / summary.threshold) * 100)
        : null;
    // 最低ラインを下回った案件は不足額の大きい順なので、先頭がいちばん大きい
    const maxShortfall = summary.shortfalls[0]?.shortfallTotal ?? 0;

    return (
        <div className="space-y-4">
            {/* 全体サマリー */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                    <div>
                        <h2 className="text-base font-semibold text-slate-800">一人当たりの稼ぎ</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {effectiveProfitFrom(filter.from)} 〜 {filter.to} に請求のあった案件 {summary.includedCount + summary.excludedCount}件のうち
                            <span className="font-medium text-slate-600"> {summary.includedCount}件</span>で集計
                        </p>
                    </div>
                    {loading && <span className="text-xs text-slate-400">集計中...</span>}
                </div>

                {spansBackfill(filter) && (
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                        稼ぎには案件ごとの原価が要るので、この表は 2026年5月以降に請求した案件だけで数えています
                        （それより前は過去データで原価がありません）。上の「売上 ÷ 人工」は期間全体です。
                    </p>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <div className="text-xs text-slate-500">一人当たりの稼ぎ</div>
                        <div className="text-2xl font-bold tabular-nums text-slate-800 mt-1">
                            {summary.overall.perManday !== null ? yen(summary.overall.perManday) : '—'}
                            <span className="text-sm font-normal text-slate-500 ml-1">円</span>
                        </div>
                        {achievement !== null && summary.threshold !== null && (
                            <>
                                <div className="text-xs text-slate-400 mt-1">
                                    最低ライン {yen(summary.threshold)}円 の {achievement}%
                                </div>
                                {/* 最低ラインに対する達成度のメーター（100%で満タン・届いていなければ赤） */}
                                <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                                    <div
                                        className={`h-full rounded-full ${achievement >= 100 ? 'bg-teal-600' : 'bg-red-500'}`}
                                        style={{ width: `${Math.min(100, Math.max(0, achievement))}%` }}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <div className="text-xs text-slate-500">稼ぎ 合計</div>
                        <div className="text-2xl font-bold tabular-nums text-slate-800 mt-1">
                            {yen(summary.overall.valueAddedTotal)}
                            <span className="text-sm font-normal text-slate-500 ml-1">円</span>
                        </div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <div className="text-xs text-slate-500">総人数 合計</div>
                        <div className="text-2xl font-bold tabular-nums text-slate-800 mt-1">
                            {summary.overall.headcountTotal}
                            <span className="text-sm font-normal text-slate-500 ml-1">人工</span>
                        </div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <div className="text-xs text-slate-500">1件あたり</div>
                        <div className="text-lg font-bold tabular-nums text-slate-800 mt-1">
                            {yen(summary.overall.valueAddedPerProject)}
                            <span className="text-xs font-normal text-slate-500 ml-1">円</span>
                        </div>
                        <div className="text-xs text-slate-500">{summary.overall.headcountPerProject} 人工 / 件</div>
                    </div>
                </div>

                {summary.excludedCount > 0 && (
                    <p className="text-xs text-slate-500 mt-3">
                        対象外 {summary.excludedCount}件（
                        {summary.excluded.map(e => `${e.label}${e.count}件`).join('・')}
                        ）は平均を歪めるため集計から除いています。
                    </p>
                )}
                {summary.threshold === null && (
                    <p className="text-xs text-amber-600 mt-2">
                        一人当たりの稼ぎの最低ラインが未設定です。設定＞一人当たりの稼ぎ で入力すると判定色と下位リストが出ます。
                    </p>
                )}
            </div>

            {/* 区分別 */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
                <div className="flex items-center gap-1 mb-3">
                    {AXIS_LABELS.map(a => (
                        <button
                            key={a.key}
                            onClick={() => setAxis(a.key)}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                axis === a.key
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                            }`}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
                {chartData.length > 0 && (
                    <div className="mb-4">
                        <h3 className="text-sm font-semibold text-slate-700">{axisLabel}の一人当たりの稼ぎ</h3>
                        <p className="text-xs text-slate-400 mt-0.5 mb-2">
                            {rows.length > CHART_TOP_N
                                ? `稼ぎの多い上位${CHART_TOP_N}件を、下の表と同じ並びで出しています。`
                                : '下の表と同じ並び（稼ぎの多い順）です。'}
                            {summary.threshold === null && ' 最低ラインを設定すると縦線が出ます。'}
                        </p>
                        <ThresholdBarChart
                            data={chartData}
                            threshold={summary.threshold}
                            valueLabel="一人当たりの稼ぎ"
                            formatValue={formatYen}
                            ariaLabel={`${axisLabel}の一人当たりの稼ぎの横棒グラフ`}
                        />
                    </div>
                )}
                <GroupTable rows={rows} axisLabel={axisLabel} />
            </div>

            {/* しきい値を下回った案件 */}
            {summary.shortfalls.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
                    <h3 className="text-sm font-semibold text-slate-800 mb-1">最低ラインを下回った案件</h3>
                    <p className="text-xs text-slate-500 mb-3">
                        不足額 =（最低ライン − 一人当たりの稼ぎ）× 総人数。大きい順に並べています。
                    </p>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-xs text-slate-500">
                                    <th className="px-3 py-2 text-left font-medium">現場名</th>
                                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">一人当たりの稼ぎ</th>
                                    <th className="px-3 py-2 text-right font-medium">総人数</th>
                                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">最低ラインまで</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {summary.shortfalls.slice(0, 20).map(row => (
                                    <tr key={row.projectMasterId} className="hover:bg-slate-50">
                                        <td className="px-3 py-2 text-slate-700">
                                            <span className="inline-flex items-center gap-1.5">
                                                <ValueAddedDot judgement={row.judgement} />
                                                {row.title}
                                                {row.outsourcingHeavy && (
                                                    <span className="text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                                                        外注中心
                                                    </span>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{yen(row.perManday)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.headcount}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">
                                            <span className="inline-flex items-center justify-end gap-2">
                                                {/* 不足額の大きさを棒でも見せる（いちばん大きい案件を満タンに） */}
                                                <span className="hidden sm:inline-block w-20 h-1.5 rounded-full bg-red-50 overflow-hidden" aria-hidden="true">
                                                    <span
                                                        className="block h-full rounded-full bg-red-400"
                                                        style={{ width: `${maxShortfall > 0 ? Math.max(2, (row.shortfallTotal / maxShortfall) * 100) : 0}%` }}
                                                    />
                                                </span>
                                                −{yen(row.shortfallTotal)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {summary.shortfalls.length > 20 && (
                        <p className="text-xs text-slate-400 mt-2">上位20件を表示（全{summary.shortfalls.length}件）</p>
                    )}
                </div>
            )}
        </div>
    );
}
