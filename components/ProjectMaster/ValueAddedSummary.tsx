'use client';

/**
 * 案件詳細の利益サマリーに出す「人工あたり加工高」ブロック（仕様3-2）。
 *
 * 画面の文言は社内で通じる言葉に合わせている（kei 指定 2026-09-11）。
 *   人工あたり加工高 → 一人当たりの稼ぎ / 加工高 → 稼ぎ（会社に残るお金）/ しきい値 → 最低ライン
 *   労働生産性倍率 → 人件費1円あたりの稼ぎ / 労務の外注比率 → 外注に出した割合
 * 識別子（perManday / productivityRatio / laborOutsourcingRatio など）は据え置き。
 *
 * 並びも kei が示したブロックに合わせる: 上に一人当たりの稼ぎと判定、下に内訳 4 行。
 * 外注中心の案件は判定を人件費1円あたりの稼ぎで付ける（lib/valueAdded の judgedBy）ので、
 * そのときは判定バッジと最低ラインをその行のほうに出す。
 */
import React from 'react';
import {
    VALUE_ADDED_FLAG_LABELS,
    valueAddedUnavailableReason,
    type ValueAddedResult,
} from '@/lib/valueAdded';
import { ValueAddedFlagBadge, ValueAddedJudgementBadge } from '@/components/ui/ValueAddedBadge';
import InfoTip from '@/components/ui/InfoTip';

function yen(value: number): string {
    return value.toLocaleString('ja-JP');
}

/** 各語の説明（(i) アイコンに出す）。文言は kei 指定のもの */
const TIPS = {
    perManday: (
        <>
            売上から、材料屋・協力業者・レンタル会社などに支払う分を引いた残りを、
            その現場に行った延べ人数で割った金額です。1人が1日行って、いくら会社に持ち帰ったかを表します。
            職人の給料と会社の経費は、ここから払います。
        </>
    ),
    valueAdded: (
        <>
            売上 − 人件費以外の原価（車両費・材料費・外注費・積込費・その他）。
            人件費を引かないのは、職人が月給制で、現場に行っても行かなくても給料が出るためです。
            人件費は現場の費用ではなく会社全体の固定費として扱い、この「稼ぎ」の中から支払います。
        </>
    ),
    threshold: (
        <>
            第11期決算から算出した損益分岐の金額です。年間に必要な額
            （労務費 + 販管費 + 案件に載っていない工事経費）を年間の延べ人工で割ったもの。
            これを下回った現場は、自分の分の経費を賄えていません。
        </>
    ),
    productivity: (
        <>
            稼ぎ ÷ 自社人件費。自社の人件費1円につき何円を稼いだかを表します。
            1人が1日に複数現場を回った日は、人工が現場ごとに立つのに対して日額は按分されるため、
            短時間の立ち寄りが多い現場では「一人当たりの稼ぎ」より、こちらのほうが実態に近くなります。
        </>
    ),
    outsourcing: (
        <>
            外注費 ÷（外注費 + 自社人件費）。その現場の作業を、自社と外注のどちらがやったかを表します。
            50%を超えた現場は自社がほとんど行っていないので、「一人当たりの稼ぎ」が高く出ても
            効率が良いとは限りません。
        </>
    ),
};

