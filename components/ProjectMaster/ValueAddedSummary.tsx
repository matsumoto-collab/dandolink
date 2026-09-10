'use client';

/**
 * 案件詳細の利益サマリーに出す「人工あたり加工高」ブロック（仕様3-2）。
 *
 * 人工単価と労働生産性倍率を同じ大きさで並べる（kei指定 v0.3）。
 * 人件費は日額をその日の全現場の作業時間で按分しているため、短時間の立ち寄りが多い案件は
 * 人工単価が低めに出る。按分後の実額を分母にする労働生産性倍率のほうが実態に近い。
 */
import React from 'react';
import {
    VALUE_ADDED_FLAG_LABELS,
    valueAddedUnavailableReason,
    type ValueAddedResult,
} from '@/lib/valueAdded';
import { ValueAddedFlagBadge, ValueAddedJudgementBadge } from '@/components/ui/ValueAddedBadge';

function yen(value: number): string {
    return value.toLocaleString('ja-JP');
}

export default function ValueAddedSummary({ data }: { data: ValueAddedResult }) {
    const unavailable = valueAddedUnavailableReason(data);
    // 判定色は「外注中心」の案件だけ労働生産性倍率のほうに付ける
    const badgeOnPerManday = data.judgedBy === 'perManday';
    const badgeOnProductivity = data.judgedBy === 'productivity';
    const numberTone = data.tentative ? 'text-slate-400' : 'text-slate-800';

    return (
        <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center flex-wrap gap-2 mb-3">
                <h4 className="text-sm font-semibold text-slate-700">人工あたり加工高</h4>
                {data.flags
                    .filter(f => f === 'outsourcing_heavy' || f === 'billing_short' || f === 'manual_override')
                    .map(f => (
                        <ValueAddedFlagBadge
                            key={f}
                            label={VALUE_ADDED_FLAG_LABELS[f]}
                            tone={f === 'billing_short' ? 'warn' : 'neutral'}
                        />
                    ))}
            </div>

            {unavailable ? (
                <p className="text-sm text-slate-500">{unavailable}</p>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* 人工あたり加工高 */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                            <div className="flex items-baseline flex-wrap gap-2">
                                <span className={`text-2xl font-bold tabular-nums ${numberTone}`}>
                                    {data.perManday !== null ? yen(data.perManday) : '—'}
                                </span>
                                <span className="text-sm text-slate-500">円 / 人工</span>
                                {badgeOnPerManday && <ValueAddedJudgementBadge judgement={data.judgement} />}
                            </div>
                            <p className="text-xs text-slate-500 mt-1.5">
                                {badgeOnPerManday && data.threshold !== null && data.achievementRate !== null
                                    ? `しきい値 ${yen(Math.round(data.threshold))}円 の ${data.achievementRate}%`
                                    : '加工高 ÷ 総人数'}
                            </p>
                        </div>

                        {/* 労働生産性倍率（人件費の按分の影響を受けない指標） */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                            <div className="flex items-baseline flex-wrap gap-2">
                                <span className={`text-2xl font-bold tabular-nums ${numberTone}`}>
                                    {data.productivityRatio !== null ? data.productivityRatio.toFixed(2) : '—'}
                                </span>
                                <span className="text-sm text-slate-500">倍</span>
                                {badgeOnProductivity && <ValueAddedJudgementBadge judgement={data.judgement} />}
                            </div>
                            <p className="text-xs text-slate-500 mt-1.5">
                                労働生産性倍率（加工高 ÷ 自社人件費 {yen(data.laborCost)}）
                                {badgeOnProductivity && data.threshold !== null && data.achievementRate !== null
                                    ? ` ／ しきい値 ${data.threshold.toFixed(2)}倍 の ${data.achievementRate}%`
                                    : ''}
                            </p>
                        </div>
                    </div>

                    <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-600">加工高</dt>
                            <dd className="text-right">
                                <span className="font-medium tabular-nums text-slate-800">{yen(data.valueAdded)} 円</span>
                                <span className="text-xs text-slate-400 ml-2">
                                    （売上 {yen(data.sales)} − 人件費以外 {yen(data.nonLaborCost)}）
                                </span>
                            </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-600">総人数</dt>
                            <dd className="font-medium tabular-nums text-slate-800">{data.headcount} 人</dd>
                        </div>
                        {data.laborOutsourcingRatio !== null && (
                            <div className="flex justify-between gap-3">
                                <dt className="text-slate-600">労務の外注比率</dt>
                                <dd className="text-right">
                                    <span className="font-medium tabular-nums text-slate-800">
                                        {Math.round(data.laborOutsourcingRatio * 100)} %
                                    </span>
                                    <span className="text-xs text-slate-400 ml-2">
                                        （外注 {yen(data.subcontractorCost)} ÷ 労務計 {yen(data.subcontractorCost + data.laborCost)}）
                                    </span>
                                </dd>
                            </div>
                        )}
                    </dl>

                    <p className="mt-2 text-xs text-slate-400">
                        人件費は引きません（月給制のため案件費用ではなく固定費として扱います）。
                        {data.tentative && ' 請求額が見積を大きく下回るため、数値は参考値です。'}
                    </p>
                </>
            )}
        </div>
    );
}
