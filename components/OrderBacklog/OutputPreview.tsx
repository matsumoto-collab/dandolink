'use client';

import React, { useMemo } from 'react';
import { buildOrderBacklogSheet, type OrderBacklogSheetReport } from '@/lib/orderBacklog/render';
import { ROWS_PER_PAGE, type OrderBacklogLineInput } from '@/lib/orderBacklog/types';

interface OutputPreviewProps {
    report: OrderBacklogSheetReport;
    lines: OrderBacklogLineInput[];
}

/** 千円表示（0 は空欄＝様式に合わせる）。 */
const k = (v: number) => (v ? v.toLocaleString() : '');

/**
 * 出力プレビュー。Excel / PDF と同じ `buildOrderBacklogSheet` の結果をそのまま千円で並べる
 * （個別行は契約額の降順、そのあとに区分行、最後に計）。
 */
export default function OutputPreview({ report, lines }: OutputPreviewProps) {
    const sheet = useMemo(() => buildOrderBacklogSheet(report, lines), [report, lines]);

    return (
        <div className="border border-slate-200 rounded-lg bg-white">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 border-b border-slate-200">
                <span className="text-sm font-bold text-slate-800">受注明細書 プレビュー</span>
                <span className="text-xs text-slate-500">{sheet.asOfLabel}</span>
                <span className="text-xs text-slate-500">{sheet.applicantLabel}</span>
                <span className="ml-auto text-xs text-slate-500">
                    （単位 千円）／ {sheet.rows.length}行
                    {sheet.pages.length > 1 && ` ・ ${sheet.pages.length}ページ（${ROWS_PER_PAGE}行/ページ）`}
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-max text-xs">
                    <thead className="bg-slate-100 text-slate-600">
                        <tr>
                            <th className="px-2 py-2 font-medium">符号</th>
                            <th className="px-2 py-2 font-medium text-left">契約先 / 工事名</th>
                            <th className="px-2 py-2 font-medium text-right">契約額</th>
                            <th className="px-2 py-2 font-medium">着工 / 完成予定</th>
                            <th className="px-2 py-2 font-medium text-right">出来高%</th>
                            <th className="px-2 py-2 font-medium text-right">出来高金額</th>
                            <th className="px-2 py-2 font-medium text-right">既受領</th>
                            <th className="px-2 py-2 font-medium text-right">未受領</th>
                            {sheet.columns.map((c) => (
                                <th key={c.key} className="px-2 py-2 font-medium text-right">
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {sheet.rows.length === 0 && (
                            <tr>
                                <td colSpan={8 + sheet.columns.length} className="px-2 py-6 text-center text-slate-400">
                                    出力する行がありません
                                </td>
                            </tr>
                        )}
                        {sheet.rows.map((row) => (
                            <tr key={`${row.kind}-${row.code}`} className={row.kind === 'bucket' ? 'bg-slate-50' : ''}>
                                <td className="px-2 py-1 text-center text-slate-500">{row.code}</td>
                                <td className="px-2 py-1">
                                    <div className="text-slate-800">{row.top}</div>
                                    <div className="text-slate-500">{row.bottom}</div>
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums">{k(row.contractK)}</td>
                                <td className="px-2 py-1 text-center text-slate-600 whitespace-nowrap">
                                    <div>{row.startYm ?? ''}</div>
                                    <div>{row.endYm ?? ''}</div>
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums">
                                    {row.progressRate == null ? '' : `${Math.round(row.progressRate * 100)}%`}
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums">{k(row.progressAmountK ?? 0)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{k(row.receivedK)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{k(row.unreceivedK)}</td>
                                {row.scheduleK.map((v, i) => (
                                    <td key={sheet.columns[i]?.key ?? i} className="px-2 py-1 text-right tabular-nums">
                                        {k(v)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-slate-100 font-semibold text-slate-800">
                        <tr>
                            <td className="px-2 py-2 text-center" colSpan={2}>
                                計
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">{k(sheet.totals.contractK)}</td>
                            <td className="px-2 py-2" colSpan={3} />
                            <td className="px-2 py-2 text-right tabular-nums">{k(sheet.totals.receivedK)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{k(sheet.totals.unreceivedK)}</td>
                            {sheet.totals.scheduleK.map((v, i) => (
                                <td key={sheet.columns[i]?.key ?? i} className="px-2 py-2 text-right tabular-nums">
                                    {k(v)}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}
