'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Edit, Plus, Check, X, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { useMasterData } from '@/hooks/useMasterData';

/**
 * マスター・設定 ＞ 電動工具。
 * 車両管理と同じ感覚で1台ずつ追加・改名・削除できる。
 * 実体は機材台帳（Tool）そのものなので、ここで追加した工具はそのまま台帳に並び、
 * スケジュール作成の「電動工具」でも選べるようになる。
 * 削除は論理削除（isActive=false）＝過去の配置・持出し・修理の履歴は残る。
 */
export default function ToolMasterSettings() {
    const { tools: allTools, toolCategories, fetchTools, addTool, updateTool, deleteTool } = useMasterData();
    // 一覧に出すのは台帳にある工具だけ（削除＝isActive=false の分は名前解決のためストアには残る）
    const tools = allTools.filter((t) => t.isActive);

    const [isLoading, setIsLoading] = useState(true);
    const [newName, setNewName] = useState('');
    const [newCategoryId, setNewCategoryId] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingCategoryId, setEditingCategoryId] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // 分類は master-data の一括取得に含まれないので、この画面で取り直す
    useEffect(() => {
        let mounted = true;
        fetchTools().finally(() => { if (mounted) setIsLoading(false); });
        return () => { mounted = false; };
    }, [fetchTools]);

    const handleAdd = async () => {
        const name = newName.trim();
        if (!name) return;
        try {
            await addTool(name, newCategoryId || null);
            toast.success('電動工具を追加しました');
            setNewName('');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '追加に失敗しました');
        }
    };

    const handleSaveEdit = async () => {
        const name = editingName.trim();
        if (!name || !editingId) return;
        try {
            await updateTool(editingId, name, editingCategoryId || null);
            toast.success('電動工具を更新しました');
            setEditingId(null);
            setEditingName('');
            setEditingCategoryId('');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '更新に失敗しました');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteTool(id);
            toast.success('電動工具を削除しました');
            setDeleteConfirm(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '削除に失敗しました');
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
                    <h3 className="text-lg font-semibold text-slate-900">電動工具一覧</h3>
                    <p className="text-sm text-slate-500 mt-1">
                        1台ずつ登録します。ここで追加した工具はそのまま機材台帳に並び、スケジュール作成でも車両と同じように選べます。
                    </p>
                </div>
            </div>

            {/* 新規追加フォーム */}
            <div className="mb-2 flex flex-col md:flex-row gap-2 md:items-center min-w-0">
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    className="flex-1 min-w-0 px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="新しい電動工具を追加（例: インパクト #1）"
                />
                {toolCategories.length > 0 && (
                    <select
                        value={newCategoryId}
                        onChange={(e) => setNewCategoryId(e.target.value)}
                        className="px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm md:w-48"
                    >
                        <option value="">分類（未選択）</option>
                        {toolCategories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                )}
                <button
                    onClick={handleAdd}
                    className="px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-all duration-200 font-medium flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4" />
                    追加
                </button>
            </div>
            <p className="mb-6 text-xs text-slate-500">
                メーカー・型番・購入日や、修理・点検の履歴は「機材台帳」で登録します。分類を選ばずに追加すると既定の分類に入ります。
            </p>

            {/* アイテムリスト */}
            <div className="space-y-2">
                {tools.map((item) => (
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
                                    className="flex-1 min-w-0 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    autoFocus
                                />
                                {toolCategories.length > 0 && (
                                    <select
                                        value={editingCategoryId}
                                        onChange={(e) => setEditingCategoryId(e.target.value)}
                                        className="px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm flex-shrink-0"
                                    >
                                        {toolCategories.map((c) => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                )}
                                <button
                                    onClick={handleSaveEdit}
                                    className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                                    title="保存"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => { setEditingId(null); setEditingName(''); setEditingCategoryId(''); }}
                                    className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                    title="キャンセル"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </>
                        ) : (
                            <>
                                <Wrench className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                <span className="flex-1 min-w-0 truncate text-slate-900">{item.name}</span>
                                <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
                                    {item.categoryName}
                                </span>
                                <button
                                    onClick={() => {
                                        setEditingId(item.id);
                                        setEditingName(item.name);
                                        setEditingCategoryId(item.categoryId);
                                    }}
                                    className="p-2.5 text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
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

            {tools.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                    電動工具が登録されていません
                </div>
            )}
        </div>
    );
}
