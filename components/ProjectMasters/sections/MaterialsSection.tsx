'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useMaterialData } from '@/hooks/useMaterialData';
import { ChevronDown, ChevronRight, Minus, Plus, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import type { MaterialCategoryWithItems } from '@/types/material';

interface MaterialsSectionProps {
    projectMasterId: string;
}

export default function MaterialsSection({ projectMasterId }: MaterialsSectionProps) {
    const { categories, fetchCategories, isCategoriesInitialized } = useMaterialData();
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [savedQuantities, setSavedQuantities] = useState<Record<string, number>>({});
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isCategoriesInitialized) fetchCategories();
    }, [isCategoriesInitialized, fetchCategories]);

    // Fetch project materials
    const fetchProjectMaterials = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/project-masters/${projectMasterId}/materials`, { cache: 'no-store' });
            if (res.ok) {
                const items = await res.json();
                const qtys: Record<string, number> = {};
                for (const item of items) {
                    qtys[item.materialItemId] = item.requiredQuantity;
                }
                setQuantities(qtys);
                setSavedQuantities(qtys);
                // Auto expand categories that have items
                const catIds = new Set<string>();
                for (const item of items) {
                    if (item.materialItem?.category?.id) {
                        catIds.add(item.materialItem.category.id);
                    }
                }
                setExpandedCategories(catIds);
            }
        } catch {
            toast.error('材料表の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [projectMasterId]);

    useEffect(() => {
        fetchProjectMaterials();
    }, [fetchProjectMaterials]);

    const isDirty = JSON.stringify(quantities) !== JSON.stringify(savedQuantities);

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const expandAll = () => setExpandedCategories(new Set(categories.map(c => c.id)));

    const adjustQty = (itemId: string, delta: number) => {
        setQuantities(prev => ({
            ...prev,
            [itemId]: Math.max(0, (prev[itemId] || 0) + delta),
        }));
    };

    const setQty = (itemId: string, value: number) => {
        setQuantities(prev => ({ ...prev, [itemId]: Math.max(0, value) }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const items = Object.entries(quantities)
                .filter(([, qty]) => qty > 0)
                .map(([materialItemId, requiredQuantity]) => ({ materialItemId, requiredQuantity }));

            const res = await fetch(`/api/project-masters/${projectMasterId}/materials`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });

            if (res.ok) {
                toast.success('材料表を保存しました');
                setSavedQuantities({ ...quantities });
            } else {
                toast.error('保存に失敗しました');
            }
        } catch {
            toast.error('保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    const totalItems = Object.values(quantities).filter(q => q > 0).length;

    if (isLoading) {
        return (
            <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500"></div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="text-sm text-slate-500">{totalItems}品目登録済み</span>
                <button
                    onClick={expandAll}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200"
                >
                    すべて展開
                </button>
                {isDirty && (
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-teal-600 to-teal-700 rounded-xl hover:shadow-md disabled:opacity-50"
                    >
                        <Save className="w-3.5 h-3.5" />
                        {isSaving ? '保存中...' : '保存'}
                    </button>
                )}
            </div>

            {/* Categories */}
            <div className="space-y-2">
                {categories.map(cat => (
                    <CategoryRow
                        key={cat.id}
                        category={cat}
                        isExpanded={expandedCategories.has(cat.id)}
                        onToggle={() => toggleCategory(cat.id)}
                        quantities={quantities}
                        onAdjust={adjustQty}
                        onSetQty={setQty}
                    />
                ))}
            </div>
        </div>
    );
}

function CategoryRow({
    category,
    isExpanded,
    onToggle,
    quantities,
    onAdjust,
    onSetQty,
}: {
    category: MaterialCategoryWithItems;
    isExpanded: boolean;
    onToggle: () => void;
    quantities: Record<string, number>;
    onAdjust: (id: string, delta: number) => void;
    onSetQty: (id: string, value: number) => void;
}) {
    const itemCount = category.items.filter(i => (quantities[i.id] || 0) > 0).length;

    return (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    <span className="text-sm font-medium text-slate-800">{category.name}</span>
                </div>
                {itemCount > 0 && (
                    <span className="text-xs font-medium text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                        {itemCount}品目
                    </span>
                )}
            </button>

            {isExpanded && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {category.items.map(item => {
                        const qty = quantities[item.id] || 0;
                        return (
                            <div key={item.id} className={`flex items-center gap-2 px-3 py-2 ${qty > 0 ? 'bg-teal-50/30' : ''}`}>
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm text-slate-800">{item.name}</span>
                                    {item.spec && <span className="text-xs text-slate-400 ml-1">({item.spec})</span>}
                                    <span className="text-xs text-slate-400 ml-1">{item.unit}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => onAdjust(item.id, -1)}
                                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                    <input
                                        type="number"
                                        value={qty || ''}
                                        onChange={(e) => onSetQty(item.id, parseInt(e.target.value) || 0)}
                                        placeholder="0"
                                        className="w-14 text-center text-sm border border-slate-200 rounded-xl py-1 focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    />
                                    <button
                                        onClick={() => onAdjust(item.id, 1)}
                                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
