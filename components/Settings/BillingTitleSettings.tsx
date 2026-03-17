'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Edit, Plus, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface BillingTitle {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
}

export default function BillingTitleSettings() {
    const [titles, setTitles] = useState<BillingTitle[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [newName, setNewName] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const res = await fetch('/api/master-data/billing-titles');
            if (res.ok) {
                const data = await res.json();
                setTitles(data);
            }
        } catch (error) {
            console.error('Failed to fetch billing titles:', error);
            toast.error('請求項目の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAdd = async () => {
        if (!newName.trim()) return;

        try {
            const res = await fetch('/api/master-data/billing-titles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim() }),
            });

            if (res.ok) {
                toast.success('請求項目を追加しました');
                setNewName('');
                fetchData();
            } else {
                toast.error('追加に失敗しました');
            }
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleEdit = (item: BillingTitle) => {
        setEditingId(item.id);
        setEditingName(item.name);
    };

    const handleSaveEdit = async () => {
        if (!editingName.trim() || !editingId) return;

        try {
            const res = await fetch(`/api/master-data/billing-titles/${editingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editingName.trim() }),
            });

            if (res.ok) {
                toast.success('請求項目を更新しました');
                setEditingId(null);
                setEditingName('');
                fetchData();
            } else {
                toast.error('更新に失敗しました');
            }
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingName('');
    };

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/master-data/billing-titles/${id}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                toast.success('請求項目を削除しました');
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
                    <h3 className="text-lg font-semibold text-slate-900">請求項目一覧</h3>
                    <p className="text-sm text-slate-500 mt-1">請求書の明細に使用する項目名を管理します（例: 外部足場組立・解体一式）</p>
                </div>
            </div>

            {/* 新規追加フォーム */}
            <div className="mb-6 flex flex-col md:flex-row gap-2 md:items-center min-w-0">
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    className="flex-1 min-w-0 px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="新しい請求項目を追加（例: 外部足場組立・解体一式）"
                />
                <button
                    onClick={handleAdd}
                    className="px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all duration-200 font-medium flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4" />
                    追加
                </button>
            </div>

            {/* アイテムリスト */}
            <div className="space-y-2">
                {titles.map((item) => (
                    <div
                        key={item.id}
                        className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                    >
                        {editingId === item.id ? (
                            <>
                                <input
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSaveEdit()}
                                    className="flex-1 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    autoFocus
                                />
                                <button
                                    onClick={handleSaveEdit}
                                    className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                                    title="保存"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={handleCancelEdit}
                                    className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                    title="キャンセル"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="flex-1 text-slate-900">{item.name}</span>
                                <button
                                    onClick={() => handleEdit(item)}
                                    className="p-2.5 text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                                    title="編集"
                                >
                                    <Edit className="w-4 h-4" />
                                </button>
                                {deleteConfirm === item.id ? (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleDelete(item.id)}
                                            className="px-3 py-1 text-xs bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors"
                                        >
                                            削除
                                        </button>
                                        <button
                                            onClick={() => setDeleteConfirm(null)}
                                            className="px-3 py-1 text-xs bg-slate-300 text-slate-700 rounded-md hover:bg-slate-400 transition-colors"
                                        >
                                            キャンセル
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setDeleteConfirm(item.id)}
                                        className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                                        title="削除"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>

            {titles.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                    <p>請求項目が登録されていません</p>
                    <p className="text-sm mt-2">上のフォームから追加してください</p>
                </div>
            )}
        </div>
    );
}
