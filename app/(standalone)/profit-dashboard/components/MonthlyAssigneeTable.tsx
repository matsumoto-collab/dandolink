'use client';

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { RotateCcw, ChevronRight, ChevronDown } from 'lucide-react';
import { logger } from '@/lib/logger';
import { formatCurrency } from '@/utils/costCalculation';
import type { MonthlyAssigneeBreakdown, MonthlyAssigneeProjectRow } from '@/lib/profitDashboard';

interface Props {
    year: number;
    month: number;
}

export default function MonthlyAssigneeTable({ year, month }: Props) {
    const [data, setData] = useState<MonthlyAssigneeBreakdown | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    // 既定は全展開（案件明細をすぐ見せる）。ここに入った担当者だけ折りたたむ。
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/profit-dashboard/monthly-detail?year=${year}&month=${month}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('failed');
                const json = await res.json();
                if (!cancelled) setData(json);
            } catch (e) {
                if (!cancelled) {
                    logger.error('Failed to load monthly assignee breakdown:', e);
                    toast.error('担当者別データの取得に失敗しました');
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }, 200);
        return () => { cancelled = true; clearTimeout(t); };
    }, [year, month]);

    const saveCost = useCallback(async (projectId: string, cost: number | null) => {
        setSavingId(projectId);
        try {
            const res = await fetch('/api/profit-dashboard/monthly-detail', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month, projectId, cost }),
            });
            if (!res.ok) throw new Error('failed');
            const json = await res.json();
            setData(json);
            toast.success(cost === null ? '自動値に戻しました' : '原価を保存しました');
        } catch (e) {
            logger.error('Failed to save monthly project cost:', e);
            toast.error('原価の保存に失敗しました');
        } finally {
            setSavingId(null);
        }
    }, [year, month]);

    const toggle = (id: string) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const rows = data?.rows ?? [];
    const totals = data?.totals ?? { sales: 0, cost: 0, grossProfit: 0 };

    return (
        <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-slate-700">案件担当者別（{year}年{month}月）</h3>
                {isLoading && <span className="text-xs text-slate-400">読み込み中…</span>}
            </div>
            <p className="text-xs text-slate-400 mb-3">
                担当者の行をクリックすると案件ごとの内訳が開きます。売上=請求日基準／原価=作業日基準・主担当に全額計上。原価は日報（人件費）＋配置（車両費）からの自動算出値で、<strong className="text-slate-500">案件ごとに手修正</strong>できます。
            </p>

            {/* PC: テーブル */}
            <div className="hidden md:block overflow-auto">
                <table className="w-full">
                    <thead className="bg-slate-50 border-y border-slate-200">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">案件担当者 / 案件</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">売上</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">原価（自動/手修正）</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">粗利</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.length === 0 ? (
                            <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">{isLoading ? '読み込み中…' : 'この月の売上・原価はありません'}</td></tr>
                        ) : rows.map(r => {
                            const open = !collapsed.has(r.assigneeId);
                            return (
                                <React.Fragment key={r.assigneeId}>
                                    <tr className="bg-white hover:bg-slate-50 cursor-pointer" onClick={() => toggle(r.assigneeId)}>
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
                                        <tr key={`${r.assigneeId}:${it.projectId || 'none'}`} className="bg-slate-50/60">
                                            <td className="px-3 py-1.5 pl-10 text-sm text-slate-600 break-words">{it.projectName}</td>
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

            {/* モバイル: カード（担当者ごとに案件明細を内包） */}
            <div className="md:hidden space-y-3">
                {rows.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-slate-500">{isLoading ? '読み込み中…' : 'この月の売上・原価はありません'}</div>
                ) : rows.map(r => (
                    <div key={r.assigneeId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
                                <div key={`${r.assigneeId}:${it.projectId || 'none'}`} className="text-sm">
                                    <div className="text-slate-700 break-words mb-1">{it.projectName}</div>
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

// 案件1件の原価編集セル。表示は採用値（override ?? auto）。変更で上書き保存、↺ で自動値へ戻す。
// 案件なし行（editable=false）は編集不可の表示のみ。
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
