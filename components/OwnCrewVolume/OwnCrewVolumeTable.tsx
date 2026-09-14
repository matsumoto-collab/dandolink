'use client';

import React from 'react';
import InfoTip from '@/components/ui/InfoTip';
import type { OwnCrewVolumeGroup, OwnCrewVolumeRow, OwnCrewVolumeTotals } from '@/lib/ownCrewVolume';

interface Props {
    groups: OwnCrewVolumeGroup[];
    totals: OwnCrewVolumeTotals;
    /** 「全班」表示（職長ごとの小見出し・小計を出す）かどうか */
    grouped: boolean;
}

const thBase = 'px-2 py-2 text-xs font-semibold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap';
const tdBase = 'px-2 py-1.5 text-sm text-slate-800 border-b border-slate-200 align-middle';

/** 列数（合計行の colSpan 用）: 日付/顧客/現場名/担当者/作業内容/人数/時間/外注換算/稼ぎ/人件費/注記 */
const TOTAL_COLS = 11;
/** 合計行で「合計」ラベルが占める左側の列数（人数の直前まで） */
const LABEL_COLS = 5;

function formatDateLabel(s: string): string {
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    return `${Number(m[1])}/${Number(m[2])}`;
}

function yen(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

function Badge({ label, tone = 'neutral', title }: { label: string; tone?: 'neutral' | 'warn' | 'info'; title?: string }) {
    const cls =
        tone === 'warn'
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : tone === 'info'
                ? 'bg-violet-50 text-violet-700 border-violet-200'
                : 'bg-slate-50 text-slate-600 border-slate-200';
    return (
        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`} title={title}>
            {label}
        </span>
    );
}

function DataRow({ row }: { row: OwnCrewVolumeRow }) {
    const noReport = row.flags.includes('no_report');
    const unbilled = row.flags.includes('unbilled');
    // 未請求の行は見積ベースの仮の数字なので薄く出す
    const moneyTone = unbilled ? 'text-slate-400' : 'text-slate-800';
    return (
        <tr className="group hover:bg-teal-100">
            <td className={`${tdBase} text-center tabular-nums whitespace-nowrap`}>{formatDateLabel(row.date)}</td>
            <td className={tdBase}>{row.customerName || <span className="text-slate-300">—</span>}</td>
            <td className={tdBase}>{row.projectTitle}</td>
            <td className={`${tdBase} text-center whitespace-nowrap`}>{row.managerName || <span className="text-slate-300">—</span>}</td>
            <td className={`${tdBase} text-center whitespace-nowrap`}>
                {row.constructionTypeName || <span className="text-slate-300">—</span>}
            </td>
            <td className={`${tdBase} text-right tabular-nums whitespace-nowrap`}>
                {noReport ? (
                    <span className="text-slate-400 text-xs">
                        日報なし
                        {row.memberCount > 0 && <span className="text-slate-300 ml-1">予定{row.memberCount}名</span>}
                    </span>
                ) : (
                    <>
                        {row.workerCount}
                        <span className="text-slate-400 text-xs ml-0.5">名</span>
                    </>
                )}
            </td>
            <td className={`${tdBase} text-right tabular-nums whitespace-nowrap text-slate-600`}>
                {row.hours > 0 ? `${row.hours}h` : <span className="text-slate-300">—</span>}
            </td>
            <td className={`${tdBase} text-right tabular-nums whitespace-nowrap ${moneyTone}`}>
                {yen(row.outsourcingEquivalent)}
            </td>
            <td className={`${tdBase} text-right tabular-nums whitespace-nowrap ${moneyTone}`}>
                {yen(row.earnings)}
            </td>
            <td className={`${tdBase} text-right tabular-nums whitespace-nowrap`}>
                {yen(row.laborCost)}
                {row.flags.includes('labor_override') && (
                    <span className="ml-1 text-[10px] text-amber-600" title="この配置の人件費は手動で上書きされています">手動</span>
                )}
            </td>
            <td className={tdBase}>
                <span className="inline-flex flex-wrap items-center gap-1">
                    {unbilled && <Badge label="未請求" tone="warn" title="まだ請求していないので、見積（または契約金額）を売上と見なした仮の数字です" />}
                    {row.flags.includes('joyo') && <Badge label="常用含む" tone="info" title="協力業者の方が自社班に入っています（人数には入っています）" />}
                    {row.flags.includes('outsourcing_heavy') && <Badge label="外注中心" title="この案件は労務のほとんどを協力業者が行っています" />}
                </span>
            </td>
        </tr>
    );
}

function TotalRow({
    label,
    totals,
    tone,
}: {
    label: string;
    totals: OwnCrewVolumeTotals;
    tone: 'group' | 'month';
}) {
    const isMonth = tone === 'month';
    const rowCls = isMonth ? 'bg-slate-100 font-semibold' : 'bg-slate-50';
    const cellCls = `${tdBase} text-right tabular-nums whitespace-nowrap ${isMonth ? 'font-bold' : 'text-slate-700'}`;
    return (
        <tr className={rowCls}>
            <td colSpan={LABEL_COLS} className={`${tdBase} text-right ${isMonth ? 'font-bold' : 'text-slate-600'}`}>
                {label}
            </td>
            <td className={cellCls}>
                {totals.manDays}
                <span className="text-slate-400 text-xs ml-0.5 font-normal">人工</span>
            </td>
            <td className={cellCls}>{totals.hours > 0 ? `${totals.hours}h` : '—'}</td>
            <td className={cellCls}>{yen(totals.outsourcingEquivalent)}</td>
            <td className={cellCls}>{yen(totals.earnings)}</td>
            <td className={cellCls}>{yen(totals.laborCost)}</td>
            <td className={`${tdBase} text-xs ${isMonth ? 'text-slate-600 font-normal' : 'text-slate-400'}`}>
                {totals.unbilledRowCount > 0 ? `未請求 ${totals.unbilledRowCount} 行を含む` : ''}
            </td>
        </tr>
    );
}

export default function OwnCrewVolumeTable({ groups, totals, grouped }: Props) {
    const hasRows = groups.some((g) => g.rows.length > 0);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
                <thead>
                    <tr>
                        <th className={`${thBase} text-center w-20`}>日付</th>
                        <th className={`${thBase} text-left w-40`}>顧客</th>
                        <th className={`${thBase} text-left`}>現場名</th>
                        <th className={`${thBase} text-center w-24`}>担当者</th>
                        <th className={`${thBase} text-center w-24`}>作業内容</th>
                        <th className={`${thBase} text-right w-24`}>人数</th>
                        <th className={`${thBase} text-right w-20`}>時間</th>
                        <th className={`${thBase} text-right w-32`}>
                            <span className="inline-flex items-center gap-1">
                                外注換算
                                <InfoTip title="外注換算">
                                    この作業を協力業者に出していたら払った額。案件登録の協力業者費（予定）があればその額、無ければ 売上（税抜）× 協力業者率 を組立・解体に分けた額を、その種別の自社人工で日割りしています。
                                </InfoTip>
                            </span>
                        </th>
                        <th className={`${thBase} text-right w-32`}>
                            <span className="inline-flex items-center gap-1">
                                稼ぎ
                                <InfoTip title="稼ぎ">
                                    案件の稼ぎ（会社に残るお金）を、その案件の延べ人工で割り、この日の人数を掛けた額。班ごとの合計を全班で足すと案件詳細の稼ぎに一致します。
                                </InfoTip>
                            </span>
                        </th>
                        <th className={`${thBase} text-right w-32`}>人件費</th>
                        <th className={`${thBase} text-left w-44`}>注記</th>
                    </tr>
                </thead>
                <tbody>
                    {!hasRows && (
                        <tr>
                            <td colSpan={TOTAL_COLS} className="px-4 py-12 text-center text-slate-400 text-sm">
                                この月の自社班の作業はありません
                            </td>
                        </tr>
                    )}
                    {groups.map((group) => (
                        <React.Fragment key={group.foremanId}>
                            {grouped && (
                                <tr className="bg-teal-50/60">
                                    <td colSpan={TOTAL_COLS} className="px-3 py-1.5 text-sm font-semibold text-teal-800 border-b border-teal-100">
                                        {group.foremanName}
                                        <span className="ml-2 text-xs font-normal text-teal-700/70">
                                            {group.totals.rowCount} 日・{group.totals.manDays} 人工
                                        </span>
                                    </td>
                                </tr>
                            )}
                            {group.rows.map((row) => (
                                <DataRow key={row.assignmentId} row={row} />
                            ))}
                            {grouped && <TotalRow label={`${group.foremanName} 小計`} totals={group.totals} tone="group" />}
                        </React.Fragment>
                    ))}
                </tbody>
                {hasRows && (
                    <tfoot>
                        <TotalRow label="月合計" totals={totals} tone="month" />
                    </tfoot>
                )}
            </table>
        </div>
    );
}
