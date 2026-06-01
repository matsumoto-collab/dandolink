'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Edit, Plus, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface CostMasterItem {
    id: string;
    name: string;
    quantity?: number | null;
    unit?: string | null;
    unitPrice?: number | null;
    sortOrder: number;
}

export default function CostMasterSettings() {
    const [items, setItems] = useState<CostMasterItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingData, setEditingData] = useState({ name: '', quantity: '' as string, unit: '', unitPrice: '' as string });
    const [newData, setNewData] = useState({ name: '', quantity: '' as string, unit: '', unitPrice: '' as string });
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const res = await fetch('/api/master-data/cost-masters');
            if (res.ok) {
                const data = await res.json();
                setItems(data);
            }
        } catch (error) {
            logger.error('Failed to fetch cost masters:', error);
            toast.error('原価マスターの取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAdd = async () => {
        if (!newData.name.trim()) return;

        try {
            const res = await fetch('/api/master-data/cost-masters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newData.name.trim(),
                    quantity: newData.quantity ? parseFloat(newData.quantity) : null,
                    unit: newData.unit.trim() || null,
                    unitPrice: newData.unitPrice ? parseInt(newData.unitPrice.replace(/,/g, ''), 10) : null,
                }),
            });

            if (res.ok) {
                toast.success('原価マスターを追加しました');
                setNewData({ name: '', quantity: '', unit: '', unitPrice: '' });
                fetchData();
            } else {
                toast.error('追加に失敗しました');
            }
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleEdit = (item: CostMasterItem) => {
        setEditingId(item.id);
        setEditingData({
            name: item.name,
            quantity: item.quantity != null ? String(item.quantity) : '',
            unit: item.unit || '',
            unitPrice: item.unitPrice != null ? item.unitPrice.toLocaleString() : '',
        });
    };

    const handleSaveEdit = async () => {
        if (!editingData.name.trim() || !editingId) return;

        try {
            const res = await fetch(`/api/master-data/cost-masters/${editingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editingData.name.trim(),
                    quantity: editingData.quantity ? parseFloat(editingData.quantity) : null,
                    unit: editingData.unit.trim() || null,
                    unitPrice: editingData.unitPrice ? parseInt(editingData.unitPrice.replace(/,/g, ''), 10) : null,
                }),
            });

            if (res.ok) {
                toast.success('原価マスターを更新しました');
                setEditingId(null);
                fetchData();
            } else {
                toast.error('更新に失敗しました');
            }
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/master-data/cost-masters/${id}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                toast.success('原価マスターを削除しました');
                setDeleteConfirm(null);
                fetchData();
            } else {
                toast.error('削除に失敗しました');
            }
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
            </div>
        );
    }

    return (
        <div className="min-w-0 overflow-hidden">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">原価マスター一覧</h3>
                    <p className="text-sm text-slate-500 mt-1">見積書の原価入力で使用する項目を管理します（例: 足場予算1、リース費用）</p>
                </div>
            </div>

            {/* 新規追加フォーム */}
            <div className="mb-6 flex flex-col md:flex-row gap-2 md:items-end min-w-0">
                <div className="flex-1 min-w-0">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">名称</label>
                    <input
                        type="text"
                        value={newData.name}
                        onChange={(e) => setNewData({ ...newData, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 足場予算1、リース費用"
                    />
                </div>
                <div className="w-24">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">数量</label>
                    <input
                        type="number"
                        value={newData.quantity}
                        onChange={(e) => setNewData({ ...newData, quantity: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="1"
                        step="any"
                    />
                </div>
                <div className="w-24">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">単位</label>
                    <input
                        type="text"
                        value={newData.unit}
                        onChange={(e) => setNewData({ ...newData, unit: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="式"
                    />
                </div>
                <div className="w-32">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">単価</label>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={newData.unitPrice}
                        onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9]/g, '');
                            setNewData({ ...newData, unitPrice: raw ? parseInt(raw, 10).toLocaleString() : '' });
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="0"
                    />
                </div>
                <button
                    onClick={handleAdd}
                    className="px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-all duration-200 font-medium flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4" />
                    追加
                </button>
            </div>

            {/* アイテムリスト */}
            <div className="space-y-2">
                {items.map((item) => (
                    <div
                        key={item.id}
                        className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                    >
                        {editingId === item.id ? (
                            <>
                                <input
                                    type="text"
                                    value={editingData.name}
                                    onChange={(e) => setEditingData({ ...editingData, name: e.target.value })}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                    className="flex-1 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    autoFocus
                                />
                                <input
                                    type="number"
                                    value={editingData.quantity}
                                    onChange={(e) => setEditingData({ ...editingData, quantity: e.target.value })}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                    className="w-20 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    placeholder="数量"
                                    step="any"
                                />
                                <input
                                    type="text"
                                    value={editingData.unit}
                                    onChange={(e) => setEditingData({ ...editingData, unit: e.target.value })}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                    className="w-20 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    placeholder="単位"
                                />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={editingData.unitPrice}
                                    onChange={(e) => {
                                        const raw = e.target.value.replace(/[^0-9]/g, '');
                                        setEditingData({ ...editingData, unitPrice: raw ? parseInt(raw, 10).toLocaleString() : '' });
                                    }}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                    className="w-28 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    placeholder="単価"
                                />
                                <button onClick={handleSaveEdit} className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors" title="保存">
                                    <Check className="w-4 h-4" />
                                </button>
                                <button onClick={() => setEditingId(null)} className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors" title="キャンセル">
                                    <X className="w-4 h-4" />
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="flex-1 text-slate-900">
                                    {item.name}
                                    {(item.quantity != null || item.unit || item.unitPrice != null) && (
                                        <span className="ml-2 text-sm text-slate-500">
                                            ({item.quantity != null && `${item.quantity}`}{item.quantity != null && item.unit && ' '}{item.unit && item.unit}{(item.quantity != null || item.unit) && item.unitPrice != null && ' × '}{item.unitPrice != null && `¥${Number(item.unitPrice).toLocaleString()}`})
                                        </span>
                                    )}
                                </span>
                                <button onClick={() => handleEdit(item)} className="p-2.5 text-slate-700 hover:bg-slate-100 rounded-xl transition-colors" title="編集">
                                    <Edit className="w-4 h-4" />
                                </button>
                                {deleteConfirm === item.id ? (
                                    <div className="flex gap-1">
                                        <button onClick={() => handleDelete(item.id)} className="px-3 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors">削除</button>
                                        <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 text-xs bg-slate-300 text-slate-700 rounded-md hover:bg-slate-400 transition-colors">キャンセル</button>
                                    </div>
                                ) : (
                                    <button onClick={() => setDeleteConfirm(item.id)} className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors" title="削除">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>

            {items.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                    <p>原価マスターが登録されていません</p>
                    <p className="text-sm mt-2">上のフォームから追加してください</p>
                </div>
            )}
        </div>
    );
}
