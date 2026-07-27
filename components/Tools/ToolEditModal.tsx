'use client';

import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { Button } from '@/components/ui/Button';
import { Tool, ToolCategory } from '@/types/tool';

interface ToolEditModalProps {
    /** null なら新規登録 */
    tool: Tool | null;
    categories: ToolCategory[];
    onClose: () => void;
    /** 保存・削除の後に一覧を取り直してもらう */
    onSaved: () => void;
}

/**
 * 工具そのものの登録・編集（管理者・マネージャーのみ）。
 * 状態と持出し先の変更は ToolStatusModal 側で行う。
 */
export default function ToolEditModal({ tool, categories, onClose, onSaved }: ToolEditModalProps) {
    const modalRef = useModalKeyboard(true, onClose);
    const isNew = tool === null;

    const [categoryId, setCategoryId] = useState(tool?.categoryId || categories[0]?.id || '');
    const [name, setName] = useState(tool?.name || '');
    const [note, setNote] = useState(tool?.note || '');
    const [isSaving, setIsSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('工具の名前を入力してください');
            return;
        }
        if (!categoryId) {
            toast.error('工具の種類を選択してください');
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch(isNew ? '/api/tools' : `/api/tools/${tool!.id}`, {
                method: isNew ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryId, name: name.trim(), note: note.trim() }),
            });
            if (res.ok) {
                toast.success(isNew ? '工具を登録しました' : '工具を更新しました');
                onSaved();
                onClose();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || (isNew ? '登録に失敗しました' : '更新に失敗しました'));
            }
        } catch {
            toast.error(isNew ? '登録に失敗しました' : '更新に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!tool) return;
        setIsSaving(true);
        try {
            const res = await fetch(`/api/tools/${tool.id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('工具を削除しました');
                onSaved();
                onClose();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || '削除に失敗しました');
            }
        } catch {
            toast.error('削除に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0">
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
            <div
                ref={modalRef}
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto lg:max-w-lg lg:mx-4 lg:rounded-xl lg:shadow-xl overflow-hidden outline-none"
            >
                <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-slate-200 shrink-0">
                    <h2 className="font-semibold text-slate-900">{isNew ? '工具を登録' : '工具を編集'}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">種類</label>
                        <select
                            value={categoryId}
                            onChange={(e) => setCategoryId(e.target.value)}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                        >
                            {categories.length === 0 && <option value="">（種類が未登録です）</option>}
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">管理番号・呼び名</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                            placeholder="例: #1、赤テープ"
                            autoFocus
                        />
                        <p className="text-xs text-slate-400 mt-1">同じ種類を複数台持っている場合の見分け方を入れてください</p>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">メモ（任意）</label>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
                            placeholder="例: 購入日、付属品の有無"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-3 border-t border-slate-200 shrink-0">
                    <div>
                        {!isNew && (
                            deleteConfirm ? (
                                <div className="flex items-center gap-1.5">
                                    <Button variant="danger" size="sm" onClick={handleDelete} disabled={isSaving}>削除する</Button>
                                    <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(false)}>やめる</Button>
                                </div>
                            ) : (
                                <Button
                                    variant="dangerOutline"
                                    size="sm"
                                    leftIcon={<Trash2 className="w-4 h-4" />}
                                    onClick={() => setDeleteConfirm(true)}
                                >
                                    削除
                                </Button>
                            )
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={onClose}>キャンセル</Button>
                        <Button onClick={handleSave} isLoading={isSaving}>{isNew ? '登録' : '保存'}</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
