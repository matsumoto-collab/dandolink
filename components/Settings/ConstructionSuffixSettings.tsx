'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Edit, Plus, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface ConstructionSuffix {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
}

export default function ConstructionSuffixSettings() {
    const [suffixes, setSuffixes] = useState<ConstructionSuffix[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [newName, setNewName] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const res = await fetch('/api/master-data/construction-suffixes');
            if (res.ok) {
                const data = await res.json();
                setSuffixes(data);
            }
        } catch (error) {
            console.error('Failed to fetch construction suffixes:', error);
            toast.error('工事名称の取得に失敗しました');
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
            const res = await fetch('/api/master-data/construction-suffixes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim() }),
            });

            if (res.ok) {
                toast.success('工事名称を追加しました');
                setNewName('');
                fetchData();
            } else {
                toast.error('追加に失敗しました');
            }
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleEdit = (item: ConstructionSuffix) => {
        setEditingId(item.id);
        setEditingName(item.name);
    };

    const handleSaveEdit = async () => {
        if (!editingName.trim() || !editingId) return;

        try {
            const res = await fetch(`/api/master-data/construction-suffixes/${editingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editingName.trim() }),
            });

            if (res.ok) {
                toast.success('工事名称を更新しました');
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
            const res = await fetch(`/api/master-data/construction-suffixes/${id}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                toast.success('工事名称を削除しました');
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
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">工事名称一覧</h3>
                    <p className="text-sm text-slate-500 mt-1">案件名の末尾に付く工事名称を管理します（例: 仮設工事、新築工事）</p>
                </div>
            </div>

            {/* 新規追加フォーム */}
            <div className="mb-6 flex gap-2 items-center">
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="新しい工事名称を追加（例: 仮設工事）"
                />
                <button
                    onClick={handleAdd}
                    className="px-4 py-2 bg-gradient-to-r from-slate-700 to-slate-600 text-white rounded-md hover:from-slate-800 hover:to-slate-700 transition-all duration-200 font-medium flex items-center gap-2 shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4" />
                    追加
                </button>
            </div>

            {/* アイテムリスト */}
            <div className="space-y-2">
                {suffixes.map((item) => (
                    <div
                        key={item.id}
                        className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
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
                                    className="p-2 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                                    title="保存"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={handleCancelEdit}
                                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
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
                                    className="p-2 text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                                    title="編集"
                                >
                                    <Edit className="w-4 h-4" />
                                </button>
                                {deleteConfirm === item.id ? (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleDelete(item.id)}
                                            className="px-3 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                                        >
                                            削除
                                        </button>
                                        <button
                                            onClick={() => setDeleteConfirm(null)}
                                            className="px-3 py-1 text-xs bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
                                        >
                                            キャンセル
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setDeleteConfirm(item.id)}
                                        className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
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

            {suffixes.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p>工事名称が登録されていません</p>
                    <p className="text-sm mt-2">上のフォームから追加してください</p>
                </div>
            )}
        </div>
    );
}
