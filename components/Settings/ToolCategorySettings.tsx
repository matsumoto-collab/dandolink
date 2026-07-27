'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Edit, Plus, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { ToolCategory } from '@/types/tool';

export default function ToolCategorySettings() {
    const [items, setItems] = useState<ToolCategory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [newName, setNewName] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const res = await fetch('/api/master-data/tool-categories');
            if (res.ok) setItems(await res.json());
        } catch (error) {
            logger.error('Failed to fetch tool categories:', error);
            toast.error('工具の種類の取得に失敗しました');
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
            const res = await fetch('/api/master-data/tool-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim() }),
            });
            if (res.ok) {
                toast.success('工具の種類を追加しました');
                setNewName('');
                fetchData();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || '追加に失敗しました');
            }
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleEdit = (item: ToolCategory) => {
        setEditingId(item.id);
        setEditingName(item.name);
    };

    const handleSaveEdit = async () => {
        if (!editingName.trim() || !editingId) return;
        try {
            const res = await fetch(`/api/master-data/tool-categories/${editingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editingName.trim() }),
            });
            if (res.ok) {
                toast.success('工具の種類を更新しました');
                setEditingId(null);
                fetchData();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || '更新に失敗しました');
            }
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/master-data/tool-categories/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('工具の種類を削除しました');
                setDeleteConfirm(null);
                fetchData();
            } else {
                // 工具が残っている種類は 409 で拒否される（メッセージに残台数が入る）
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || '削除に失敗しました');
                setDeleteConfirm(null);
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
                    <h3 className="text-lg font-semibold text-slate-900">工具の種類</h3>
                    <p className="text-sm text-slate-500 mt-1">
                        持出しリストで使う工具の種類を管理します（例: インパクトドライバー、発電機、レーザー墨出し器）。
                        1台ずつの工具そのものは「在庫管理 &gt; 持出しリスト」から登録します。
                    </p>
                </div>
            </div>

            {/* 新規追加フォーム */}
            <div className="mb-6 flex flex-col md:flex-row gap-2 md:items-end min-w-0">
                <div className="flex-1 min-w-0">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">種類名</label>
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例: インパクトドライバー、発電機"
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

            {/* リスト */}
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
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                    className="flex-1 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    autoFocus
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
                                    {typeof item.toolCount === 'number' && (
                                        <span className="ml-2 text-sm text-slate-500">（{item.toolCount}台）</span>
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
                    <p>工具の種類が登録されていません</p>
                    <p className="text-sm mt-2">上のフォームから追加してください（例: インパクトドライバー、発電機、レーザー墨出し器）</p>
                </div>
            )}
        </div>
    );
}
