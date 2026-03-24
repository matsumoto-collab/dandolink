'use client';

import React, { useState } from 'react';
import { useMaterialData } from '@/hooks/useMaterialData';
import { Plus, Trash2, Edit, Check, X, ChevronDown, ChevronRight, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import type { MaterialCategoryWithItems } from '@/types/material';

export default function MaterialMasterSettings() {
    const { categories, addCategory, updateCategory, deleteCategory, addItem, updateItem, deleteItem } = useMaterialData();

    const [newCategoryName, setNewCategoryName] = useState('');
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Item editing
    const [addingItemCategoryId, setAddingItemCategoryId] = useState<string | null>(null);
    const [newItemName, setNewItemName] = useState('');
    const [newItemSpec, setNewItemSpec] = useState('');
    const [newItemUnit, setNewItemUnit] = useState('本');
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editingItemName, setEditingItemName] = useState('');
    const [editingItemSpec, setEditingItemSpec] = useState('');
    const [editingItemUnit, setEditingItemUnit] = useState('');

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) return;
        try {
            await addCategory(newCategoryName.trim());
            setNewCategoryName('');
            toast.success('カテゴリを追加しました');
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleSaveCategoryEdit = async () => {
        if (!editingCategoryId || !editingCategoryName.trim()) return;
        try {
            await updateCategory(editingCategoryId, { name: editingCategoryName.trim() });
            setEditingCategoryId(null);
            toast.success('更新しました');
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDeleteCategory = async (id: string) => {
        try {
            await deleteCategory(id);
            setDeleteConfirm(null);
            toast.success('削除しました');
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    const handleAddItem = async (categoryId: string) => {
        if (!newItemName.trim()) return;
        try {
            await addItem(categoryId, newItemName.trim(), newItemSpec.trim() || undefined, newItemUnit || '本');
            setNewItemName('');
            setNewItemSpec('');
            setNewItemUnit('本');
            setAddingItemCategoryId(null);
            toast.success('品目を追加しました');
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleSaveItemEdit = async () => {
        if (!editingItemId || !editingItemName.trim()) return;
        try {
            await updateItem(editingItemId, {
                name: editingItemName.trim(),
                spec: editingItemSpec.trim() || undefined,
                unit: editingItemUnit || '本',
            });
            setEditingItemId(null);
            toast.success('更新しました');
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDeleteItem = async (id: string) => {
        try {
            await deleteItem(id);
            setDeleteConfirm(null);
            toast.success('削除しました');
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900">材料マスター</h3>
            </div>

            {/* Add Category */}
            <div className="mb-6 flex flex-col md:flex-row gap-2">
                <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                    className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                    placeholder="新しいカテゴリを追加（例: 柱、手摺、単管...）"
                />
                <button
                    onClick={handleAddCategory}
                    className="px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all duration-200 font-medium flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4" />
                    カテゴリ追加
                </button>
            </div>

            {/* Category List */}
            <div className="space-y-2">
                {categories.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                        <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                        <p>材料カテゴリが登録されていません</p>
                        <p className="text-sm mt-1">上のフォームからカテゴリを追加してください</p>
                    </div>
                )}

                {categories.map((cat: MaterialCategoryWithItems) => (
                    <div key={cat.id} className="border border-slate-200 rounded-xl overflow-hidden">
                        {/* Category Header */}
                        <div className="flex items-center gap-2 p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                            <button
                                onClick={() => toggleCategory(cat.id)}
                                className="p-1 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                {expandedCategories.has(cat.id) ? (
                                    <ChevronDown className="w-4 h-4 text-slate-600" />
                                ) : (
                                    <ChevronRight className="w-4 h-4 text-slate-600" />
                                )}
                            </button>

                            {editingCategoryId === cat.id ? (
                                <>
                                    <input
                                        type="text"
                                        value={editingCategoryName}
                                        onChange={(e) => setEditingCategoryName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveCategoryEdit()}
                                        className="flex-1 px-3 py-1 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        autoFocus
                                    />
                                    <button onClick={handleSaveCategoryEdit} className="p-2 text-slate-600 hover:bg-slate-200 rounded-xl"><Check className="w-4 h-4" /></button>
                                    <button onClick={() => setEditingCategoryId(null)} className="p-2 text-slate-600 hover:bg-slate-200 rounded-xl"><X className="w-4 h-4" /></button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 font-medium text-slate-900">{cat.name}</span>
                                    <span className="text-xs text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                                        {cat.items?.length || 0}品目
                                    </span>
                                    <button
                                        onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }}
                                        className="p-2 text-slate-700 hover:bg-slate-200 rounded-xl"
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    {deleteConfirm === `cat-${cat.id}` ? (
                                        <div className="flex gap-1">
                                            <button onClick={() => handleDeleteCategory(cat.id)} className="px-3 py-1 text-xs bg-slate-700 text-white rounded-xl hover:bg-slate-800">削除</button>
                                            <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 text-xs bg-slate-300 text-slate-700 rounded-xl hover:bg-slate-400">取消</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setDeleteConfirm(`cat-${cat.id}`)} className="p-2 text-slate-600 hover:bg-slate-200 rounded-xl">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Items */}
                        {expandedCategories.has(cat.id) && (
                            <div className="border-t border-slate-200 bg-white">
                                {cat.items?.map(item => (
                                    <div key={item.id} className="flex items-center gap-2 px-4 py-2 pl-10 border-b border-slate-100 last:border-b-0">
                                        {editingItemId === item.id ? (
                                            <>
                                                <input
                                                    type="text"
                                                    value={editingItemName}
                                                    onChange={(e) => setEditingItemName(e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                    placeholder="名前"
                                                    autoFocus
                                                />
                                                <input
                                                    type="text"
                                                    value={editingItemSpec}
                                                    onChange={(e) => setEditingItemSpec(e.target.value)}
                                                    className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                    placeholder="規格"
                                                />
                                                <input
                                                    type="text"
                                                    value={editingItemUnit}
                                                    onChange={(e) => setEditingItemUnit(e.target.value)}
                                                    className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                    placeholder="単位"
                                                />
                                                <button onClick={handleSaveItemEdit} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"><Check className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => setEditingItemId(null)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"><X className="w-3.5 h-3.5" /></button>
                                            </>
                                        ) : (
                                            <>
                                                <span className="flex-1 text-sm text-slate-900">{item.name}</span>
                                                {item.spec && <span className="text-xs text-slate-500">{item.spec}</span>}
                                                <span className="text-xs text-slate-400">{item.unit}</span>
                                                <button
                                                    onClick={() => { setEditingItemId(item.id); setEditingItemName(item.name); setEditingItemSpec(item.spec || ''); setEditingItemUnit(item.unit); }}
                                                    className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                                                >
                                                    <Edit className="w-3.5 h-3.5" />
                                                </button>
                                                {deleteConfirm === `item-${item.id}` ? (
                                                    <div className="flex gap-1">
                                                        <button onClick={() => handleDeleteItem(item.id)} className="px-2 py-0.5 text-xs bg-slate-700 text-white rounded-lg">削除</button>
                                                        <button onClick={() => setDeleteConfirm(null)} className="px-2 py-0.5 text-xs bg-slate-300 text-slate-700 rounded-lg">取消</button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setDeleteConfirm(`item-${item.id}`)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}

                                {/* Add Item */}
                                {addingItemCategoryId === cat.id ? (
                                    <div className="flex items-center gap-2 px-4 py-2 pl-10 bg-slate-50">
                                        <input
                                            type="text"
                                            value={newItemName}
                                            onChange={(e) => setNewItemName(e.target.value)}
                                            className="flex-1 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            placeholder="品目名（例: 3.6m）"
                                            autoFocus
                                        />
                                        <input
                                            type="text"
                                            value={newItemSpec}
                                            onChange={(e) => setNewItemSpec(e.target.value)}
                                            className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            placeholder="規格"
                                        />
                                        <input
                                            type="text"
                                            value={newItemUnit}
                                            onChange={(e) => setNewItemUnit(e.target.value)}
                                            className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            placeholder="単位"
                                        />
                                        <button
                                            onClick={() => handleAddItem(cat.id)}
                                            className="p-1.5 text-white bg-slate-700 hover:bg-slate-800 rounded-lg"
                                        >
                                            <Check className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => { setAddingItemCategoryId(null); setNewItemName(''); setNewItemSpec(''); setNewItemUnit('本'); }}
                                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => { setAddingItemCategoryId(cat.id); setNewItemUnit('本'); }}
                                        className="w-full flex items-center gap-2 px-4 py-2 pl-10 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        品目を追加
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
