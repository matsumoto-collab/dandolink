'use client';

/**
 * 「一人当たりの稼ぎ」タブの 期別・月別「売上 ÷ 人工」（過去データ取込 仕様 3-4）。
 * 2026-04 までは過去データ（段取日報・請求書PDF・売上入金表）、2026-05 からは DandoLink のデータで数える。
 * 過去データには原価が無いので、第11期〜第13期を同じ物差しで比べるために「稼ぎ」ではなく「売上」で割る。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { SalesPerManDayGroup, SalesPerManDaySummary } from '@/lib/salesPerManDay';

const yen = (n: number) => n.toLocaleString('ja-JP');
const GROUP_PREVIEW = 20;

function GroupTable({ title, rows }: { title: string; rows: SalesPerManDayGroup[] }) {
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
                                <th className="px-2 py-1.5 text-left font-medium">名前</th>
                                <th className="px-2 py-1.5 text-right font-medium">売上（税抜）</th>
                                <th className="px-2 py-1.5 text-right font-medium">延べ人工</th>
                                <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">売上 ÷ 人工</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 tabular-nums">
                            {visible.map((r) => (
                                <tr key={r.key} className="hover:bg-slate-50">
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

export default function SalesPerManDaySection() {
    const [data, setData] = useState<SalesPerManDaySummary | null>(null);
    const [loading, setLoading] = useState(true);
    // 顧客別・工事内容別を見る期（null = 表示している全期間）
    const [groupTerm, setGroupTerm] = useState<number | null>(null);

    const load = useCallback(async (term: number | null, termRange?: { from: string; to: string }) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ from: '2024-01' });
            if (term !== null && termRange) {
                params.set('groupFrom', termRange.from);
                params.set('groupTo', termRange.to);
            }
            const res = await fetch(`/api/profit-dashboard/sales-per-manday?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`sales-per-manday ${res.status}`);
            setData(await res.json());
        } catch (e) {
            logger.error('売上÷人工の取得に失敗:', e);
            toast.error('売上 ÷ 人工の集計に失敗しました');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load(null);
    }, [load]);

    const terms = useMemo(() => data?.terms ?? [], [data]);

    // 月別の表は古い→新しいの順。開いたときは一番下（最新の月）が見えるようにする
    const scrollToBottom = useCallback((el: HTMLDivElement | null) => {
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    const selectTerm = (term: number | null) => {
        setGroupTerm(term);
        const t = terms.find((x) => x.term === term);
        void load(term, t ? { from: t.from, to: t.to } : undefined);
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-5">
            <div>
                <h2 className="text-base font-semibold text-slate-800">売上 ÷ 人工（期別・月別）</h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    2026年4月までは過去データ（段取日報・請求書PDF・売上入金表）、2026年5月からは DandoLink のデータで数えています。
                    過去データには案件別の原価が無いので、期をまたいで同じ物差しで比べられるよう「稼ぎ」ではなく「売上」を人工で割っています。
                    期別・月別は会社全体の数字で、土場・研修など現場ではない作業の人工も含みます。
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
                                {terms.map((t) => (
                                    <tr key={t.term} className="hover:bg-slate-50">
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

                    {/* 月別 */}
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-1.5">月別</h3>
                        <div ref={scrollToBottom} className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="text-xs text-slate-500">
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-left font-medium">年月</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-left font-medium">期</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium">売上（税抜）</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium">延べ人工</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium whitespace-nowrap">売上 ÷ 人工</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-right font-medium whitespace-nowrap">3か月移動平均</th>
                                        <th className="sticky top-0 bg-slate-50 px-2 py-2 text-left font-medium">数え方</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 tabular-nums bg-white">
                                    {data.months.map((m) => (
                                        <tr key={m.yearMonth} className="hover:bg-teal-50">
                                            <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{m.yearMonth}</td>
                                            <td className="px-2 py-1.5 text-xs text-slate-500">第{m.term}期</td>
                                            <td className="px-2 py-1.5 text-right text-slate-700">{yen(m.sales)}</td>
                                            <td className="px-2 py-1.5 text-right text-slate-600">{yen(m.manDays)}</td>
                                            <td className="px-2 py-1.5 text-right font-medium text-slate-800">
                                                {m.salesPerManDay === null ? '—' : yen(m.salesPerManDay)}
                                            </td>
                                            <td className="px-2 py-1.5 text-right text-slate-600">
                                                {m.movingAvg3 === null ? '—' : yen(m.movingAvg3)}
                                            </td>
                                            <td className="px-2 py-1.5 text-xs text-slate-400 whitespace-nowrap">
                                                {m.source === 'backfill' ? '過去データ' : 'DandoLink'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                            3か月移動平均 ＝ その月までの 3 か月の売上の合計 ÷ 3 か月の延べ人工の合計。
                        </p>
                    </div>

                    {/* 顧客別・工事内容別 */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-slate-700 mr-1">顧客別・工事内容別</span>
                            <button
                                type="button"
                                onClick={() => selectTerm(null)}
                                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                                    groupTerm === null ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                                }`}
                            >
                                全期間
                            </button>
                            {terms.map((t) => (
                                <button
                                    key={t.term}
                                    type="button"
                                    onClick={() => selectTerm(t.term)}
                                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                                        groupTerm === t.term ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                        </div>
                        <div className="grid gap-5 lg:grid-cols-2">
                            <GroupTable title="顧客別" rows={data.byCustomer} />
                            <GroupTable title="工事内容別" rows={data.byContent} />
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                            顧客別・工事内容別は、土場・研修など現場ではない作業を外しています。
                            過去データの案件には工事内容が無いので、工事内容別では「工事内容なし」にまとまります。
                            売上調整（請求書を出さずに元請の支払明細で処理された分など）は顧客別にだけ入ります。
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}
