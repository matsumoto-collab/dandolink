'use client';

/**
 * 「評価ポイント」の集計の表（行＝人、列＝項目）。docs/指示書_評価ポイント.md の 7-3 の 4。
 *
 *  - セルは「◯回」（0 は「−」）。title に「◯点」（その人・その項目の点数の合計）
 *  - 項目の列の見出しは今の項目名。点数は出さない（期間の途中で点数が変わることがあるため）
 *  - 使っていない項目の列は、見出しを薄くして「（使わない）」を添える
 *  - 横スクロール・氏名の列を左に固定（「出勤簿一覧」の表と同じ作り）
 *  - 行を押すと、その人の明細（onSelectPerson）
 */
import React from 'react';
import type { SummaryCell, SummaryData, SummaryPerson } from './evaluationPointsClient';

interface Props {
    data: SummaryData;
    onSelectPerson: (person: SummaryPerson) => void;
}

const countText = (count: number) => (count > 0 ? `${count}回` : '−');

function Cell({ cell }: { cell: SummaryCell | undefined }) {
    const count = cell?.count ?? 0;
    return (
        <td
            className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${count > 0 ? 'text-slate-800' : 'text-slate-300'}`}
            title={`${cell?.points ?? 0}点`}
        >
            {countText(count)}
        </td>
    );
}

export default function EvaluationPointsSummaryTable({ data, onSelectPerson }: Props) {
    const { items, people, totals } = data;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="text-xs font-bold text-slate-700">
                            <th className="sticky left-0 z-20 bg-slate-100 border-b border-r border-slate-200 px-3 py-3 text-left whitespace-nowrap min-w-[112px]">
                                氏名
                            </th>
                            {items.map((item) => (
                                <th
                                    key={item.id}
                                    className={`bg-slate-100 border-b border-slate-200 px-3 py-3 text-right whitespace-nowrap ${
                                        item.isActive ? '' : 'text-slate-400 font-medium'
                                    }`}
                                >
                                    {item.name}
                                    {!item.isActive && <span className="ml-0.5 text-[11px]">（使わない）</span>}
                                </th>
                            ))}
                            <th className="bg-slate-100 border-b border-l border-slate-200 px-3 py-3 text-right whitespace-nowrap">合計回数</th>
                            <th className="bg-slate-100 border-b border-slate-200 px-3 py-3 text-right whitespace-nowrap">合計点</th>
                            <th className="bg-slate-100 border-b border-slate-200 px-3 py-3 text-right whitespace-nowrap">確認待ち</th>
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
                                {items.map((item) => (
                                    <Cell key={item.id} cell={p.byItem[item.id]} />
                                ))}
                                <td className="border-l border-slate-200 px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-slate-800">
                                    {countText(p.totalCount)}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold text-slate-900">
                                    {p.totalPoints > 0 ? `${p.totalPoints.toLocaleString('ja-JP')}点` : '−'}
                                </td>
                                <td
                                    className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${p.pendingCount > 0 ? 'text-amber-700' : 'text-slate-300'}`}
                                    title={p.pendingCount > 0 ? `${p.pendingPoints}点（まだ合計に入っていません）` : undefined}
                                >
                                    {p.pendingCount > 0 ? `${p.pendingCount}件` : '−'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-slate-50 font-semibold text-slate-900">
                            <td className="sticky left-0 z-10 bg-slate-50 border-t border-r border-slate-200 px-3 py-2.5 whitespace-nowrap">合計</td>
                            {items.map((item) => {
                                const cell = totals.byItem[item.id];
                                return (
                                    <td
                                        key={item.id}
                                        className="border-t border-slate-200 px-3 py-2.5 text-right tabular-nums whitespace-nowrap"
                                        title={`${cell?.points ?? 0}点`}
                                    >
                                        {countText(cell?.count ?? 0)}
                                    </td>
                                );
                            })}
                            <td className="border-t border-l border-slate-200 px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                                {countText(totals.totalCount)}
                            </td>
                            <td className="border-t border-slate-200 px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                                {totals.totalPoints > 0 ? `${totals.totalPoints.toLocaleString('ja-JP')}点` : '−'}
                            </td>
                            <td className={`border-t border-slate-200 px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${totals.pendingCount > 0 ? 'text-amber-700' : 'text-slate-300'}`}>
                                {totals.pendingCount > 0 ? `${totals.pendingCount}件` : '−'}
                            </td>
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
    );
}
