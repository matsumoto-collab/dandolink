'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { MapPin, ArrowBigUpDash, Check, PackageOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import type { LentOutItem } from '@/lib/materials/lentOut';
import QtyStepper from './ui/QtyStepper';

interface ProjectOption {
    id: string;
    title: string;
    name: string | null;
}

const projectLabel = (p: ProjectOption) => p.name || p.title;

/**
 * 材料返却画面。
 * 現場を選ぶ → その現場の貸出中（出庫 − 返却 − 紛失）が初期表示 →
 * 戻った数を確認・修正 → 返却を確定（POST /api/materials/returns）。
 * 既定は「全部返却」（返却数 = 出ている数）。減らせば部分返却で残りは貸出中。
 */
export default function MaterialReturnPage() {
    const searchParams = useSearchParams();
    const presetProjectId = searchParams?.get('projectId') ?? '';

    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>(presetProjectId);
    const [selectedProjectName, setSelectedProjectName] = useState<string>('');

    const [lentItems, setLentItems] = useState<LentOutItem[]>([]);
    const [returnQty, setReturnQty] = useState<Record<string, number>>({});
    const [isLoadingItems, setIsLoadingItems] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // アクティブ案件一覧（現場セレクタ用）
    useEffect(() => {
        fetch('/api/project-masters?status=active', { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : []))
            .then(data => {
                const list: ProjectOption[] = Array.isArray(data) ? data : data.projectMasters || [];
                setProjects(list);
            })
            .catch(() => setProjects([]));
    }, []);

    // 選択中現場の表示名を解決（一覧に無い完了案件などは単体取得）
    useEffect(() => {
        if (!selectedProjectId) {
            setSelectedProjectName('');
            return;
        }
        const found = projects.find(p => p.id === selectedProjectId);
        if (found) {
            setSelectedProjectName(projectLabel(found));
            return;
        }
        let cancelled = false;
        fetch(`/api/project-masters/${selectedProjectId}`, { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (cancelled || !data) return;
                setSelectedProjectName(data.name || data.title || '選択中の現場');
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [selectedProjectId, projects]);

    // 貸出中の取得（出ている数で返却数を初期化＝全部返却が既定）
    const fetchLentOut = useCallback(async (projectId: string) => {
        if (!projectId) {
            setLentItems([]);
            setReturnQty({});
            return;
        }
        setIsLoadingItems(true);
        try {
            const res = await fetch(`/api/project-masters/${projectId}/lent-out`, { cache: 'no-store' });
            if (res.ok) {
                const items: LentOutItem[] = await res.json();
                setLentItems(items);
                const initial: Record<string, number> = {};
                for (const it of items) initial[it.materialItemId] = it.lentOut;
                setReturnQty(initial);
            } else {
                toast.error('貸出中材料の取得に失敗しました');
            }
        } catch {
            toast.error('貸出中材料の取得に失敗しました');
        } finally {
            setIsLoadingItems(false);
        }
    }, []);

    useEffect(() => {
        fetchLentOut(selectedProjectId);
    }, [selectedProjectId, fetchLentOut]);

    const setQty = (item: LentOutItem, value: number) => {
        const clamped = Math.max(0, Math.min(value, item.lentOut));
        setReturnQty(prev => ({ ...prev, [item.materialItemId]: clamped }));
    };

    const returnAll = () => {
        const all: Record<string, number> = {};
        for (const it of lentItems) all[it.materialItemId] = it.lentOut;
        setReturnQty(all);
    };

    const totalReturn = lentItems.reduce((s, it) => s + (returnQty[it.materialItemId] ?? 0), 0);
    const totalRemaining = lentItems.reduce(
        (s, it) => s + (it.lentOut - (returnQty[it.materialItemId] ?? 0)),
        0,
    );

    const handleSubmit = async () => {
        if (!selectedProjectId) {
            toast.error('現場を選択してください');
            return;
        }
        const items = lentItems
            .map(it => ({ materialItemId: it.materialItemId, quantity: returnQty[it.materialItemId] ?? 0 }))
            .filter(it => it.quantity > 0);
        if (items.length === 0) {
            toast.error('返却する数量を入力してください');
            return;
        }
        setIsSaving(true);
        try {
            const res = await fetch('/api/materials/returns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectMasterId: selectedProjectId, items }),
            });
            if (res.ok) {
                toast.success('返却を記録しました（在庫に戻しました）');
                await fetchLentOut(selectedProjectId);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err.error || '返却の記録に失敗しました');
            }
        } catch {
            toast.error('返却の記録に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    // カテゴリ別グループ（API 側で sortOrder 整列済み）
    const groups: { categoryName: string; items: LentOutItem[] }[] = [];
    for (const it of lentItems) {
        const last = groups[groups.length - 1];
        if (last && last.categoryName === it.categoryName) last.items.push(it);
        else groups.push({ categoryName: it.categoryName, items: [it] });
    }

    return (
        <div className="max-w-3xl mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <ArrowBigUpDash className="w-6 h-6 text-teal-600" />
                    材料返却
                </h1>
                <p className="text-sm text-slate-500 mt-1">現場から戻った材料を記録して倉庫在庫に戻します</p>
            </div>

            {/* 現場選択 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
                <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-teal-600" />
                    返却する現場
                </label>
                <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm focus:ring-2 focus:ring-teal-500 shadow-sm bg-white"
                >
                    <option value="">現場を選択してください</option>
                    {/* 完了案件などディープリンク由来で一覧に無い現場も選択肢として残す */}
                    {selectedProjectId && !projects.some(p => p.id === selectedProjectId) && (
                        <option value={selectedProjectId}>{selectedProjectName || '選択中の現場'}</option>
                    )}
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{projectLabel(p)}</option>
                    ))}
                </select>
            </div>

            {/* 貸出中リスト */}
            {!selectedProjectId ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <MapPin className="w-10 h-10 mb-2" />
                    <p className="text-sm">現場を選ぶと貸出中の材料が表示されます</p>
                </div>
            ) : isLoadingItems ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500"></div>
                </div>
            ) : lentItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <PackageOpen className="w-10 h-10 mb-2" />
                    <p className="text-sm">この現場に貸出中の材料はありません</p>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-slate-500">
                            貸出中 <span className="text-base font-bold text-slate-900">{lentItems.length}</span> 品目
                        </span>
                        <button
                            onClick={returnAll}
                            className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-xl hover:bg-teal-100"
                        >
                            全部返却
                        </button>
                    </div>

                    <div className="space-y-3">
                        {groups.map(group => (
                            <div key={group.categoryName} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    <span>{group.categoryName}</span>
                                    <span className="font-normal text-slate-400">{group.items.length}品目</span>
                                </div>
                                {/* 列ヘッダ */}
                                <div className="grid grid-cols-[1.4fr_0.7fr_1.3fr_0.8fr] gap-2 items-center px-4 py-2 border-b border-slate-100 text-[11px] text-slate-400">
                                    <span>品目</span>
                                    <span className="text-center">出ている</span>
                                    <span className="text-center">返却</span>
                                    <span className="text-right">残り</span>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {group.items.map(it => {
                                        const qty = returnQty[it.materialItemId] ?? 0;
                                        const remaining = it.lentOut - qty;
                                        return (
                                            <div key={it.materialItemId} className="grid grid-cols-[1.4fr_0.7fr_1.3fr_0.8fr] gap-2 items-center px-4 py-2.5">
                                                <span className="text-sm text-slate-800">
                                                    {it.name}
                                                    {it.spec && <span className="text-xs text-slate-400 ml-1">({it.spec})</span>}
                                                </span>
                                                <span className="text-center text-sm text-slate-500">{it.lentOut}</span>
                                                <span className="flex items-center justify-center">
                                                    <QtyStepper
                                                        value={qty}
                                                        onChange={(v) => setQty(it, v)}
                                                        max={it.lentOut}
                                                    />
                                                </span>
                                                <span className="text-right">
                                                    {remaining <= 0 ? (
                                                        <span className="text-xs text-teal-600 font-medium">✓ 0</span>
                                                    ) : (
                                                        <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md font-medium">残{remaining}</span>
                                                    )}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* フッター（合計＋確定） */}
                    <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
                        <span className="text-xs text-slate-500">
                            返却 <span className="text-base font-bold text-slate-900">{totalReturn}</span> 点
                            {totalRemaining > 0 && (
                                <span className="ml-2 text-amber-600">／ 残り <span className="font-bold">{totalRemaining}</span> 点が未回収</span>
                            )}
                        </span>
                        <button
                            onClick={handleSubmit}
                            disabled={isSaving || totalReturn === 0}
                            className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-xl hover:shadow-md disabled:opacity-50"
                        >
                            <Check className="w-4 h-4" />
                            {isSaving ? '記録中...' : '返却を確定'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
