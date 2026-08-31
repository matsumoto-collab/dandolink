'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, Edit, Plus, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';

type ItemType = 'toggle' | 'segment' | 'text';

/** 項目の追加/編集フォームの入力値。defaultValue は新規案件の初期値（null=既定値なし）。 */
interface ItemDraft {
    name: string;
    type: ItemType;
    options: string;
    hasText: boolean;
    defaultValue: boolean | string | null;
}

interface SpecItem {
    id: string;
    groupId: string;
    name: string;
    type: ItemType;
    options: string[] | null;
    hasText: boolean;
    /** 新規案件を開いたときの初期値（null = 既定値なし）。 */
    defaultValue: boolean | string | null;
    legacyKey: string | null;
    sortOrder: number;
    isActive: boolean;
}

interface SpecGroup {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    items: SpecItem[];
}

/**
 * 「既定値」の入力欄。新規案件を開いたときに最初から入っている値を決める。
 * 項目タイプごとに入力の形を変える（toggle=あり/なし、segment=選択肢、text=自由入力）。
 */
function DefaultValueInput({
    draft,
    onChange,
}: {
    draft: ItemDraft;
    onChange: (v: boolean | string | null) => void;
}) {
    if (draft.type === 'toggle') {
        return (
            <select
                value={draft.defaultValue === true ? 'true' : 'none'}
                onChange={(e) => onChange(e.target.value === 'true' ? true : null)}
                title="新規案件を開いたときの初期値"
                className="px-2 py-1 border border-slate-300 rounded text-sm"
            >
                <option value="none">既定値なし</option>
                <option value="true">既定: 必要</option>
            </select>
        );
    }
    if (draft.type === 'segment') {
        const opts = draft.options.split(',').map((o) => o.trim()).filter(Boolean);
        return (
            <select
                value={typeof draft.defaultValue === 'string' ? draft.defaultValue : ''}
                onChange={(e) => onChange(e.target.value || null)}
                title="新規案件を開いたときの初期値"
                className="px-2 py-1 border border-slate-300 rounded text-sm"
            >
                <option value="">既定値なし</option>
                {opts.map((o) => (
                    <option key={o} value={o}>{`既定: ${o}`}</option>
                ))}
            </select>
        );
    }
    return (
        <input
            value={typeof draft.defaultValue === 'string' ? draft.defaultValue : ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="既定値（空=なし）"
            title="新規案件を開いたときの初期値"
            className="w-32 px-2 py-1 border border-slate-300 rounded text-sm"
        />
    );
}

export default function ScaffoldingSpecSettings() {
    const [groups, setGroups] = useState<SpecGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    // group form state
    const [newGroupName, setNewGroupName] = useState('');
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingGroupName, setEditingGroupName] = useState('');

    // item form state: groupId -> form
    const [itemForm, setItemForm] = useState<Record<string, ItemDraft>>({});
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<ItemDraft>({ name: '', type: 'toggle', options: '', hasText: false, defaultValue: null });

    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch('/api/master-data/scaffolding-spec-groups');
            if (!res.ok) throw new Error();
            const data = await res.json();
            setGroups(data);
            const initExpanded: Record<string, boolean> = {};
            data.forEach((g: SpecGroup) => { initExpanded[g.id] = true; });
            setExpanded((prev) => ({ ...initExpanded, ...prev }));
        } catch {
            toast.error('足場仕様マスターの取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ---- group CRUD ----
    const addGroup = async () => {
        if (!newGroupName.trim()) return;
        const res = await fetch('/api/master-data/scaffolding-spec-groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newGroupName.trim() }),
        });
        if (res.ok) { toast.success('グループを追加しました'); setNewGroupName(''); fetchData(); }
        else toast.error('追加に失敗しました');
    };

    const saveGroup = async (id: string) => {
        if (!editingGroupName.trim()) return;
        const res = await fetch(`/api/master-data/scaffolding-spec-groups/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editingGroupName.trim() }),
        });
        if (res.ok) { toast.success('更新しました'); setEditingGroupId(null); fetchData(); }
        else toast.error('更新に失敗しました');
    };

    const deleteGroup = async (id: string) => {
        const res = await fetch(`/api/master-data/scaffolding-spec-groups/${id}`, { method: 'DELETE' });
        if (res.ok) { toast.success('削除しました'); setConfirmDelete(null); fetchData(); }
        else toast.error('削除に失敗しました');
    };

    // ---- item CRUD ----
    const getForm = (groupId: string): ItemDraft => itemForm[groupId] ?? { name: '', type: 'toggle' as ItemType, options: '', hasText: false, defaultValue: null };
    const setForm = (groupId: string, patch: Partial<ItemDraft>) => {
        setItemForm((prev) => ({ ...prev, [groupId]: { ...getForm(groupId), ...patch } }));
    };

    const addItem = async (groupId: string) => {
        const f = getForm(groupId);
        if (!f.name.trim()) return;
        const body: {
            groupId: string; name: string; type: ItemType;
            options?: string[]; hasText?: boolean; defaultValue?: boolean | string | null;
        } = {
            groupId,
            name: f.name.trim(),
            type: f.type,
            hasText: f.type !== 'text' ? f.hasText : false,
            defaultValue: f.defaultValue,
        };
        if (f.type === 'segment') {
            const opts = f.options.split(',').map((s) => s.trim()).filter(Boolean);
            if (opts.length === 0) { toast.error('選択肢をカンマ区切りで入力してください'); return; }
            body.options = opts;
        }
        const res = await fetch('/api/master-data/scaffolding-spec-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.ok) { toast.success('項目を追加しました'); setItemForm((p) => ({ ...p, [groupId]: { name: '', type: 'toggle', options: '', hasText: false, defaultValue: null } })); fetchData(); }
        else toast.error('追加に失敗しました');
    };

    const startEditItem = (item: SpecItem) => {
        setEditingItemId(item.id);
        setEditingItem({
            name: item.name,
            type: item.type,
            options: item.options ? item.options.join(', ') : '',
            hasText: !!item.hasText,
            defaultValue: item.defaultValue ?? null,
        });
    };

    const saveItem = async (id: string) => {
        if (!editingItem.name.trim()) return;
        const body: {
            name: string; type: ItemType;
            options?: string[]; hasText?: boolean; defaultValue?: boolean | string | null;
        } = {
            name: editingItem.name.trim(),
            type: editingItem.type,
            hasText: editingItem.type !== 'text' ? editingItem.hasText : false,
            defaultValue: editingItem.defaultValue,
        };
        if (editingItem.type === 'segment') {
            const opts = editingItem.options.split(',').map((s) => s.trim()).filter(Boolean);
            if (opts.length === 0) { toast.error('選択肢を入力してください'); return; }
            body.options = opts;
        }
        const res = await fetch(`/api/master-data/scaffolding-spec-items/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.ok) { toast.success('更新しました'); setEditingItemId(null); fetchData(); }
        else toast.error('更新に失敗しました');
    };

    const deleteItem = async (id: string) => {
        const res = await fetch(`/api/master-data/scaffolding-spec-items/${id}`, { method: 'DELETE' });
        if (res.ok) { toast.success('削除しました'); setConfirmDelete(null); fetchData(); }
        else toast.error('削除に失敗しました');
    };

    if (loading) {
        return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700" /></div>;
    }

    return (
        <div className="min-w-0 overflow-hidden">
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-900">足場仕様マスター</h3>
                <p className="text-sm text-slate-500 mt-1">案件登録時に表示される足場仕様の項目・グループを管理します</p>
                <p className="text-xs text-slate-500 mt-1.5">
                    「既定値」を設定すると、新規案件を開いた時点でその値が入った状態になります（毎回同じ項目の入力を省けます）。
                    案件ごとに変わる組み合わせは、案件登録画面の「テンプレート」で保存・呼び出しできます。
                </p>
            </div>

            {/* 新規グループ追加 */}
            <div className="mb-6 flex flex-col md:flex-row gap-2">
                <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addGroup()}
                    placeholder="新しいグループを追加"
                    className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <button onClick={addGroup} className="px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" />グループ追加
                </button>
            </div>

            <div className="space-y-4">
                {groups.map((group) => (
                    <div key={group.id} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                        {/* group header */}
                        <div className="flex items-center gap-2 p-3 bg-slate-50 border-b border-slate-200">
                            <button
                                type="button"
                                onClick={() => setExpanded((p) => ({ ...p, [group.id]: !p[group.id] }))}
                                className="p-1 hover:bg-slate-200 rounded"
                            >
                                {expanded[group.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            {editingGroupId === group.id ? (
                                <>
                                    <input
                                        value={editingGroupName}
                                        onChange={(e) => setEditingGroupName(e.target.value)}
                                        className="flex-1 px-2 py-1 border border-slate-300 rounded"
                                    />
                                    <button onClick={() => saveGroup(group.id)} className="p-2 text-slate-600 hover:bg-slate-100 rounded"><Check className="w-4 h-4" /></button>
                                    <button onClick={() => setEditingGroupId(null)} className="p-2 text-slate-600 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 font-semibold text-slate-800">{group.name}</span>
                                    <span className="text-xs text-slate-500">{group.items.length}項目</span>
                                    <button onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }} className="p-2 text-slate-700 hover:bg-slate-100 rounded"><Edit className="w-4 h-4" /></button>
                                    {confirmDelete === `g:${group.id}` ? (
                                        <div className="flex gap-1">
                                            <button onClick={() => deleteGroup(group.id)} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">削除</button>
                                            <button onClick={() => setConfirmDelete(null)} className="px-3 py-1 text-xs bg-slate-300 rounded">取消</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setConfirmDelete(`g:${group.id}`)} className="p-2 text-slate-600 hover:bg-slate-100 rounded"><Trash2 className="w-4 h-4" /></button>
                                    )}
                                </>
                            )}
                        </div>

                        {expanded[group.id] && (
                            <div className="p-3 space-y-2">
                                {/* items */}
                                {group.items.map((item) => (
                                    <div key={item.id} className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg">
                                        {editingItemId === item.id ? (
                                            <>
                                                <input
                                                    value={editingItem.name}
                                                    onChange={(e) => setEditingItem((p) => ({ ...p, name: e.target.value }))}
                                                    placeholder="項目名"
                                                    className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-sm"
                                                />
                                                <select
                                                    value={editingItem.type}
                                                    onChange={(e) => setEditingItem((p) => ({ ...p, type: e.target.value as ItemType }))}
                                                    className="px-2 py-1 border border-slate-300 rounded text-sm"
                                                >
                                                    <option value="toggle">必要/不要</option>
                                                    <option value="segment">選択肢</option>
                                                    <option value="text">テキスト</option>
                                                </select>
                                                {editingItem.type === 'segment' && (
                                                    <input
                                                        value={editingItem.options}
                                                        onChange={(e) => setEditingItem((p) => ({ ...p, options: e.target.value }))}
                                                        placeholder="例: 1本, 2本"
                                                        className="w-40 px-2 py-1 border border-slate-300 rounded text-sm"
                                                    />
                                                )}
                                                {editingItem.type !== 'text' && (
                                                    <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingItem.hasText}
                                                            onChange={(e) => setEditingItem((p) => ({ ...p, hasText: e.target.checked }))}
                                                        />
                                                        +テキスト
                                                    </label>
                                                )}
                                                <DefaultValueInput
                                                    draft={editingItem}
                                                    onChange={(v) => setEditingItem((p) => ({ ...p, defaultValue: v }))}
                                                />
                                                <button onClick={() => saveItem(item.id)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"><Check className="w-4 h-4" /></button>
                                                <button onClick={() => setEditingItemId(null)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                                            </>
                                        ) : (
                                            <>
                                                <span className="flex-1 text-sm text-slate-800">{item.name}</span>
                                                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                                    {item.type === 'toggle' ? '必要/不要' : item.type === 'segment' ? `選択: ${item.options?.join('/')}` : 'テキスト'}
                                                    {item.hasText && item.type !== 'text' && ' +テキスト'}
                                                </span>
                                                {item.defaultValue !== null && item.defaultValue !== undefined && item.defaultValue !== '' && (
                                                    <span
                                                        className="whitespace-nowrap rounded bg-teal-50 px-2 py-0.5 text-xs text-teal-700"
                                                        title="新規案件を開いたときに最初から入っている値"
                                                    >
                                                        既定: {item.defaultValue === true ? '必要' : String(item.defaultValue)}
                                                    </span>
                                                )}
                                                <button onClick={() => startEditItem(item)} className="p-1.5 text-slate-700 hover:bg-slate-100 rounded"><Edit className="w-4 h-4" /></button>
                                                {confirmDelete === `i:${item.id}` ? (
                                                    <div className="flex gap-1">
                                                        <button onClick={() => deleteItem(item.id)} className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">削除</button>
                                                        <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-xs bg-slate-300 rounded">取消</button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setConfirmDelete(`i:${item.id}`)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"><Trash2 className="w-4 h-4" /></button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}

                                {/* add item form */}
                                <div className="flex items-center gap-2 p-2 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                                    <input
                                        value={getForm(group.id).name}
                                        onChange={(e) => setForm(group.id, { name: e.target.value })}
                                        placeholder="項目名"
                                        className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-sm"
                                    />
                                    <select
                                        value={getForm(group.id).type}
                                        onChange={(e) => setForm(group.id, { type: e.target.value as ItemType })}
                                        className="px-2 py-1 border border-slate-300 rounded text-sm"
                                    >
                                        <option value="toggle">必要/不要</option>
                                        <option value="segment">選択肢</option>
                                        <option value="text">テキスト</option>
                                    </select>
                                    {getForm(group.id).type === 'segment' && (
                                        <input
                                            value={getForm(group.id).options}
                                            onChange={(e) => setForm(group.id, { options: e.target.value })}
                                            placeholder="例: 1本, 2本"
                                            className="w-40 px-2 py-1 border border-slate-300 rounded text-sm"
                                        />
                                    )}
                                    {getForm(group.id).type !== 'text' && (
                                        <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
                                            <input
                                                type="checkbox"
                                                checked={getForm(group.id).hasText}
                                                onChange={(e) => setForm(group.id, { hasText: e.target.checked })}
                                            />
                                            +テキスト
                                        </label>
                                    )}
                                    <DefaultValueInput
                                        draft={getForm(group.id)}
                                        onChange={(v) => setForm(group.id, { defaultValue: v })}
                                    />
                                    <button onClick={() => addItem(group.id)} className="px-3 py-1 bg-teal-600 text-white rounded text-xs flex items-center gap-1">
                                        <Plus className="w-3 h-3" />追加
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {groups.length === 0 && (
                    <div className="text-center py-12 text-slate-500">グループが登録されていません</div>
                )}
            </div>
        </div>
    );
}
