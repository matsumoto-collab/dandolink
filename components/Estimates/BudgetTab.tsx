'use client';

import React from 'react';
import { EstimateItem } from '@/types/estimate';

interface BudgetTabProps {
    items: EstimateItem[];
    onUpdateCostAmount: (itemId: string, costAmount: number | null, childId?: string) => void;
    total: number;
    costTotal: number | null;
}

function formatNumber(n: number): string {
    return n.toLocaleString();
}

function parseCostInput(value: string): number | null {
    const raw = value.replace(/[^0-9-]/g, '');
    if (!raw || raw === '-') return null;
    const num = parseInt(raw, 10);
    return isNaN(num) ? null : num;
}

function CostInput({ value, onChange }: { value: number | null | undefined; onChange: (v: number | null) => void }) {
    const [input, setInput] = React.useState(value != null ? formatNumber(value) : '');

    // Sync external changes
    React.useEffect(() => {
        setInput(value != null ? formatNumber(value) : '');
    }, [value]);

    return (
        <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400">¥</span>
            <input
                type="text"
                inputMode="numeric"
                value={input}
                onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9,-]/g, '');
                    setInput(raw);
                    onChange(parseCostInput(raw));
                }}
                onBlur={() => {
                    // Format on blur
                    const num = parseCostInput(input);
                    setInput(num != null ? formatNumber(num) : '');
                }}
                placeholder="0"
                className="w-28 text-sm py-1 px-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm outline-none text-right"
            />
        </div>
    );
}

export default function BudgetTab({ items, onUpdateCostAmount, total, costTotal }: BudgetTabProps) {
    // 項目別原価の合計
    const itemsCostTotal = React.useMemo(() => {
        let sum = 0;
        let hasAny = false;
        for (const item of items) {
            if (item.isCategory && item.children) {
                for (const child of item.children) {
                    if (child.costAmount != null) { sum += child.costAmount; hasAny = true; }
                }
            } else {
                if (item.costAmount != null) { sum += item.costAmount; hasAny = true; }
            }
        }
        return hasAny ? sum : null;
    }, [items]);

    const effectiveCostTotal = itemsCostTotal ?? costTotal;
    const grossProfit = effectiveCostTotal != null ? total - effectiveCostTotal : null;
    const grossProfitRate = grossProfit != null && total > 0 ? (grossProfit / total) * 100 : null;

    const getProfitColor = (rate: number) => {
        if (rate < 0) return 'text-red-600';
        if (rate < 15) return 'text-yellow-600';
        if (rate < 30) return 'text-slate-600';
        return 'text-emerald-600';
    };

    return (
        <div className="h-full overflow-auto p-4 md:p-6">
            <div className="max-w-4xl mx-auto space-y-4">
                {/* サマリー */}
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                            <div className="text-xs text-slate-500">売上合計</div>
                            <div className="text-lg font-semibold text-slate-800">¥{formatNumber(total)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">原価合計</div>
                            <div className="text-lg font-semibold text-slate-800">
                                {effectiveCostTotal != null ? `¥${formatNumber(effectiveCostTotal)}` : '−'}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">粗利</div>
                            <div className={`text-lg font-semibold ${grossProfitRate != null ? getProfitColor(grossProfitRate) : 'text-slate-400'}`}>
                                {grossProfit != null ? `¥${formatNumber(grossProfit)}` : '−'}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">粗利率</div>
                            <div className={`text-lg font-semibold ${grossProfitRate != null ? getProfitColor(grossProfitRate) : 'text-slate-400'}`}>
                                {grossProfitRate != null ? `${grossProfitRate.toFixed(1)}%` : '−'}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 項目テーブル */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700">品目</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">売上金額</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">原価</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 w-20">粗利率</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {items.map((item) => {
                                if (item.isCategory) {
                                    const categoryAmount = item.children?.reduce((s, c) => s + c.amount, 0) ?? 0;
                                    const categoryCost = item.children?.reduce((s, c) => s + (c.costAmount ?? 0), 0) ?? 0;
                                    const hasCategoryCost = item.children?.some(c => c.costAmount != null) ?? false;
                                    const categoryRate = hasCategoryCost && categoryAmount > 0 ? ((categoryAmount - categoryCost) / categoryAmount) * 100 : null;

                                    return (
                                        <React.Fragment key={item.id}>
                                            {/* カテゴリヘッダー */}
                                            <tr className="bg-slate-50">
                                                <td className="px-4 py-2 text-sm font-semibold text-slate-800">{item.description}</td>
                                                <td className="px-4 py-2 text-right text-sm font-semibold text-slate-700">¥{formatNumber(categoryAmount)}</td>
                                                <td className="px-4 py-2 text-right text-sm font-semibold text-slate-700">
                                                    {hasCategoryCost ? `¥${formatNumber(categoryCost)}` : '−'}
                                                </td>
                                                <td className="px-4 py-2 text-right text-sm font-semibold">
                                                    {categoryRate != null ? (
                                                        <span className={getProfitColor(categoryRate)}>{categoryRate.toFixed(1)}%</span>
                                                    ) : '−'}
                                                </td>
                                            </tr>
                                            {/* 子項目 */}
                                            {item.children?.map((child) => {
                                                const childRate = child.costAmount != null && child.amount > 0
                                                    ? ((child.amount - child.costAmount) / child.amount) * 100 : null;
                                                return (
                                                    <tr key={child.id} className="hover:bg-slate-50/50">
                                                        <td className="px-4 py-2 pl-8 text-sm text-slate-600">{child.description}</td>
                                                        <td className="px-4 py-2 text-right text-sm text-slate-600">¥{formatNumber(child.amount)}</td>
                                                        <td className="px-4 py-2 text-right">
                                                            <CostInput
                                                                value={child.costAmount}
                                                                onChange={(v) => onUpdateCostAmount(item.id, v, child.id)}
                                                            />
                                                        </td>
                                                        <td className="px-4 py-2 text-right text-sm">
                                                            {childRate != null ? (
                                                                <span className={getProfitColor(childRate)}>{childRate.toFixed(1)}%</span>
                                                            ) : <span className="text-slate-400">−</span>}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                }

                                // 通常項目
                                const itemRate = item.costAmount != null && item.amount > 0
                                    ? ((item.amount - item.costAmount) / item.amount) * 100 : null;
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50/50">
                                        <td className="px-4 py-2 text-sm text-slate-700">{item.description}</td>
                                        <td className="px-4 py-2 text-right text-sm text-slate-600">¥{formatNumber(item.amount)}</td>
                                        <td className="px-4 py-2 text-right">
                                            <CostInput
                                                value={item.costAmount}
                                                onChange={(v) => onUpdateCostAmount(item.id, v)}
                                            />
                                        </td>
                                        <td className="px-4 py-2 text-right text-sm">
                                            {itemRate != null ? (
                                                <span className={getProfitColor(itemRate)}>{itemRate.toFixed(1)}%</span>
                                            ) : <span className="text-slate-400">−</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {itemsCostTotal != null && (
                    <p className="text-xs text-slate-500 text-center">
                        項目別原価が入力されているため、原価合計は自動計算されます
                    </p>
                )}
            </div>
        </div>
    );
}
