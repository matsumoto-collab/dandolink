'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Edit, Plus, Check, X, GripVertical } from 'lucide-react';
import { COLOR_PALETTE, COLOR_PALETTE_NAMES, ConstructionTypeMaster } from '@/types/calendar';
import toast from 'react-hot-toast';

export default function ConstructionTypeSettings() {
    const [constructionTypes, setConstructionTypes] = useState<ConstructionTypeMaster[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingColor, setEditingColor] = useState('');
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState<string>(COLOR_PALETTE[0]);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [showColorPicker, setShowColorPicker] = useState<string | null>(null);

    // データ取得
    const fetchData = async () => {
        try {
            const res = await fetch('/api/master-data/construction-types');
            if (res.ok) {
                const data = await res.json();
                setConstructionTypes(data);
            }
        } catch (error) {
            console.error('Failed to fetch construction types:', error);
            toast.error('工事種別の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // 新規追加
    const handleAdd = async () => {
        if (!newName.trim()) return;

        try {
            const res = await fetch('/api/master-data/construction-types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim(), color: newColor }),
            });

            if (res.ok) {
                toast.success('工事種別を追加しました');
                setNewName('');
                setNewColor(COLOR_PALETTE[0]);
                fetchData();
            } else {
                toast.error('追加に失敗しました');
            }
        } catch (error) {
            console.error('Failed to add construction type:', error);
            toast.error('追加に失敗しました');
        }
    };

    // 編集開始
    const handleEdit = (item: ConstructionTypeMaster) => {
        setEditingId(item.id);
        setEditingName(item.name);
        setEditingColor(item.color);
    };

    // 編集保存
    const handleSaveEdit = async () => {
        if (!editingName.trim() || !editingId) return;

        try {
            const res = await fetch(`/api/master-data/construction-types/${editingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editingName.trim(), color: editingColor }),
            });

            if (res.ok) {
                toast.success('工事種別を更新しました');
                setEditingId(null);
                setEditingName('');
                setEditingColor('');
                fetchData();
            } else {
                toast.error('更新に失敗しました');
            }
        } catch (error) {
            console.error('Failed to update construction type:', error);
            toast.error('更新に失敗しました');
        }
    };

    // 編集キャンセル
    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingName('');
        setEditingColor('');
    };

    // 削除
    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/master-data/construction-types/${id}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                toast.success('工事種別を削除しました');
                setDeleteConfirm(null);
                fetchData();
            } else {
                toast.error('削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete construction type:', error);
            toast.error('削除に失敗しました');
        }
    };

    // 色選択コンポーネント
    const ColorPicker = ({
        selectedColor,
        onSelect,
        pickerId,
    }: {
        selectedColor: string;
        onSelect: (color: string) => void;
        pickerId: string;
    }) => (
        <div className="relative">
            <button
                type="button"
                onClick={() => setShowColorPicker(showColorPicker === pickerId ? null : pickerId)}
                className="w-8 h-8 rounded-lg border-2 border-gray-300 shadow-sm hover:shadow-md transition-shadow"
                style={{ backgroundColor: selectedColor }}
                title={COLOR_PALETTE_NAMES[selectedColor] || '色を選択'}
            />
            {showColorPicker === pickerId && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowColorPicker(null)}
                    />
                    <div className="absolute z-50 top-10 left-0 p-3 bg-white rounded-xl shadow-xl border border-gray-200 grid grid-cols-5 gap-2 w-[280px]">
                        {COLOR_PALETTE.map((color) => (
                            <button
                                key={color}
                                type="button"
                                onClick={() => {
                                    onSelect(color);
                                    setShowColorPicker(null);
                                }}
                                className={`group flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all hover:bg-gray-50 ${
                                    selectedColor === color ? 'bg-gray-100 ring-2 ring-slate-400' : ''
                                }`}
                                title={COLOR_PALETTE_NAMES[color]}
                            >
                                <div
                                    className={`w-10 h-10 rounded-lg border-2 transition-transform group-hover:scale-110 ${
                                        selectedColor === color ? 'border-slate-700 shadow-md' : 'border-gray-200'
                                    }`}
                                    style={{ backgroundColor: color }}
                                />
                                <span className="text-[9px] text-slate-500 leading-tight text-center whitespace-nowrap">
                                    {COLOR_PALETTE_NAMES[color]?.replace(/([a-zA-Z])/, '\n$1') || ''}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );

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
                    <h3 className="text-lg font-semibold text-slate-900">工事種別一覧</h3>
                    <p className="text-sm text-slate-500 mt-1">カレンダーに表示される工事種別と色を管理します</p>
                </div>
            </div>

            {/* 新規追加フォーム */}
            <div className="mb-6 flex gap-2 items-center">
                <ColorPicker
                    selectedColor={newColor}
                    onSelect={setNewColor}
                    pickerId="new"
                />
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="新しい工事種別を追加（例: 点検）"
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
                {constructionTypes.map((item) => (
                    <div
                        key={item.id}
                        className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                    >
                        {editingId === item.id ? (
                            <>
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <ColorPicker
                                    selectedColor={editingColor}
                                    onSelect={setEditingColor}
                                    pickerId={`edit-${item.id}`}
                                />
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
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <div
                                    className="w-6 h-6 rounded-md border border-gray-300"
                                    style={{ backgroundColor: item.color }}
                                />
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

            {constructionTypes.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p>工事種別が登録されていません</p>
                    <p className="text-sm mt-2">上のフォームから追加してください</p>
                </div>
            )}
        </div>
    );
}
