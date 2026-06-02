'use client';

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { RotateCcw, ChevronRight, ChevronDown, Download } from 'lucide-react';
import { logger } from '@/lib/logger';
import { formatCurrency } from '@/utils/costCalculation';
import type { MonthlyAssigneeBreakdown, MonthlyAssigneeProjectRow, BreakdownAxis, BreakdownPeriod } from '@/lib/profitDashboard';

interface Props {
    year: number;
    month: number;
}

export default function MonthlyAssigneeTable({ year, month }: Props) {
    const [data, setData] = useState<MonthlyAssigneeBreakdown | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [axis, setAxis] = useState<BreakdownAxis>('assignee');
    const [period, setPeriod] = useState<BreakdownPeriod>('month');

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setCollapsed(new Set()); // 軸・期間・月が変わったら全展開に戻す
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/profit-dashboard/monthly-detail?year=${year}&month=${month}&axis=${axis}&period=${period}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('failed');
                const json = await res.json();
                if (!cancelled) setData(json);
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
    }, [year, month, axis, period]);

    const saveCost = useCallback(async (projectId: string, cost: number | null) => {
        setSavingId(projectId);
        try {
            const res = await fetch('/api/profit-dashboard/monthly-detail', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month, projectId, cost, axis }),
            });
            if (!res.ok) throw new Error('failed');
            const json = await res.json();
            setData(json);
            toast.success(cost === null ? '自動値に戻しました' : '原価を保存しました');
        } catch (e) {
            logger.error('Failed to save project cost:', e);
            toast.error('原価の保存に失敗しました');
        } finally {
            setSavingId(null);
        }
    }, [year, month, axis]);

    const toggle = (key: string) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const rows = data?.rows ?? [];
    const totals = data?.totals ?? { sales: 0, cost: 0, grossProfit: 0 };
    const axisLabel = axis === 'assignee' ? '担当者別' : '顧客別';
    const periodLabel = period === 'year' ? `${year}年（年間）` : `${year}年${month}月`;
    const groupColLabel = axis === 'assignee' ? '案件担当者' : '顧客';

    return (
        <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-slate-700">{axisLabel}（{periodLabel}）</h3>
                <div className="flex items-center gap-2">
                    <Segmented
                        value={axis}
                        onChange={(v) => setAxis(v as BreakdownAxis)}
                        options={[{ value: 'assignee', label: '担当者別' }, { value: 'customer', label: '顧客別' }]}
                    />
                    <Segmented
                        value={period}
                        onChange={(v) => setPeriod(v as BreakdownPeriod)}
                        options={[{ value: 'month', label: '当月' }, { value: 'year', label: '年間' }]}
                    />
                    <button
                        type="button"
                        onClick={() => data && downloadBreakdownCsv(data)}
                        disabled={!data || rows.length === 0}
                        title="表示中の集計をCSVで出力"
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Download className="w-3.5 h-3.5" />CSV出力
                    </button>
                    {isLoading && <span className="text-xs text-slate-400">読み込み中…</span>}
                </div>
            </div>
            <p className="text-xs text-slate-400 mb-3">
                {groupColLabel}の行をクリックすると案件ごとの内訳が開きます。<strong className="text-slate-500">その期間に請求した案件のみ</strong>表示（売上=請求額、原価=その案件の総原価＝全期間の人件費＋車両費・主担当に全額計上）。
                {period === 'month'
                    ? <>原価は<strong className="text-slate-500">案件ごとに手修正</strong>できます。</>
                    : <>年間は<strong className="text-slate-500">閲覧のみ</strong>（手修正は「当月」に切り替えて行ってください）。</>}
            </p>

            {/* PC: テーブル */}
            <div className="hidden md:block overflow-auto">
                <table className="w-full">
                    <thead className="bg-slate-50 border-y border-slate-200">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">{groupColLabel} / 案件</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">売上</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">原価{period === 'month' ? '（自動/手修正）' : ''}</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">粗利</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.length === 0 ? (
                            <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">{isLoading ? '読み込み中…' : 'この期間の売上・原価はありません'}</td></tr>
                        ) : rows.map(r => {
                            const open = !collapsed.has(r.key);
                            return (
                                <React.Fragment key={r.key}>
                                    <tr className="bg-white hover:bg-slate-50 cursor-pointer" onClick={() => toggle(r.key)}>
                                        <td className="px-3 py-2 text-sm font-medium text-slate-800">
                                            <span className="inline-flex items-center gap-1.5">
                                                {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                                {r.name}
                                                <span className="text-xs font-normal text-slate-400">（{r.items.length}件）</span>
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right text-sm text-slate-700 tabular-nums">{formatCurrency(r.sales)}</td>
                                        <td className="px-3 py-2 text-right text-sm text-slate-700 tabular-nums">{formatCurrency(r.cost)}</td>
                                        <td className={`px-3 py-2 text-right text-sm font-medium tabular-nums ${r.grossProfit < 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(r.grossProfit)}</td>
                                    </tr>
                                    {open && r.items.map(it => (
                                        <tr key={`${r.key}:${it.projectId || 'none'}`} className="bg-slate-50/60">
                                            <td className="px-3 py-1.5 pl-10 text-sm text-slate-600 break-words">
                                                {axis === 'assignee' && it.customerName && <span className="text-slate-400">{it.customerName}　</span>}
                                                {it.projectName}
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-sm text-slate-600 tabular-nums">{formatCurrency(it.sales)}</td>
                                            <td className="px-3 py-1.5 text-right">
                                                <CostCell item={it} disabled={savingId === it.projectId} onSave={(c) => saveCost(it.projectId, c)} />
                                            </td>
                                            <td className={`px-3 py-1.5 text-right text-sm tabular-nums ${it.grossProfit < 0 ? 'text-red-600' : 'text-slate-700'}`}>{formatCurrency(it.grossProfit)}</td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                                <td className="px-3 py-2 text-sm text-slate-700">合計</td>
                                <td className="px-3 py-2 text-right text-sm text-slate-800 tabular-nums">{formatCurrency(totals.sales)}</td>
                                <td className="px-3 py-2 text-right text-sm text-slate-800 tabular-nums">{formatCurrency(totals.cost)}</td>
                                <td className={`px-3 py-2 text-right text-sm tabular-nums ${totals.grossProfit < 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(totals.grossProfit)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* モバイル: カード */}
            <div className="md:hidden space-y-3">
                {rows.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-slate-500">{isLoading ? '読み込み中…' : 'この期間の売上・原価はありません'}</div>
                ) : rows.map(r => (
                    <div key={r.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-slate-800">{r.name}</span>
                            <span className={`text-sm font-medium tabular-nums ${r.grossProfit < 0 ? 'text-red-600' : 'text-slate-800'}`}>粗利 {formatCurrency(r.grossProfit)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                            <span>売上 {formatCurrency(r.sales)}</span>
                            <span>原価 {formatCurrency(r.cost)}</span>
                        </div>
                        <div className="space-y-2 border-t border-slate-100 pt-2">
                            {r.items.map(it => (
                                <div key={`${r.key}:${it.projectId || 'none'}`} className="text-sm">
                                    <div className="text-slate-700 break-words mb-1">
                                        {axis === 'assignee' && it.customerName && <span className="text-slate-400">{it.customerName}　</span>}
                                        {it.projectName}
                                    </div>
                                    <div className="flex items-center justify-between gap-2 pl-2">
                                        <span className="text-xs text-slate-500">売上 {formatCurrency(it.sales)}</span>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-slate-500">原価</span>
                                            <CostCell item={it} disabled={savingId === it.projectId} onSave={(c) => saveCost(it.projectId, c)} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
                {rows.length > 0 && (
                    <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 font-semibold text-sm">
                        <div className="flex items-center justify-between py-0.5"><span className="text-slate-600">売上計</span><span className="tabular-nums">{formatCurrency(totals.sales)}</span></div>
                        <div className="flex items-center justify-between py-0.5"><span className="text-slate-600">原価計</span><span className="tabular-nums">{formatCurrency(totals.cost)}</span></div>
                        <div className="flex items-center justify-between py-0.5"><span className="text-slate-600">粗利計</span><span className={`tabular-nums ${totals.grossProfit < 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(totals.grossProfit)}</span></div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Segmented({ value, onChange, options }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${value === o.value ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// 案件1件の原価編集セル。表示は採用値（override ?? auto）。変更で上書き保存、↺ で自動値へ戻す。
// 編集不可（年間・案件なし行）は表示のみ。
function CostCell({ item, disabled, onSave }: { item: MonthlyAssigneeProjectRow; disabled: boolean; onSave: (cost: number | null) => void }) {
    const [text, setText] = useState(String(item.cost));
    useEffect(() => { setText(String(item.cost)); }, [item.cost]);

    if (!item.editable) {
        return <span className="text-sm text-slate-500 tabular-nums">{formatCurrency(item.cost)}</span>;
    }

    const commit = () => {
        const n = Math.round(Number(text.replace(/[^0-9.-]/g, '')));
        if (!Number.isFinite(n)) { setText(String(item.cost)); return; }
        if (n !== item.cost) onSave(n);
    };

    return (
        <div className="flex items-center justify-end gap-1.5">
            <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onClick={(e) => e.stopPropagation()}
                inputMode="numeric"
                disabled={disabled}
                aria-label={`${item.projectName} の原価`}
                className="w-28 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm tabular-nums focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
            />
            {item.costOverride != null ? (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSave(null); }}
                    disabled={disabled}
                    title="自動値に戻す（手修正を解除）"
                    className="text-teal-700 hover:text-teal-900 disabled:opacity-50"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                </button>
            ) : (
                <span className="text-[10px] text-slate-400 w-3.5 text-center" title="日報・配置からの自動算出値">自</span>
            )}
        </div>
    );
}

// 表示中の内訳（案件明細）をフラットな CSV で出力する。Excel 文字化け回避のため UTF-8 BOM 付き、
// 金額は記号・桁区切りなしの素の整数（Excel で数値として扱える）。
function downloadBreakdownCsv(data: MonthlyAssigneeBreakdown) {
    const axisName = data.axis === 'assignee' ? '担当者' : '顧客';
    const esc = (v: string | number) => {
        const s = String(v ?? '');
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push([axisName, '顧客名', '案件名', '売上', '原価', '粗利'].map(esc).join(','));
    for (const g of data.rows) {
        for (const it of g.items) {
            lines.push([g.name, it.customerName, it.projectName, it.sales, it.cost, it.grossProfit].map(esc).join(','));
        }
    }
    lines.push(['合計', '', '', data.totals.sales, data.totals.cost, data.totals.grossProfit].map(esc).join(','));

    const axisLabel = data.axis === 'assignee' ? '担当者別' : '顧客別';
    const periodLabel = data.period === 'year' ? `${data.year}年` : `${data.year}-${String(data.month).padStart(2, '0')}`;

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `利益_${axisLabel}_${periodLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
