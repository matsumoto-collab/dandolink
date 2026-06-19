'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useMaterialData } from '@/hooks/useMaterialData';
import { useSession } from 'next-auth/react';
import { Save, History, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import type { InventoryTransaction } from '@/types/material';
import MaterialSearchBar from './ui/MaterialSearchBar';
import CollapsibleCategory from './ui/CollapsibleCategory';
import QtyStepper from './ui/QtyStepper';

export default function InventoryPage() {
    const { categories, fetchCategories, isCategoriesInitialized } = useMaterialData();
    const { data: session } = useSession();

    const [editMode, setEditMode] = useState(false);
    const [editQuantities, setEditQuantities] = useState<Record<string, number>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [historyItemId, setHistoryItemId] = useState<string | null>(null);
    const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState('');

    useEffect(() => {
        if (!isCategoriesInitialized) fetchCategories();
    }, [isCategoriesInitialized, fetchCategories]);

    const isManager = session?.user?.role === 'admin' || session?.user?.role === 'manager';
    const isSearching = query.trim().length > 0;
    const q = query.trim().toLowerCase();

    const toggleCategory = (catId: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(catId)) next.delete(catId);
            else next.add(catId);
            return next;
        });
    };

    const enterEditMode = () => {
        const quantities: Record<string, number> = {};
        categories.forEach(cat => {
            cat.items.forEach(item => {
                quantities[item.id] = item.stockQuantity ?? 0;
            });
        });
        setEditQuantities(quantities);
        setEditMode(true);
    };

    const setQuantity = (itemId: string, value: number) => {
        setEditQuantities(prev => ({ ...prev, [itemId]: Math.max(0, value) }));
    };

    const saveAdjustments = async () => {
        const adjustments: { materialItemId: string; quantity: number }[] = [];
        categories.forEach(cat => {
            cat.items.forEach(item => {
                const current = item.stockQuantity ?? 0;
                const newQty = editQuantities[item.id] ?? current;
                if (newQty !== current) {
                    adjustments.push({ materialItemId: item.id, quantity: newQty });
                }
            });
        });

        if (adjustments.length === 0) {
            toast('変更はありません');
            setEditMode(false);
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('/api/materials/inventory', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adjustments }),
            });
            if (res.ok) {
                const data: { appliedCount?: number; excludedCount?: number } = await res.json().catch(() => ({}));
                const applied = data.appliedCount ?? adjustments.length;
                const excluded = data.excludedCount ?? 0;
                if (excluded > 0) {
                    toast.success(`${applied}件の在庫を更新しました（${excluded}件はネット/リース等の構造除外品目のため変更不可）`);
                } else {
                    toast.success(`${applied}件の在庫を更新しました`);
                }
                await fetchCategories();
                setEditMode(false);
            } else {
                toast.error('保存に失敗しました');
            }
        } catch {
            toast.error('保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    const fetchHistory = useCallback(async (materialItemId: string) => {
        setHistoryItemId(materialItemId);
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`/api/materials/inventory/transactions?materialItemId=${materialItemId}&limit=20`, { cache: 'no-store' });
            if (res.ok) {
                setTransactions(await res.json());
            }
        } catch {
            toast.error('履歴の取得に失敗しました');
        } finally {
            setIsLoadingHistory(false);
        }
    }, []);

    const getTotalStock = () =>
        categories.reduce((sum, cat) => sum + cat.items.reduce((s, item) => s + (item.stockQuantity ?? 0), 0), 0);

    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'initial': return '初期設定';
            case 'dispatch': return '出庫';
            case 'return': return '返却';
            case 'adjustment': return '調整';
            default: return type;
        }
    };

    return (
        <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className="mb-5">
                <h1 className="text-2xl font-bold text-slate-800">在庫管理</h1>
                <p className="text-sm text-slate-500 mt-1">材料の現在庫数を確認・調整</p>
            </div>

            {/* Summary + Actions */}
            <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                    <Package className="w-4 h-4 text-slate-500" />
                    <span className="text-sm text-slate-600">合計在庫</span>
                    <span className="text-lg font-bold text-slate-900">{getTotalStock().toLocaleString()}</span>
                </div>

                {isManager && !editMode && (
                    <button
                        onClick={enterEditMode}
                        className="ml-auto px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-xl hover:shadow-md transition-shadow"
                    >
                        在庫数を調整
                    </button>
                )}

                {editMode && (
                    <div className="ml-auto flex gap-2">
                        <button
                            onClick={saveAdjustments}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-xl hover:shadow-md disabled:opacity-50"
                        >
                            <Save className="w-3.5 h-3.5" />
                            {isSaving ? '保存中...' : '保存'}
                        </button>
                        <button
                            onClick={() => setEditMode(false)}
                            className="px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                        >
                            キャンセル
                        </button>
                    </div>
                )}
            </div>

            {/* Search */}
            <div className="mb-3">
                <MaterialSearchBar value={query} onChange={setQuery} placeholder="品目を検索…" />
            </div>

            {/* Categories */}
            <div className="space-y-2">
                {categories.map(cat => {
                    const items = isSearching
                        ? cat.items.filter(i =>
                            i.name.toLowerCase().includes(q) || (i.spec ?? '').toLowerCase().includes(q))
                        : cat.items;
                    if (items.length === 0) return null;
                    const catTotal = cat.items.reduce((s, i) => s + (i.stockQuantity ?? 0), 0);
                    const expanded = isSearching || expandedCategories.has(cat.id);

                    return (
                        <CollapsibleCategory
                            key={cat.id}
                            name={cat.name}
                            itemCount={cat.items.length}
                            totalLabel={`計 ${catTotal.toLocaleString()}`}
                            isExpanded={expanded}
                            onToggle={() => toggleCategory(cat.id)}
                        >
                            {items.map(item => {
                                const original = item.stockQuantity ?? 0;
                                const qty = editMode ? (editQuantities[item.id] ?? 0) : original;
                                const hasChanged = editMode && qty !== original;

                                return (
                                    <div
                                        key={item.id}
                                        className={`flex items-center justify-between gap-3 px-4 py-3 ${hasChanged ? 'bg-amber-50' : ''}`}
                                    >
                                        <span className="text-sm text-slate-800 min-w-0 flex-1">
                                            {item.name}
                                            {item.spec && <span className="text-xs text-slate-400 ml-1">({item.spec})</span>}
                                        </span>

                                        {editMode ? (
                                            <QtyStepper value={qty} onChange={(v) => setQuantity(item.id, v)} />
                                        ) : (
                                            <>
                                                <span className="flex items-baseline gap-1">
                                                    <span className={`text-lg font-bold ${original === 0 ? 'text-slate-300' : 'text-slate-900'}`}>
                                                        {original.toLocaleString()}
                                                    </span>
                                                    <span className="text-xs text-slate-400">{item.unit}</span>
                                                </span>
                                                <button
                                                    onClick={() => fetchHistory(item.id)}
                                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                                                    title="履歴を表示"
                                                >
                                                    <History className="w-3.5 h-3.5" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </CollapsibleCategory>
                    );
                })}
            </div>

            {/* History Modal */}
            {historyItemId && (
                <HistoryModal
                    transactions={transactions}
                    isLoading={isLoadingHistory}
                    onClose={() => setHistoryItemId(null)}
                    getTypeLabel={getTypeLabel}
                />
            )}
        </div>
    );
}

function HistoryModal({
    transactions,
    isLoading,
    onClose,
    getTypeLabel,
}: {
    transactions: InventoryTransaction[];
    isLoading: boolean;
    onClose: () => void;
    getTypeLabel: (type: string) => string;
}) {
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[70vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800">入出庫履歴</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
                </div>
                <div className="overflow-y-auto max-h-[60vh] p-4">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500"></div>
                        </div>
                    ) : transactions.length === 0 ? (
                        <p className="text-center text-sm text-slate-400 py-8">履歴がありません</p>
                    ) : (
                        <div className="space-y-2">
                            {transactions.map(tx => (
                                <div key={tx.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-xl">
                                    <div>
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mr-2 ${
                                            tx.quantity > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                        }`}>
                                            {getTypeLabel(tx.type)}
                                        </span>
                                        {tx.notes && <span className="text-xs text-slate-500">{tx.notes}</span>}
                                    </div>
                                    <div className="text-right">
                                        <span className={`text-sm font-medium ${tx.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                                        </span>
                                        <div className="text-xs text-slate-400">
                                            {new Date(tx.createdAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
