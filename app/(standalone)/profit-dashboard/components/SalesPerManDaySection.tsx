'use client';

/**
 * 「一人当たりの稼ぎ」タブの 期別・月別・日別「売上 ÷ 人工」（過去データ取込 仕様 3-4）。
 * 2026-04 までは過去データ（段取日報・請求書PDF・売上入金表）、2026-05 からは DandoLink のデータで数える。
 * 過去データには原価が無いので、第11期〜第13期を同じ物差しで比べるために「稼ぎ」ではなく「売上」で割る。
 *
 * 期間や担当者などの絞り込みはタブ上部のバーが持っていて、ここは受け取った集計を表示するだけ（kei 要望 2026-09-12）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { SalesPerManDayGroup, SalesPerManDaySummary } from '@/lib/salesPerManDay';
import type { ProductivityFilter } from './productivityFilter';

const yen = (n: number) => n.toLocaleString('ja-JP');
const GROUP_PREVIEW = 20;

function GroupTable({ title, nameLabel, rows }: { title: string; nameLabel: string; rows: SalesPerManDayGroup[] }) {
    const [showAll, setShowAll] = useState(false);
    const visible = showAll ? rows : rows.slice(0, GROUP_PREVIEW);
    return (
        <div>
            <h4 className="text-xs font-semibold text-slate-600 mb-1.5">{title}</h4>
            {rows.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">データがありません</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-xs text-slate-500">
                                <th className="px-2 py-1.5 text-left font-medium">{nameLabel}</th>
                                <th className="px-2 py-1.5 text-right font-medium">売上（税抜）</th>
                                <th className="px-2 py-1.5 text-right font-medium">延べ人工</th>
                                <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">売上 ÷ 人工</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 tabular-nums">
                            {visible.map((r) => (
                                <tr key={r.key} className="hover:bg-teal-100">
                                    <td className="px-2 py-1.5 text-slate-700">{r.name}</td>
                                    <td className="px-2 py-1.5 text-right text-slate-700">{yen(r.sales)}</td>
                                    <td className="px-2 py-1.5 text-right text-slate-600">{yen(r.manDays)}</td>
                                    <td className="px-2 py-1.5 text-right font-semibold text-slate-800">
                                        {r.salesPerManDay === null ? '—' : yen(r.salesPerManDay)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {rows.length > GROUP_PREVIEW && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs text-teal-700 hover:underline">
                    {showAll ? '上位だけ表示' : `すべて表示（${rows.length}件）`}
                </button>
            )}
        </div>
    );
}

interface Props {
    data: SalesPerManDaySummary | null;
    loading: boolean;
    filter: ProductivityFilter;
}

export default function SalesPerManDaySection({ data, loading, filter }: Props) {
    const isDaily = data?.granularity === 'day';
    const scrollRef = useRef<HTMLDivElement | null>(null);

    // 表は古い→新しいの順。取り直すたびに一番下（最新）が見えるようにする
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [data]);

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-5">
            <div>
                <h2 className="text-base font-semibold text-slate-800">売上 ÷ 人工（期別・{isDaily ? '日別' : '月別'}）</h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    2026年4月までは過去データ（段取日報・請求書PDF・売上入金表）、2026年5月からは DandoLink のデータで数えています。
                    過去データには案件別の原価が無いので、期をまたいで同じ物差しで比べられるよう「稼ぎ」ではなく「売上」を人工で割っています。
                    期別・{isDaily ? '日別' : '月別'}は会社全体の数字で、土場・研修など現場ではない作業の人工も含みます。
                </p>
            </div>

            {loading && !data ? (
                <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                </div>
            ) : !data ? null : (
                <>
                    {/* 期別 */}
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-xs text-slate-500">
                                    <th className="px-2 py-2 text-left font-medium">期</th>
                                    <th className="px-2 py-2 text-left font-medium">期間</th>
                                    <th className="px-2 py-2 text-right font-medium">売上（税抜）</th>
                                    <th className="px-2 py-2 text-right font-medium">延べ人工</th>
                                    <th className="px-2 py-2 text-right font-medium whitespace-nowrap">売上 ÷ 人工</th>
                                    <th className="px-2 py-2 text-right font-medium">月数</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 tabular-nums">
                                {data.terms.map((t) => (
                                    <tr key={t.term} className="hover:bg-teal-100">
                                        <td className="px-2 py-2 font-medium text-slate-700">{t.label}</td>
                                        <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">{t.from} 〜 {t.to}</td>
                                        <td className="px-2 py-2 text-right text-slate-700">{yen(t.sales)}</td>
                                        <td className="px-2 py-2 text-right text-slate-600">{yen(t.manDays)}</td>
                                        <td className="px-2 py-2 text-right font-semibold text-slate-800">
                                            {t.salesPerManDay === null ? '—' : `${yen(t.salesPerManDay)} 円`}
                                        </td>
                                        <td className="px-2 py-2 text-right text-xs text-slate-500">
                                            {t.monthsCovered < 12 ? `${t.monthsCovered}か月（途中）` : '12か月'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="-mt-3 text-xs text-slate-400">
                        期別は選んでいる期間（{data.from} 〜 {data.to}）に入っている月だけで合計しています。
                    </p>

                    {/* 月別 or 日別 */}
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-1.5">{isDaily ? '日別' : '月別'}</h3>
                        <div ref={scrollRef} className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="text-xs text-slate-500">
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-left font-medium">{isDaily ? '日付' : '年月'}</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-left font-medium">期</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium">延べ人工</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium">売上（税抜）</th>
                                        {!isDaily && (
                                            <>
                                                <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium whitespace-nowrap">売上 ÷ 人工</th>
                                                <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium whitespace-nowrap">3か月移動平均</th>
                                            </>
                                        )}
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-left font-medium">数え方</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 tabular-nums bg-white">
                                    {data.buckets.map((b) => (
                                        <tr key={b.key} className="hover:bg-teal-100">
                                            <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{b.key}</td>
                                            <td className="px-2 py-1.5 text-xs text-slate-500">第{b.term}期</td>
                                            <td className="px-2 py-1.5 text-right text-slate-600">{yen(b.manDays)}</td>
                                            <td className="px-2 py-1.5 text-right text-slate-700">{yen(b.sales)}</td>
                                            {!isDaily && (
                                                <>
                                                    <td className="px-2 py-1.5 text-right font-medium text-slate-800">
                                                        {b.salesPerManDay === null ? '—' : yen(b.salesPerManDay)}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right text-slate-600">
                                                        {b.movingAvg3 === null ? '—' : yen(b.movingAvg3)}
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-2 py-1.5 text-xs text-slate-400 whitespace-nowrap">
                                                {b.source === 'backfill' ? '過去データ' : 'DandoLink'}
                                            </td>
                                        </tr>
                                    ))}
                                    {data.buckets.length === 0 && (
                                        <tr>
                                            <td colSpan={isDaily ? 5 : 7} className="px-2 py-6 text-center text-xs text-slate-400">
                                                この期間・条件に当てはまる数字がありません
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                            {isDaily ? (
                                <>
                                    日別はその日の延べ人工と、その日に請求した売上を並べています。
                                    足場は「組立の日」と「請求する日」が離れるので、日ごとに売上 ÷ 人工は出していません。
                                    {data.adjustmentExcludedFromDaily > 0 && (
                                        <>
                                            {' '}この期間の売上調整 {yen(data.adjustmentExcludedFromDaily)} 円は日付が分からないため、日別には入っていません（月別・期別には入ります）。
                                        </>
                                    )}
                                </>
                            ) : (
                                <>3か月移動平均 ＝ その月までの 3 か月の売上の合計 ÷ 3 か月の延べ人工の合計。</>
                            )}
                        </p>
                    </div>

                    {/* 顧客別・工事内容別・担当者別 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-slate-700">顧客別・工事内容別・担当者別</h3>
                        <div className="grid gap-5 lg:grid-cols-2">
                            <GroupTable title="顧客別" nameLabel="顧客" rows={data.byCustomer} />
                            <GroupTable title="工事内容別" nameLabel="工事内容" rows={data.byContent} />
                            <GroupTable title="担当者別" nameLabel="担当者" rows={data.byAssignee} />
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                            この 3 つの表は、選んでいる期間（{data.from} 〜 {data.to}）の分だけを集計し、土場・研修など現場ではない作業を外しています。
                            過去データの案件には工事内容と担当者が無いので、それぞれ「なし」にまとまります。
                            売上調整（請求書を出さずに元請の支払明細で処理された分など）は顧客別にだけ入ります。
                            {filter.granularity === 'day' && ' 日別を選んでいても、この 3 つの表は期間全体の合計です。'}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}