export default function ValueAddedSummary({ data }: { data: ValueAddedResult }) {
    const unavailable = valueAddedUnavailableReason(data);
    // 判定色は「外注中心」の案件だけ人件費1円あたりの稼ぎ（productivityRatio）のほうに付ける
    const badgeOnPerManday = data.judgedBy === 'perManday';
    const badgeOnProductivity = data.judgedBy === 'productivity';
    const numberTone = data.tentative ? 'text-slate-400' : 'text-slate-800';
    const hasThreshold = data.threshold !== null && data.achievementRate !== null;

    return (
        <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center flex-wrap gap-2 mb-3">
                <h4 className="flex items-center gap-1 text-sm font-semibold text-slate-700">
                    一人当たりの稼ぎ
                    <InfoTip title="一人当たりの稼ぎ">{TIPS.perManday}</InfoTip>
                </h4>
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
                    {/* 一人当たりの稼ぎ（円 / 人工）と判定 */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <div className="flex items-baseline flex-wrap gap-2">
                            <span className={`text-2xl font-bold tabular-nums ${numberTone}`}>
                                {data.perManday !== null ? yen(data.perManday) : '—'}
                            </span>
                            <span className="text-sm text-slate-500">円 / 人工</span>
                            {badgeOnPerManday && <ValueAddedJudgementBadge judgement={data.judgement} />}
                        </div>
                        <p className="flex items-center gap-1 text-xs text-slate-500 mt-1.5">
                            {badgeOnPerManday && hasThreshold ? (
                                <>
                                    最低ライン {yen(Math.round(data.threshold!))}円 の {data.achievementRate}%
                                    <InfoTip title="最低ライン">{TIPS.threshold}</InfoTip>
                                </>
                            ) : (
                                '稼ぎ ÷ 総人数'
                            )}
                        </p>
                    </div>

                    <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3">
                            <dt className="flex items-center gap-1 text-slate-600 whitespace-nowrap">
                                稼ぎ（会社に残るお金）
                                <InfoTip title="稼ぎ（会社に残るお金）">{TIPS.valueAdded}</InfoTip>
                            </dt>
                            <dd className="text-right">
                                <span className="font-medium tabular-nums text-slate-800">{yen(data.valueAdded)} 円</span>
                                <span className="block text-xs text-slate-400">
                                    （売上 {yen(data.sales)} − 人件費以外 {yen(data.nonLaborCost)}）
                                </span>
                            </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-slate-600">延べ人工</dt>
                            <dd className="text-right">
                                <span className="font-medium tabular-nums text-slate-800">{data.headcount} 人工</span>
                                <span className="text-xs text-slate-400 ml-2">（総人数）</span>
                            </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="flex items-center gap-1 text-slate-600 whitespace-nowrap">
                                人件費1円あたりの稼ぎ
                                <InfoTip title="人件費1円あたりの稼ぎ">{TIPS.productivity}</InfoTip>
                            </dt>
                            <dd className="text-right">
                                <span className="inline-flex items-center justify-end flex-wrap gap-2">
                                    <span className="font-medium tabular-nums text-slate-800">
                                        {data.productivityRatio !== null ? data.productivityRatio.toFixed(2) : '—'} 倍
                                    </span>
                                    {badgeOnProductivity && (
                                        <ValueAddedJudgementBadge judgement={data.judgement} size="sm" />
                                    )}
                                </span>
                                <span className="text-xs text-slate-400 ml-2">
                                    （稼ぎ ÷ 自社人件費 {yen(data.laborCost)}）
                                </span>
                                {badgeOnProductivity && hasThreshold && (
                                    <span className="flex items-center justify-end gap-1 text-xs text-slate-500 mt-0.5">
                                        最低ライン {data.threshold!.toFixed(2)}倍 の {data.achievementRate}%
                                        <InfoTip title="最低ライン">{TIPS.threshold}</InfoTip>
                                    </span>
                                )}
                            </dd>
                        </div>
                        {data.laborOutsourcingRatio !== null && (
                            <div className="flex justify-between gap-3">
                                <dt className="flex items-center gap-1 text-slate-600 whitespace-nowrap">
                                    外注に出した割合
                                    <InfoTip title="外注に出した割合">{TIPS.outsourcing}</InfoTip>
                                </dt>
                                <dd className="text-right">
                                    <span className="font-medium tabular-nums text-slate-800">
                                        {(data.laborOutsourcingRatio * 100).toFixed(1)} %
                                    </span>
                                    <span className="text-xs text-slate-400 ml-2">
                                        （外注費 {yen(data.subcontractorCost)} ÷ 労務計 {yen(data.subcontractorCost + data.laborCost)}）
                                    </span>
                                </dd>
                            </div>
                        )}
                    </dl>

                    {data.tentative && (
                        <p className="mt-2 text-xs text-slate-400">
                            請求額が見積を大きく下回るため、数値は参考値です。
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
