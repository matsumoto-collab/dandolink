'use client';

/**
 * 「手当」の集計の表（行＝人）。docs/指示書_大規模手当.md の 7-3 の 6。
 *
 *  - 列: 氏名／区分（社員・一人親方）／職長（日・円）／職長以外（日・円）／合計（日・円）／確認待ち（件）
 *  - いちばん下に合計の行。表の下に、社員の合計と一人親方の合計（totalsByKind）
 *  - 横スクロール・氏名の列を左に固定（「評価ポイント」の表と同じ作り）
 *  - 行を押すと、その人の明細（onSelectPerson）
 */
import React from 'react';
import { kindLabelOf, yen, type SummaryData, type SummaryPerson, type SummaryTotals } from './allowancesClient';

interface Props {
    data: SummaryData;
    onSelectPerson: (person: SummaryPerson) => void;
}

const daysText = (days: number) => (days > 0 ? `${days}日` : '−');
const amountText = (amount: number) => (amount > 0 ? yen(amount) : '−');

const numCell = 'px-3 py-2.5 text-right tabular-nums whitespace-nowrap';
const headCell = 'bg-slate-100 border-b border-slate-200 px-3 py-3 text-right whitespace-nowrap';

function KindBadge({ isJoyo }: { isJoyo: boolean }) {
    return (
        <span
            className={`inline-block px-2 py-0.5 rounded-md text-xs whitespace-nowrap ${
                isJoyo ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-slate-100 text-slate-600'
            }`}
        >
            {kindLabelOf(isJoyo)}
        </span>
    );
}

/** 職長（日・円）／職長以外（日・円）／合計（日・円）／確認待ち（件）のセル */
function TotalsCells({ t, strong }: { t: SummaryTotals; strong?: boolean }) {
    const tone = (n: number) => (n > 0 ? 'text-slate-800' : 'text-slate-300');
    return (
        <>
            <td className={`${numCell} border-l border-slate-200 ${tone(t.foremanDays)}`}>{daysText(t.foremanDays)}</td>
            <td className={`${numCell} ${tone(t.foremanAmount)}`}>{amountText(t.foremanAmount)}</td>
            <td className={`${numCell} border-l border-slate-200 ${tone(t.memberDays)}`}>{daysText(t.memberDays)}</td>
            <td className={`${numCell} ${tone(t.memberAmount)}`}>{amountText(t.memberAmount)}</td>
            <td className={`${numCell} border-l border-slate-200 ${tone(t.totalDays)}`}>{daysText(t.totalDays)}</td>
            <td className={`${numCell} ${strong || t.totalAmount > 0 ? 'font-semibold text-slate-900' : 'text-slate-300'}`}>
                {amountText(t.totalAmount)}
            </td>
            <td
                className={`${numCell} border-l border-slate-200 ${t.pendingCount > 0 ? 'text-amber-700' : 'text-slate-300'}`}
                title={t.pendingCount > 0 ? `${yen(t.pendingAmount)}（まだ合計に入っていません）` : undefined}
            >
                {t.pendingCount > 0 ? `${t.pendingCount}件` : '−'}
            </td>
        </>
    );
}

export default function AllowancesSummaryTable({ data, onSelectPerson }: Props) {
    const { people, totals, totalsByKind } = data;

    return (
        <div className="flex flex-col gap-2">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="text-xs font-bold text-slate-700">
                                <th className="sticky left-0 z-20 bg-slate-100 border-b border-r border-slate-200 px-3 py-3 text-left whitespace-nowrap min-w-[112px]">
                                    氏名
                                </th>
                                <th className="bg-slate-100 border-b border-slate-200 px-3 py-3 text-left whitespace-nowrap">区分</th>
                                <th className={`${headCell} border-l`}>職長（日）</th>
                                <th className={headCell}>職長（円）</th>
                                <th className={`${headCell} border-l`}>職長以外（日）</th>
                                <th className={headCell}>職長以外（円）</th>
                                <th className={`${headCell} border-l`}>合計（日）</th>
                                <th className={headCell}>合計（円）</th>
                                <th className={`${headCell} border-l`}>確認待ち（件）</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {people.map((p) => (
                                <tr
                                    key={p.userId}
                                    className="group cursor-pointer hover:bg-teal-100 transition-colors"
                                    onClick={() => onSelectPerson(p)}
                                    title={`${p.displayName}さんの明細を開く`}
                                >
                                    <td className="sticky left-0 z-10 bg-white group-hover:bg-teal-100 border-r border-slate-200 px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap transition-colors">
                                        {p.displayName}
                                    </td>
                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                        <KindBadge isJoyo={p.isJoyo} />
                                    </td>
                                    <TotalsCells t={p} />
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-slate-50 font-semibold text-slate-900 border-t border-slate-200">
                                <td className="sticky left-0 z-10 bg-slate-50 border-t border-r border-slate-200 px-3 py-2.5 whitespace-nowrap">合計</td>
                                <td className="border-t border-slate-200 px-3 py-2.5"></td>
                                <TotalsCells t={totals} strong />
                            </tr>
                        </tfoot>
                    </table>
                </div>
                {people.length > 0 && (
                    <div className="md:hidden px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">
                        ← 横にスクロールできます（氏名は固定）
                    </div>
                )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 bg-white rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-700">
                    社員の合計 <span className="font-semibold text-slate-900 tabular-nums">{yen(totalsByKind.employee.totalAmount)}</span>
                    <span className="text-xs text-slate-500">（給与に付ける分）</span>
                </div>
                <div className="flex-1 bg-white rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-700">
                    一人親方の合計 <span className="font-semibold text-slate-900 tabular-nums">{yen(totalsByKind.joyo.totalAmount)}</span>
                    <span className="text-xs text-slate-500">（支払明細書に、手で1行足す分）</span>
                </div>
            </div>
            <p className="text-xs text-slate-400">区分（社員・一人親方）は、今の登録で出しています。</p>
        </div>
    );
}
