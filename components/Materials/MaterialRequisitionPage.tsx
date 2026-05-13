'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMaterialData } from '@/hooks/useMaterialData';
import { useSession } from 'next-auth/react';
import { Plus, FileText, ChevronDown, ChevronRight, Minus, Copy, Trash2, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import type { MaterialCategoryWithItems, MaterialItemWithStock, MaterialRequisition } from '@/types/material';

// 日付フォーマット
function formatDate(d: string | Date) {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}
function toDateInputValue(d?: Date) {
    const date = d || new Date();
    return date.toISOString().split('T')[0];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    draft: { label: '下書き', color: 'bg-slate-200 text-slate-700' },
    confirmed: { label: '確定', color: 'bg-blue-100 text-blue-800' },
    loaded: { label: '積込完了', color: 'bg-green-100 text-green-800' },
};

export default function MaterialRequisitionPage() {
    const { categories, fetchCategories, isCategoriesInitialized, fetchRequisitions, requisitions, isRequisitionsLoading, createRequisition, updateRequisition, deleteRequisition } = useMaterialData();
    const { data: session } = useSession();

    const [view, setView] = useState<'list' | 'create'>('list');
    const [projectMasters, setProjectMasters] = useState<Array<{ id: string; title: string; name: string | null }>>([]);
    const [foremen, setForemen] = useState<Array<{ id: string; displayName: string }>>([]);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Form state
    const [formProjectId, setFormProjectId] = useState('');
    const [formDate, setFormDate] = useState(toDateInputValue());
    const [formForemanId, setFormForemanId] = useState('');
    const [formForemanName, setFormForemanName] = useState('');
    const [formVehicleInfo, setFormVehicleInfo] = useState('');
    const [formNotes, setFormNotes] = useState('');
    const [formQuantities, setFormQuantities] = useState<Record<string, number>>({});
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [isSaving, setIsSaving] = useState(false);

    // A2: 横断検索
    const [searchQuery, setSearchQuery] = useState('');

    // A6: 自動下書き保存
    const [autoSavedId, setAutoSavedId] = useState<string | null>(null);
    const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipAutoSaveRef = useRef(false);
    const autoSaveDisabledRef = useRef(false);

    // Load data
    useEffect(() => {
        if (!isCategoriesInitialized) fetchCategories();
        fetchRequisitions();
        // Fetch project masters and foremen
        fetch('/api/project-masters?status=active', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : [])
            .then(data => setProjectMasters(Array.isArray(data) ? data : data.projectMasters || []));
        fetch('/api/dispatch/foremen', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : [])
            .then(data => setForemen(data));
    }, []);

    // Set default foreman
    useEffect(() => {
        if (session?.user?.id && foremen.length > 0 && !formForemanId) {
            const self = foremen.find(f => f.id === session.user.id);
            if (self) {
                setFormForemanId(self.id);
                setFormForemanName(self.displayName);
            }
        }
    }, [session, foremen]);

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const expandAll = () => {
        setExpandedCategories(new Set(categories.map(c => c.id)));
    };

    const updateQuantity = (itemId: string, delta: number) => {
        setFormQuantities(prev => {
            const current = prev[itemId] || 0;
            const next = Math.max(0, current + delta);
            if (next === 0) {
                const { [itemId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: next };
        });
    };

    const setQuantity = (itemId: string, value: number) => {
        setFormQuantities(prev => {
            if (value <= 0) {
                const { [itemId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: value };
        });
    };

    const resetForm = () => {
        setFormProjectId('');
        setFormDate(toDateInputValue());
        setFormVehicleInfo('');
        setFormNotes('');
        setFormQuantities({});
        setSearchQuery('');
        setAutoSavedId(null);
        setAutoSaveStatus('idle');
        setAutoSavedAt(null);
        setAutoSaveErrorReason('');
        autoSaveDisabledRef.current = false;
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
    };

    // A6: 自動下書き保存
    const formatSavedTime = (d: Date) => {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    };
    const [autoSaveErrorReason, setAutoSaveErrorReason] = useState<string>('');

    // 30秒間入力操作がなければ下書きを自動保存する。
    // formQuantities をdepsに含めることで、数量変更ごとにタイマーがリセットされ debounce として機能する。
    useEffect(() => {
        // create view 以外、または手動操作後はスキップ
        if (view !== 'create') return;
        if (skipAutoSaveRef.current) {
            skipAutoSaveRef.current = false;
            return;
        }
        if (autoSaveDisabledRef.current) return;

        // 条件: projectMasterId と foremanId 両方セット、品目1つ以上
        if (!formProjectId || !formForemanId) return;
        const items = Object.entries(formQuantities)
            .filter(([, qty]) => qty > 0)
            .map(([materialItemId, quantity]) => ({ materialItemId, quantity }));
        if (items.length === 0) return;

        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

        autoSaveTimerRef.current = setTimeout(async () => {
            try {
                setAutoSaveStatus('saving');
                if (!autoSavedId) {
                    const created = await createRequisition({
                        projectMasterId: formProjectId,
                        date: formDate,
                        foremanId: formForemanId,
                        foremanName: formForemanName,
                        type: '出庫',
                        status: 'draft',
                        vehicleInfo: formVehicleInfo || undefined,
                        notes: formNotes || undefined,
                        items,
                    });
                    if (created?.id) {
                        setAutoSavedId(created.id);
                        setAutoSavedAt(new Date());
                        setAutoSaveStatus('saved');
                        setAutoSaveErrorReason('');
                    } else {
                        setAutoSaveStatus('error');
                        setAutoSaveErrorReason('保存に失敗しました（再開には再読み込み）');
                        autoSaveDisabledRef.current = true;
                    }
                } else {
                    await updateRequisition(autoSavedId, {
                        status: 'draft',
                        vehicleInfo: formVehicleInfo || null,
                        notes: formNotes || null,
                        items,
                    });
                    setAutoSavedAt(new Date());
                    setAutoSaveStatus('saved');
                    setAutoSaveErrorReason('');
                }
            } catch (e) {
                setAutoSaveStatus('error');
                // 権限エラー等の継続失敗を避けるため以降は停止
                autoSaveDisabledRef.current = true;
                const err = e as Error & { status?: number };
                if (err?.status === 403) {
                    setAutoSaveErrorReason('権限不足で自動保存停止');
                    toast.error('権限不足のため自動保存を停止しました');
                } else {
                    setAutoSaveErrorReason('保存に失敗しました（再開には再読み込み）');
                    toast.error(err?.message || '自動保存に失敗しました');
                }
            }
        }, 30000);

        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
                autoSaveTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, formProjectId, formDate, formForemanId, formVehicleInfo, formNotes, formQuantities]);

    const handleSubmit = async (status: 'draft' | 'confirmed') => {
        if (!formProjectId) { toast.error('現場を選択してください'); return; }
        if (!formForemanId) { toast.error('職長を選択してください'); return; }

        const items = Object.entries(formQuantities)
            .filter(([, qty]) => qty > 0)
            .map(([materialItemId, quantity]) => ({ materialItemId, quantity }));

        if (items.length === 0) { toast.error('材料を1つ以上入力してください'); return; }

        // A6: 手動保存時は自動保存タイマーをクリア
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        autoSaveDisabledRef.current = true;

        setIsSaving(true);
        try {
            // 自動保存済みの伝票がある場合は更新、無ければ新規作成
            if (autoSavedId) {
                await updateRequisition(autoSavedId, {
                    status,
                    vehicleInfo: formVehicleInfo || null,
                    notes: formNotes || null,
                    items,
                });
            } else {
                await createRequisition({
                    projectMasterId: formProjectId,
                    date: formDate,
                    foremanId: formForemanId,
                    foremanName: formForemanName,
                    type: '出庫',
                    status,
                    vehicleInfo: formVehicleInfo || undefined,
                    notes: formNotes || undefined,
                    items,
                });
            }
            toast.success(status === 'draft' ? '下書きを保存しました' : '伝票を確定しました');
            resetForm();
            setView('list');
            fetchRequisitions();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
            autoSaveDisabledRef.current = false;
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopyRequisition = useCallback(async (req: MaterialRequisition) => {
        // Copy quantities from existing requisition
        const quantities: Record<string, number> = {};
        req.items?.forEach(item => {
            if (item.quantity > 0) {
                quantities[item.materialItemId] = item.quantity;
            }
        });
        // 自動保存関連 state を新規作成扱いにリセット
        // （前回伝票の autoSavedId を引きずらないように個別リセット）
        setAutoSavedId(null);
        setAutoSaveStatus('idle');
        setAutoSavedAt(null);
        setAutoSaveErrorReason('');
        autoSaveDisabledRef.current = false;
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        setFormQuantities(quantities);
        setFormProjectId(req.projectMasterId);
        setFormDate(toDateInputValue());
        setFormVehicleInfo(req.vehicleInfo || '');
        setFormNotes('');
        setSearchQuery('');
        expandAll();
        setView('create');
        toast.success('前回の伝票をコピーしました');
    }, [categories]);

    const handleStatusChange = async (id: string, newStatus: string) => {
        try {
            await updateRequisition(id, { status: newStatus });
            toast.success('ステータスを更新しました');
            fetchRequisitions();
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteRequisition(id);
            setDeleteConfirm(null);
            toast.success('削除しました');
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    const filledCount = Object.keys(formQuantities).length;

    // A2: 横断検索
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const searchResults = useMemo(() => {
        if (!trimmedQuery) return [];
        const rows: Array<{ categoryName: string; item: MaterialItemWithStock }> = [];
        for (const cat of categories) {
            if (!cat.items) continue;
            for (const item of cat.items) {
                const name = (item.name || '').toLowerCase();
                const spec = (item.spec || '').toLowerCase();
                if (name.includes(trimmedQuery) || spec.includes(trimmedQuery)) {
                    rows.push({ categoryName: cat.name, item });
                }
            }
        }
        return rows;
    }, [categories, trimmedQuery]);

    // A3: 入力済みサマリ
    const filledRows = useMemo(() => {
        if (filledCount === 0) return [];
        const rows: Array<{ categoryName: string; item: MaterialItemWithStock }> = [];
        for (const cat of categories) {
            if (!cat.items) continue;
            for (const item of cat.items) {
                if ((formQuantities[item.id] || 0) > 0) {
                    rows.push({ categoryName: cat.name, item });
                }
            }
        }
        return rows;
    }, [categories, formQuantities, filledCount]);

    // 数量入力UI（A1/A4/A5を適用）
    const renderQuantityControl = (item: MaterialItemWithStock) => {
        const qty = formQuantities[item.id] || 0;
        return (
            <div className="flex items-center gap-1">
                <button
                    onClick={() => updateQuantity(item.id, -1)}
                    className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                    aria-label="数量を減らす"
                >
                    <Minus className="w-4 h-4" />
                </button>
                <input
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min="0"
                    value={qty || ''}
                    onChange={(e) => setQuantity(item.id, parseInt(e.target.value) || 0)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-14 text-center px-1 py-1 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="0"
                />
                <button
                    onClick={() => updateQuantity(item.id, 1)}
                    className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                    aria-label="数量を増やす"
                >
                    <Plus className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-400 w-6">{item.unit}</span>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50">
            <div className="flex-1 overflow-y-auto">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-slate-800">材料出庫伝票</h1>
                    <p className="text-sm text-slate-500 mt-1">材料の出庫を管理します</p>
                </div>

                {/* View Toggle */}
                <div className="flex gap-2 mb-4 md:mb-6">
                    <Button
                        onClick={() => setView('list')}
                        variant={view === 'list' ? 'gradient' : 'secondary'}
                        size="md"
                        leftIcon={<FileText className="w-4 h-4" />}
                    >
                        伝票一覧
                    </Button>
                    <Button
                        onClick={() => { setView('create'); expandAll(); }}
                        variant={view === 'create' ? 'gradient' : 'secondary'}
                        size="md"
                        leftIcon={<Plus className="w-4 h-4" />}
                    >
                        新規作成
                    </Button>
                </div>

                {view === 'list' ? (
                    /* =================== LIST VIEW =================== */
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200">
                        <div className="p-3 md:p-6">
                            {isRequisitionsLoading ? (
                                <div className="text-center py-12 text-slate-500">読み込み中...</div>
                            ) : requisitions.length === 0 ? (
                                <div className="text-center py-12 text-slate-500">
                                    <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                                    <p>出庫伝票がありません</p>
                                    <button
                                        onClick={() => { setView('create'); expandAll(); }}
                                        className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 text-sm"
                                    >
                                        新規作成
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {requisitions.map((req) => {
                                        const statusInfo = STATUS_LABELS[req.status] || STATUS_LABELS.draft;
                                        const totalItems = req.items?.reduce((sum, i) => sum + i.quantity, 0) || 0;
                                        return (
                                            <div key={req.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-medium text-slate-900 truncate">{req.projectTitle}</span>
                                                        <span className={`px-2 py-0.5 text-xs rounded-full ${statusInfo.color}`}>
                                                            {statusInfo.label}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                                                        <span>{formatDate(req.date)}</span>
                                                        <span>{req.foremanName}</span>
                                                        <span>{totalItems}点</span>
                                                        {req.vehicleInfo && <span>{req.vehicleInfo}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {/* Status change */}
                                                    {req.status === 'draft' && (
                                                        <button
                                                            onClick={() => handleStatusChange(req.id, 'confirmed')}
                                                            className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-xl hover:bg-blue-200"
                                                        >
                                                            確定
                                                        </button>
                                                    )}
                                                    {req.status === 'confirmed' && (
                                                        <button
                                                            onClick={() => handleStatusChange(req.id, 'loaded')}
                                                            className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-xl hover:bg-green-200"
                                                        >
                                                            積込完了
                                                        </button>
                                                    )}
                                                    {/* Copy */}
                                                    <button
                                                        onClick={() => handleCopyRequisition(req)}
                                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                                                        title="コピーして新規作成"
                                                    >
                                                        <Copy className="w-4 h-4" />
                                                    </button>
                                                    {/* Delete */}
                                                    {deleteConfirm === req.id ? (
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleDelete(req.id)} className="px-2 py-1 text-xs bg-slate-700 text-white rounded-xl">削除</button>
                                                            <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 text-xs bg-slate-300 text-slate-700 rounded-xl">取消</button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => setDeleteConfirm(req.id)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* =================== CREATE VIEW =================== */
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200">
                        <div className="p-3 md:p-6 space-y-4">
                            {/* A6: 自動保存インジケータ */}
                            {(autoSaveStatus !== 'idle') && (
                                <div className="flex justify-end -mt-1">
                                    <span className={`text-xs px-2 py-1 rounded-lg ${
                                        autoSaveStatus === 'saving' ? 'bg-slate-100 text-slate-600' :
                                        autoSaveStatus === 'saved' ? 'bg-green-50 text-green-700' :
                                        'bg-red-50 text-red-700'
                                    }`}>
                                        {autoSaveStatus === 'saving' && '自動保存中...'}
                                        {autoSaveStatus === 'saved' && autoSavedAt && `下書き自動保存済 ${formatSavedTime(autoSavedAt)}`}
                                        {autoSaveStatus === 'error' && (autoSaveErrorReason || '自動保存に失敗')}
                                    </span>
                                </div>
                            )}

                            {/* Header fields */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">現場 *</label>
                                    <select
                                        value={formProjectId}
                                        onChange={(e) => setFormProjectId(e.target.value)}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    >
                                        <option value="">選択してください</option>
                                        {projectMasters.map(pm => (
                                            <option key={pm.id} value={pm.id}>{pm.name || pm.title}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">日付 *</label>
                                    <input
                                        type="date"
                                        value={formDate}
                                        onChange={(e) => setFormDate(e.target.value)}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">職長 *</label>
                                    <select
                                        value={formForemanId}
                                        onChange={(e) => {
                                            setFormForemanId(e.target.value);
                                            const f = foremen.find(f => f.id === e.target.value);
                                            setFormForemanName(f?.displayName || '');
                                        }}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    >
                                        <option value="">選択してください</option>
                                        {foremen.map(f => (
                                            <option key={f.id} value={f.id}>{f.displayName}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">車両情報</label>
                                    <input
                                        type="text"
                                        value={formVehicleInfo}
                                        onChange={(e) => setFormVehicleInfo(e.target.value)}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                        placeholder="例: 2tトラック、4tトラック"
                                    />
                                </div>
                            </div>

                            {/* Memo */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">備考</label>
                                <input
                                    type="text"
                                    value={formNotes}
                                    onChange={(e) => setFormNotes(e.target.value)}
                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    placeholder="メモ"
                                />
                            </div>

                            {/* Material Categories (Accordion) */}
                            <div className="border-t border-slate-200 pt-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-lg font-semibold text-slate-900">材料リスト</h3>
                                    <span className="text-sm text-slate-500">
                                        {filledCount}品目入力済
                                    </span>
                                </div>

                                {/* A2: 横断検索バー */}
                                <div className="relative mb-3">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="材料名検索..."
                                        className="w-full pl-9 pr-9 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-xl"
                                            aria-label="検索をクリア"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>

                                {/* A3: 入力済みサマリ（検索中は非表示） */}
                                {!trimmedQuery && filledRows.length > 0 && (
                                    <div className="mb-3 border border-slate-200 rounded-xl overflow-hidden">
                                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                            <span className="text-sm font-medium text-slate-700">入力済み ({filledRows.length}品目)</span>
                                        </div>
                                        <div className="bg-white divide-y divide-slate-100">
                                            {filledRows.map(({ categoryName, item }) => (
                                                <div
                                                    key={item.id}
                                                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-50"
                                                >
                                                    <span className="flex-1 text-sm text-slate-900 font-medium">
                                                        <span className="text-xs text-slate-500 mr-1">{categoryName}:</span>
                                                        {item.name}
                                                        {item.spec && <span className="text-xs text-slate-400 ml-1">{item.spec}</span>}
                                                    </span>
                                                    {renderQuantityControl(item)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {categories.length === 0 ? (
                                    <div className="text-center py-8 text-slate-500">
                                        材料マスターが登録されていません。設定画面で材料を追加してください。
                                    </div>
                                ) : trimmedQuery ? (
                                    /* A2: 検索結果リスト */
                                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                                        {searchResults.length === 0 ? (
                                            <div className="text-center py-8 text-slate-500 bg-white">
                                                該当する材料が見つかりません
                                            </div>
                                        ) : (
                                            <div className="bg-white divide-y divide-slate-100">
                                                {searchResults.map(({ categoryName, item }) => {
                                                    const qty = formQuantities[item.id] || 0;
                                                    return (
                                                        <div
                                                            key={item.id}
                                                            className={`flex items-center gap-2 px-4 py-2.5 ${qty > 0 ? 'bg-blue-50' : ''}`}
                                                        >
                                                            <span className={`flex-1 text-sm ${qty > 0 ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                                                                <span className="text-xs text-slate-500 mr-1">{categoryName}:</span>
                                                                {item.name}
                                                                {item.spec && <span className="text-xs text-slate-400 ml-1">{item.spec}</span>}
                                                            </span>
                                                            {renderQuantityControl(item)}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {categories.map((cat: MaterialCategoryWithItems) => {
                                            const catFilled = cat.items?.filter(i => (formQuantities[i.id] || 0) > 0).length || 0;
                                            const isExpanded = expandedCategories.has(cat.id);

                                            return (
                                                <div key={cat.id} className="border border-slate-200 rounded-xl overflow-hidden">
                                                    <button
                                                        onClick={() => toggleCategory(cat.id)}
                                                        className="w-full flex items-center gap-2 p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                                                    >
                                                        {isExpanded ? (
                                                            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                                                        ) : (
                                                            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                                                        )}
                                                        <span className="font-medium text-slate-900 flex-1">{cat.name}</span>
                                                        {catFilled > 0 && (
                                                            <span className="text-xs bg-slate-700 text-white px-2 py-0.5 rounded-full">
                                                                {catFilled}
                                                            </span>
                                                        )}
                                                    </button>

                                                    {isExpanded && cat.items && (
                                                        <div className="border-t border-slate-200 bg-white divide-y divide-slate-100">
                                                            {cat.items.map(item => {
                                                                const qty = formQuantities[item.id] || 0;
                                                                return (
                                                                    <div
                                                                        key={item.id}
                                                                        className={`flex items-center gap-2 px-4 py-2.5 ${qty > 0 ? 'bg-blue-50' : ''}`}
                                                                    >
                                                                        <span className={`flex-1 text-sm ${qty > 0 ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>
                                                                            {item.name}
                                                                        </span>
                                                                        {renderQuantityControl(item)}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Submit Buttons */}
                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button
                                    onClick={() => { resetForm(); setView('list'); }}
                                    className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium"
                                >
                                    キャンセル
                                </button>
                                <button
                                    onClick={() => handleSubmit('draft')}
                                    disabled={isSaving}
                                    className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium disabled:opacity-50"
                                >
                                    下書き保存
                                </button>
                                <button
                                    onClick={() => handleSubmit('confirmed')}
                                    disabled={isSaving}
                                    className="flex-1 px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 font-medium shadow-md hover:shadow-lg disabled:opacity-50"
                                >
                                    {isSaving ? '保存中...' : '確定して保存'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
