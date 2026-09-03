'use client';

import React, { useMemo, useState } from 'react';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { toolCategoryHardDeleteBlockers, toolCategorySoftDeleteBlockers } from '@/lib/equipment';
import { Button } from '@/components/ui/Button';
import { EquipmentTool, ToolCategory } from './types';

interface Props {
    categories: ToolCategory[];
    /** 台数を数えるための工具一覧（一覧APIが返す全件＝台帳から外した分も含む） */
    tools: EquipmentTool[];
    onClose: () => void;
    onChanged: () => void | Promise<void>;
}

/**
 * 電動工具の「分類」の追加・削除。
 * 削除は2種類：
 * - 一覧から外す（isActive=false）… 使っている工具が残っている分類はできない
 * - 完全に削除… Tool.categoryId は必須なので、外した工具も含めて0台のときだけできる
 */
export function ToolCategoryManagerModal({ categories, tools, onClose, onChanged }: Props) {
    const [newName, setNewName] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);

    const rows = useMemo(() => {
        return categories.map((c) => {
            const counts = {
                activeToolCount: tools.filter((t) => t.categoryId === c.id && t.isActive).length,
                inactiveToolCount: tools.filter((t) => t.categoryId === c.id && !t.isActive).length,
            };
            return {
                category: c,
                ...counts,
                softBlockers: toolCategorySoftDeleteBlockers(counts),
                hardBlockers: toolCategoryHardDeleteBlockers(counts),
            };
        });
    }, [categories, tools]);

    const addCategory = async () => {
        const name = newName.trim();
        if (!name) return;
        setAdding(true);
        try {
            const res = await fetch('/api/equipment/tool-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '追加に失敗しました');
            }
            setNewName('');
            toast.success('分類を追加しました');
            await onChanged();
        } catch (e) {
            logger.error('Failed to add tool category:', e);
            toast.error(e instanceof Error ? e.message : '追加に失敗しました');
        } finally {
            setAdding(false);
        }
    };

    const call = async (id: string, url: string, init: RequestInit, successMessage: string, failMessage: string) => {
        setBusyId(id);
        try {
            const res = await fetch(url, init);
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || failMessage);
            }
            toast.success(successMessage);
            await onChanged();
        } catch (e) {
            logger.error('Failed to update tool category:', e);
            toast.error(e instanceof Error ? e.message : failMessage);
        } finally {
            setBusyId(null);
        }
    };

    const softDelete = (c: ToolCategory) => {
        if (!window.confirm(`分類「${c.name}」を一覧から外します。\n工具の登録・絞り込みの選択肢から消えます。よろしいですか？`)) return;
        call(c.id, `/api/equipment/tool-categories/${c.id}`, { method: 'DELETE' }, '一覧から外しました', '外せませんでした');
    };

    const hardDelete = (c: ToolCategory) => {
        if (!window.confirm(`分類「${c.name}」を完全に削除します。\n元に戻せません。よろしいですか？`)) return;
        call(c.id, `/api/equipment/tool-categories/${c.id}?mode=hard`, { method: 'DELETE' }, '完全に削除しました', '削除できませんでした');
    };

    const restore = (c: ToolCategory) => {
        call(
            c.id,
            `/api/equipment/tool-categories/${c.id}`,
            { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: true }) },
            '一覧に戻しました',
            '戻せませんでした',
        );
    };

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            <div
                role="dialog"
                aria-modal="true"
                className="relative bg-white flex flex-col w-full h-full lg:h-auto lg:max-h-[85vh] lg:rounded-lg lg:shadow-xl lg:max-w-xl lg:mx-4"
            >
                <div className="flex-shrink-0 border-b border-slate-200 px-4 py-4 md:px-6 lg:rounded-t-lg">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-sm text-slate-500">機材台帳（電動工具）</div>
                            <h2 className="text-xl font-semibold text-slate-800">分類の管理</h2>
                        </div>
                        <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
                    <div className="mb-4 flex gap-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') addCategory();
                            }}
                            placeholder="分類を追加（例: 丸ノコ）"
                            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={addCategory} isLoading={adding} disabled={!newName.trim()}>
                            追加
                        </Button>
                    </div>

                    {rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
                            まだ分類がありません
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {rows.map(({ category, activeToolCount, inactiveToolCount, softBlockers, hardBlockers }) => (
                                <div key={category.id} className="rounded-lg border border-slate-200 bg-white p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate font-medium text-slate-800">{category.name}</span>
                                                {!category.isActive && (
                                                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">一覧から外し済み</span>
                                                )}
                                            </div>
                                            <div className="mt-0.5 text-xs text-slate-500">
                                                工具 {activeToolCount}台
                                                {inactiveToolCount > 0 ? `（台帳から外した分 ${inactiveToolCount}台）` : ''}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            {category.isActive ? (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => softDelete(category)}
                                                    disabled={busyId === category.id || softBlockers.length > 0}
                                                >
                                                    一覧から外す
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    leftIcon={<RotateCcw className="h-4 w-4" />}
                                                    onClick={() => restore(category)}
                                                    disabled={busyId === category.id}
                                                >
                                                    一覧に戻す
                                                </Button>
                                            )}
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                leftIcon={<Trash2 className="h-4 w-4" />}
                                                onClick={() => hardDelete(category)}
                                                disabled={busyId === category.id || hardBlockers.length > 0}
                                            >
                                                完全に削除
                                            </Button>
                                        </div>
                                    </div>
                                    {hardBlockers.length > 0 && (
                                        <p className="mt-1.5 text-[11px] text-slate-500">
                                            {softBlockers.length > 0
                                                ? `${softBlockers[0]}。先に工具を台帳から外すと、この分類も一覧から外せます`
                                                : `${hardBlockers[0]}。完全に削除するには、その工具を先に完全に削除してください`}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-shrink-0 border-t border-slate-200 px-4 py-3 md:px-6 lg:rounded-b-lg">
                    <div className="flex justify-end">
                        <Button variant="secondary" onClick={onClose}>閉じる</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
