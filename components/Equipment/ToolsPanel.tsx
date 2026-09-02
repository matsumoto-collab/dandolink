'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Wrench, Plus, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { useMasterStore } from '@/stores/masterStore';
import { toolStatusLabel } from '@/lib/equipment';
import { Button } from '@/components/ui/Button';
import { ToolDetailModal } from './ToolDetailModal';
import { EquipmentTool, ToolCategory, fmtDate, fmtYen } from './types';

const STATUS_STYLES: Record<string, string> = {
    in_stock: 'bg-slate-100 text-slate-600',
    checked_out: 'bg-teal-50 text-teal-700',
    repairing: 'bg-amber-50 text-amber-700',
    lost: 'bg-red-50 text-red-700',
    disposed: 'bg-slate-100 text-slate-400',
};

/** 機材台帳の「電動工具」タブ。 */
export function ToolsPanel({ canEdit }: { canEdit: boolean }) {
    const [categories, setCategories] = useState<ToolCategory[]>([]);
    const [tools, setTools] = useState<EquipmentTool[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [newTool, setNewTool] = useState({ categoryId: '', name: '', maker: '', modelNumber: '', purchaseDate: '', purchasePrice: '' });
    const [newCategory, setNewCategory] = useState('');

    const fetchTools = useCallback(async () => {
        try {
            const res = await fetch('/api/equipment/tools', { cache: 'no-store' });
            if (!res.ok) throw new Error('failed');
            const data = await res.json();
            setCategories(data.categories ?? []);
            setTools(data.tools ?? []);
        } catch (e) {
            logger.error('Failed to fetch equipment tools:', e);
            toast.error('電動工具の読み込みに失敗しました');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTools();
    }, [fetchTools]);

    // 台帳で工具を足した/変えたときは、スケジュールの選択肢（マスタ）にも反映する。
    // 自分の画面は再取得され、他の端末へは broadcast で伝わる。
    const notifyMasterDataChanged = useMasterStore((state) => state.notifyMasterDataChanged);
    const refreshAfterChange = useCallback(async () => {
        await fetchTools();
        await notifyMasterDataChanged('tool');
    }, [fetchTools, notifyMasterDataChanged]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return tools
            .filter((t) => (showInactive ? true : t.isActive))
            .filter((t) => (categoryId ? t.categoryId === categoryId : true))
            .filter((t) => {
                if (!q) return true;
                const hay = [t.name, t.maker, t.modelNumber, t.serialNumber, t.categoryName, t.holderName]
                    .filter(Boolean).join(' ').toLowerCase();
                return hay.includes(q);
            });
    }, [tools, query, categoryId, showInactive]);

    const addCategory = async () => {
        const name = newCategory.trim();
        if (!name) return;
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
            const created: ToolCategory = await res.json();
            setCategories((prev) => [...prev, created]);
            setNewTool((p) => ({ ...p, categoryId: created.id }));
            setNewCategory('');
            toast.success('分類を追加しました');
        } catch (e) {
            logger.error('Failed to add tool category:', e);
            toast.error(e instanceof Error ? e.message : '追加に失敗しました');
        }
    };

    const addTool = async () => {
        if (!newTool.categoryId) {
            toast.error('分類を選んでください');
            return;
        }
        if (!newTool.name.trim()) {
            toast.error('名前（管理番号）を入力してください');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/equipment/tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTool),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '登録に失敗しました');
            }
            toast.success('電動工具を登録しました');
            setAddOpen(false);
            setNewTool({ categoryId: '', name: '', maker: '', modelNumber: '', purchaseDate: '', purchasePrice: '' });
            await refreshAfterChange();
        } catch (e) {
            logger.error('Failed to add tool:', e);
            toast.error(e instanceof Error ? e.message : '登録に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const selected = tools.find((t) => t.id === selectedId) ?? null;

    return (
        <div>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="名前・メーカー・型番・使用者で検索"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
                <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                    <option value="">すべての分類</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
                    <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                    />
                    使わなくなった工具も表示
                </label>
                <button
                    type="button"
                    onClick={fetchTools}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                    <RefreshCw className="h-4 w-4" />
                    更新
                </button>
                {canEdit && (
                    <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen((v) => !v)}>
                        工具を追加
                    </Button>
                )}
            </div>

            {addOpen && canEdit && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">電動工具を追加</span>
                        <button type="button" onClick={() => setAddOpen(false)} className="text-slate-400 hover:text-slate-600">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="text-xs text-slate-600">
                            分類
                            <select
                                value={newTool.categoryId}
                                onChange={(e) => setNewTool((p) => ({ ...p, categoryId: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            >
                                <option value="">選択してください</option>
                                {categories.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-xs text-slate-600">
                            名前・管理番号
                            <input
                                type="text"
                                value={newTool.name}
                                onChange={(e) => setNewTool((p) => ({ ...p, name: e.target.value }))}
                                placeholder="例: インパクト#1"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600">
                            メーカー
                            <input
                                type="text"
                                value={newTool.maker}
                                onChange={(e) => setNewTool((p) => ({ ...p, maker: e.target.value }))}
                                placeholder="例: マキタ"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600">
                            型番
                            <input
                                type="text"
                                value={newTool.modelNumber}
                                onChange={(e) => setNewTool((p) => ({ ...p, modelNumber: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600">
                            購入日
                            <input
                                type="date"
                                value={newTool.purchaseDate}
                                onChange={(e) => setNewTool((p) => ({ ...p, purchaseDate: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600">
                            購入金額（税込）
                            <input
                                type="text"
                                inputMode="numeric"
                                value={newTool.purchasePrice}
                                onChange={(e) => setNewTool((p) => ({ ...p, purchasePrice: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-end">
                        <label className="min-w-0 flex-1 text-xs text-slate-600">
                            分類が無いときはここで追加
                            <input
                                type="text"
                                value={newCategory}
                                onChange={(e) => setNewCategory(e.target.value)}
                                placeholder="例: 丸ノコ"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <Button variant="secondary" size="sm" onClick={addCategory} disabled={!newCategory.trim()}>分類を追加</Button>
                    </div>

                    <div className="mt-3 flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setAddOpen(false)}>キャンセル</Button>
                        <Button variant="primary" size="sm" onClick={addTool} isLoading={saving}>登録</Button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="py-16 text-center text-slate-500">読み込み中...</div>
            ) : visible.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-500">
                    {tools.length === 0 ? 'まだ電動工具が登録されていません' : '該当する工具がありません'}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setSelectedId(t.id)}
                            className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-md"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <Wrench className="h-4 w-4 shrink-0 text-slate-400" />
                                        <span className="truncate font-medium text-slate-800">{t.name}</span>
                                        {!t.isActive && (
                                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">未使用</span>
                                        )}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-slate-500">
                                        {[t.categoryName, t.maker, t.modelNumber].filter(Boolean).join('　')}
                                    </div>
                                </div>
                                <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${STATUS_STYLES[t.status] ?? 'bg-slate-100 text-slate-600'}`}>
                                    {toolStatusLabel(t.status)}
                                </span>
                            </div>

                            {t.status === 'checked_out' && (
                                <div className="mt-2 text-xs text-teal-700">
                                    {t.holderName || '（使用者不明）'}
                                    {t.projectName ? ` / ${t.projectName}` : t.destinationNote ? ` / ${t.destinationNote}` : ''}
                                </div>
                            )}

                            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                                <span>
                                    整備 {t.maintenance.count}件
                                    {t.maintenance.lastDate ? `（最終 ${fmtDate(t.maintenance.lastDate)}）` : ''}
                                </span>
                                <span className="font-medium text-slate-700">{fmtYen(t.maintenance.totalAmount)}</span>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {selected && (
                <ToolDetailModal
                    tool={selected}
                    categories={categories}
                    canEdit={canEdit}
                    onClose={() => setSelectedId(null)}
                    onChanged={refreshAfterChange}
                />
            )}
        </div>
    );
}
