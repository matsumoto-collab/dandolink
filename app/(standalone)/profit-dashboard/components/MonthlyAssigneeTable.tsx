'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Download, Search, X } from 'lucide-react';
import { formatCurrency } from '@/utils/costCalculation';
import type { MonthlyAssigneeBreakdown, MonthlyAssigneeRow, BreakdownAxis } from '@/lib/profitDashboard';

// データ取得は親（MonthlySalesPanel）が行い、この表は表示と絞り込みに専念する。
// 期間（当月/年間/期間指定）のトグルもパネル側へ移動済み。
interface Props {
    data: MonthlyAssigneeBreakdown | null;
    isLoading: boolean;
    axis: BreakdownAxis;
    onAxisChange: (axis: BreakdownAxis) => void;
}

const EMPTY_TOTALS = { sales: 0, salesTaxIncluded: 0, cost: 0, grossProfit: 0 };

export default function MonthlyAssigneeTable({ data, isLoading, axis, onAxisChange }: Props) {
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    // 絞り込み（クライアント側。1期間ぶんの行数なので全件フィルタで十分軽い）
    const [query, setQuery] = useState('');
    const [groupKey, setGroupKey] = useState(''); // '' = 全グループ

    // 期間・軸が変わってデータが差し替わったら全展開に戻す
    useEffect(() => { setCollapsed(new Set()); }, [data]);
    // 軸が変わるとグループキーの意味（担当者ID⇄顧客名）が変わるためリセット
    useEffect(() => { setGroupKey(''); }, [axis]);

    const toggle = (key: string) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const allRows = useMemo(() => data?.rows ?? [], [data]);

    // ---- 絞り込み ----
    // グループ選択: 行の key で一致。フリーワード: グループ名ヒットは全明細、それ以外は案件名/顧客名で明細を絞る。
    const filterActive = query.trim() !== '' || groupKey !== '';
    const rows = useMemo<MonthlyAssigneeRow[]>(() => {
        if (!filterActive) return allRows;
        const q = query.trim().toLowerCase();
        const result: MonthlyAssigneeRow[] = [];
        for (const r of allRows) {
            if (groupKey && r.key !== groupKey) continue;
            if (!q || r.name.toLowerCase().includes(q)) { result.push(r); continue; }
            const items = r.items.filter(it =>
                it.projectName.toLowerCase().includes(q) || it.customerName.toLowerCase().includes(q));
            if (items.length === 0) continue;
            const sales = items.reduce((s, i) => s + i.sales, 0);
            const cost = items.reduce((s, i) => s + i.cost, 0);
            result.push({ ...r, items, sales, cost, grossProfit: sales - cost });
        }
        return result;
    }, [allRows, filterActive, query, groupKey]);

    // 合計は「表示中」の合計（絞り込み時はその旨をラベルで明示。全体値は上のKPIで見える）
    const totals = useMemo(() => {
        if (!filterActive) return data?.totals ?? EMPTY_TOTALS;
        return rows.reduce(
            (t, r) => { t.sales += r.sales; t.cost += r.cost; t.grossProfit += r.grossProfit; return t; },
            { sales: 0, salesTaxIncluded: 0, cost: 0, grossProfit: 0 },
        );
    }, [filterActive, rows, data]);

    const axisLabel = axis === 'assignee' ? '担当者別' : '顧客別';
    const periodLabel = !data
        ? ''
        : data.period === 'year'
            ? `${data.year}年（年間）`
            : data.period === 'range'
                ? `${data.year}年${data.month}月〜${data.endYear ?? data.year}年${data.endMonth ?? data.month}月`
                : `${data.year}年${data.month}月`;
    const groupColLabel = axis === 'assignee' ? '案件担当者' : '顧客';
    const totalLabel = filterActive ? '合計（絞り込み中）' : '合計';

    // 説明文（PC=常時表示 / モバイル=折りたたみ）で共用
    const explainer = (
        <>
            {groupColLabel}の行をクリックすると案件ごとの内訳が開きます。期間は<strong className="text-slate-500">請求日（請求月）基準</strong>で、その期間に請求した案件のみ表示（売上=請求額（税抜）、主担当に全額計上）。
            原価は<strong className="text-slate-500">繰越方式</strong>＝その請求月末までに発生した原価（人件費＋車両費＋材料費＋外注費＋その他）のうち、まだ過去の請求月に計上していない分。月をまたいで分割請求しても原価は二重計上されず、全請求月の合計＝案件の確定原価になります。
            <strong className="text-slate-500">原価の修正は案件詳細の利益タブ</strong>（配置ごとの上書き・材料費等の手入力明細）で行います。
        </>
    );

    return (
        <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                {/* 表の売上・原価・粗利は税抜（粗利計算の正確さ優先・kei 決定 2026-07-07） */}
                <h3 className="text-sm font-semibold text-slate-700">{axisLabel}（{periodLabel}・税抜）</h3>
                {/* 幅が足りないときはボタンを潰さずグループ単位で折り返す（文字の縦書き化防止） */}
                <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                        value={axis}
                        onChange={(v) => onAxisChange(v as BreakdownAxis)}
                        options={[{ value: 'assignee', label: '担当者別' }, { value: 'customer', label: '顧客別' }]}
                    />
                    <button
                        type="button"
                        onClick={() => data && downloadBreakdownCsv({ ...data, rows, totals })}
                        disabled={!data || rows.length === 0}
                        title="表示中の集計をCSVで出力（絞り込みも反映）"
                        className="inline-flex flex-shrink-0 items-center gap-1 px-3 py-1 text-xs whitespace-nowrap rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Download className="w-3.5 h-3.5" />CSV出力
                    </button>
                    {isLoading && <span className="text-xs text-slate-400">読み込み中…</span>}
                </div>
            </div>

            {/* 絞り込み: フリーワード（案件名/顧客名/グループ名）＋グループ（軸に応じて担当者/顧客） */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="relative flex-1 min-w-[12rem] max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="案件名・顧客名で絞り込み"
                        className="w-full pl-8 pr-8 py-1.5 text-sm border border-slate-200 rounded-lg bg-white placeholder:text-slate-400"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => setQuery('')}
                            aria-label="検索をクリア"
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
                <select
                    value={groupKey}
                    onChange={e => setGroupKey(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-600 max-w-[12rem]"
                >
                    <option value="">{groupColLabel}: すべて</option>
                    {allRows.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
                {filterActive && (
                    <button
                        type="button"
                        onClick={() => { setQuery(''); setGroupKey(''); }}
                        className="text-xs text-teal-700 hover:underline whitespace-nowrap"
                    >
                        絞り込み解除
                    </button>
                )}
            </div>

            <p className="hidden sm:block text-xs text-slate-400 mb-3">{explainer}</p>
            <details className="sm:hidden mb-3">
                <summary className="cursor-pointer select-none text-xs text-slate-500">この表の見方</summary>
                <p className="mt-1.5 text-xs text-slate-400">{explainer}</p>
            </details>

            {/* PC: テーブル */}
            <div className="hidden md:block overflow-auto">
                <table className="w-full">
                    <thead className="bg-slate-50 border-y border-slate-200">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">{groupColLabel} / 案件</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">売上</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">原価</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">粗利</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.length === 0 ? (
                            <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">{isLoading ? '読み込み中…' : filterActive ? '絞り込みに一致する案件がありません' : 'この期間の売上・原価はありません'}</td></tr>
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
                                            <td className="px-3 py-1.5 text-right text-sm text-slate-600 tabular-nums">{formatCurrency(it.cost)}</td>
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
                                <td className="px-3 py-2 text-sm text-slate-700">{totalLabel}</td>
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
                    <div className="px-3 py-8 text-center text-sm text-slate-500">{isLoading ? '読み込み中…' : filterActive ? '絞り込みに一致する案件がありません' : 'この期間の売上・原価はありません'}</div>
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
                                    <div className="flex items-center justify-between gap-2 pl-2 text-xs text-slate-500">
                                        <span>売上 {formatCurrency(it.sales)}</span>
                                        <span>原価 {formatCurrency(it.cost)}</span>
                                        <span className={it.grossProfit < 0 ? 'text-red-600' : 'text-slate-700'}>粗利 {formatCurrency(it.grossProfit)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
                {rows.length > 0 && (
                    <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 font-semibold text-sm">
                        {filterActive && <div className="text-xs font-normal text-slate-500 mb-1">絞り込み中の合計</div>}
                        <div className="flex items-center justify-between py-0.5"><span className="text-slate-600">売上計</span><span className="tabular-nums">{formatCurrency(totals.sales)}</span></div>
                        <div className="flex items-center justify-between py-0.5"><span className="text-slate-600">原価計</span><span className="tabular-nums">{formatCurrency(totals.cost)}</span></div>
                        <div className="flex items-center justify-between py-0.5"><span className="text-slate-600">粗利計</span><span className={`tabular-nums ${totals.grossProfit < 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(totals.grossProfit)}</span></div>
                    </div>
                )}
            </div>
        </div>
    );
}

// パネル側（期間トグル）でも使うため export。
export function Segmented({ value, onChange, options }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        // flex-shrink-0 + whitespace-nowrap: 幅不足時にボタン内の文字が縦書き化するのを防ぐ
        <div className="inline-flex flex-shrink-0 rounded-lg border border-slate-200 bg-white p-0.5">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={`px-3 py-1 text-xs whitespace-nowrap rounded-md transition-colors ${value === o.value ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// 表示中の内訳（案件明細・絞り込み反映後）をフラットな CSV で出力する。Excel 文字化け回避のため UTF-8 BOM 付き、
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
    const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
    const periodLabel = data.period === 'year'
        ? `${data.year}年`
        : data.period === 'range'
            ? `${ym(data.year, data.month)}〜${ym(data.endYear ?? data.year, data.endMonth ?? data.month)}`
            : ym(data.year, data.month);

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
