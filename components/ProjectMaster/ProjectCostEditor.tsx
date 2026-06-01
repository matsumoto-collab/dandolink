'use client';

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Calculator, Plus, Save, Trash2 } from 'lucide-react';
import { logger } from '@/lib/logger';
import { formatCurrency } from '@/utils/costCalculation';
import { useMasterStore, selectConstructionTypes } from '@/stores/masterStore';
import type { ProjectMasterSubcontractorCost } from '@/types/calendar';

interface ProjectCostEditorProps {
    projectMasterId: string;
    initialValues: {
        materialCost?: number | null;
        otherExpenses?: number | null;
        subcontractorCosts?: ProjectMasterSubcontractorCost[];
    };
    onSaved?: () => void;
}

interface CostRow {
    key: string;                   // React key / id
    constructionTypeId: string;
    amount: string;                // 入力中はstring
}

const toInputValue = (v: number | null | undefined): string =>
    v == null ? '' : String(v);

const parseAmount = (s: string): number | null => {
    const trimmed = s.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

function toRows(list: ProjectMasterSubcontractorCost[] | undefined): CostRow[] {
    return (list ?? [])
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((c, idx) => ({
            key: c.id ?? `row-${idx}`,
            constructionTypeId: c.constructionTypeId,
            amount: c.amount != null ? String(c.amount) : '',
        }));
}

const MAX_ROWS = 10;

export default function ProjectCostEditor({ projectMasterId, initialValues, onSaved }: ProjectCostEditorProps) {
    const constructionTypes = useMasterStore(selectConstructionTypes);
    const [materialCost, setMaterialCost] = useState(toInputValue(initialValues.materialCost));
    const [otherExpenses, setOtherExpenses] = useState(toInputValue(initialValues.otherExpenses));
    const [rows, setRows] = useState<CostRow[]>(() => toRows(initialValues.subcontractorCosts));
    const [isSaving, setIsSaving] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setMaterialCost(toInputValue(initialValues.materialCost));
        setOtherExpenses(toInputValue(initialValues.otherExpenses));
        setRows(toRows(initialValues.subcontractorCosts));
        setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectMasterId]);

    const markDirty = () => setIsDirty(true);

    const usedTypeIds = useMemo(
        () => new Set(rows.map(r => r.constructionTypeId).filter(Boolean)),
        [rows]
    );

    const subcontractorTotal = useMemo(() => {
        return rows.reduce((sum, r) => {
            const n = parseAmount(r.amount);
            return sum + (n ?? 0);
        }, 0);
    }, [rows]);

    const addRow = () => {
        if (rows.length >= MAX_ROWS) {
            toast.error(`行は最大${MAX_ROWS}までです`);
            return;
        }
        const nextType = constructionTypes.find(t => !usedTypeIds.has(t.id));
        setRows(prev => [...prev, {
            key: crypto.randomUUID(),
            constructionTypeId: nextType?.id ?? '',
            amount: '',
        }]);
        markDirty();
    };

    const updateRow = (key: string, patch: Partial<CostRow>) => {
        setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
        markDirty();
    };

    const deleteRow = (key: string) => {
        setRows(prev => prev.filter(r => r.key !== key));
        markDirty();
    };

    const handleAutoCalc = async () => {
        if (!projectMasterId) return;
        setIsCalculating(true);
        try {
            const [profitRes, settingsRes] = await Promise.all([
                fetch(`/api/project-masters/${projectMasterId}/profit`),
                fetch('/api/master-data/settings'),
            ]);
            if (!profitRes.ok || !settingsRes.ok) throw new Error('情報取得に失敗しました');
            const profit = await profitRes.json();
            const settings = await settingsRes.json();

            const revenue = Number(profit.revenue || 0);
            const revenueSource = profit.revenueSource || 'none';
            const revenueRate = Number(settings.subcontractorRevenueRate ?? 60);
            const assemblyRate = Number(settings.subcontractorAssemblyRate ?? 60);
            const demolitionRate = Number(settings.subcontractorDemolitionRate ?? 40);

            if (revenueSource === 'none' || revenue <= 0) {
                toast.error('請求書または見積書が必要です');
                return;
            }
            const assemblyType = constructionTypes.find(t => t.name === '組立');
            const demolitionType = constructionTypes.find(t => t.name === '解体');
            if (!assemblyType || !demolitionType) {
                toast.error('工事種別「組立」「解体」が見つかりません');
                return;
            }

            const subcontractorAmount = revenue * revenueRate / 100;
            const assembly = Math.round(subcontractorAmount * assemblyRate / 100);
            const demolition = Math.round(subcontractorAmount * demolitionRate / 100);

            setRows(prev => {
                const byType = new Map(prev.map(r => [r.constructionTypeId, r]));
                const next: CostRow[] = [];
                const apply = (ctId: string, amt: number) => {
                    const exist = byType.get(ctId);
                    if (exist) {
                        next.push({ ...exist, amount: String(amt) });
                        byType.delete(ctId);
                    } else {
                        next.push({ key: crypto.randomUUID(), constructionTypeId: ctId, amount: String(amt) });
                    }
                };
                apply(assemblyType.id, assembly);
                apply(demolitionType.id, demolition);
                byType.forEach(r => next.push(r));
                return next;
            });
            markDirty();

            const sourceLabel = revenueSource === 'invoice' ? '請求書（税別）' : '見積書（税別）';
            toast.success(`${sourceLabel} ¥${revenue.toLocaleString()} から組立/解体を自動計算しました`);
        } catch (err) {
            logger.error('Auto calc failed', err);
            toast.error('自動計算に失敗しました');
        } finally {
            setIsCalculating(false);
        }
    };

    const handleSave = async () => {
        if (!projectMasterId) return;
        // バリデーション: 種別未選択 / 重複のチェック
        const seen = new Set<string>();
        for (const r of rows) {
            if (!r.constructionTypeId) {
                toast.error('工事種別が未選択の行があります');
                return;
            }
            if (seen.has(r.constructionTypeId)) {
                toast.error('同じ工事種別が重複しています');
                return;
            }
            seen.add(r.constructionTypeId);
        }

        setIsSaving(true);
        try {
            const body = {
                materialCost: parseAmount(materialCost),
                otherExpenses: parseAmount(otherExpenses),
                subcontractorCosts: rows
                    .filter(r => r.constructionTypeId)
                    .map(r => ({
                        constructionTypeId: r.constructionTypeId,
                        amount: parseAmount(r.amount) ?? 0,
                    })),
            };

            const res = await fetch(`/api/project-masters/${projectMasterId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error('保存に失敗しました');
            toast.success('原価を保存しました');
            setIsDirty(false);
            onSaved?.();
        } catch (err) {
            logger.error('Cost save failed', err);
            toast.error('保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-slate-900">原価の入力</h4>
                    <p className="text-xs text-slate-500 mt-0.5">手入力の原価（税別）。協力業者費は工事種別ごとに設定し、手配確定＆担当職長が協力業者ロールのとき計上されます。</p>
                </div>
                <button
                    type="button"
                    onClick={handleAutoCalc}
                    disabled={isCalculating}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                    <Calculator className="w-3.5 h-3.5" />
                    {isCalculating ? '計算中...' : '組立・解体を自動計算'}
                </button>
            </div>

            <div className="space-y-3">
                <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">協力業者費（工事種別ごと）</p>
                    {rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-center">
                            <p className="text-xs text-slate-500">行がありません。</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {rows.map(row => (
                                <div key={row.key} className="p-3 border border-slate-200 rounded-xl bg-white flex items-center gap-2">
                                    <select
                                        value={row.constructionTypeId}
                                        onChange={e => updateRow(row.key, { constructionTypeId: e.target.value })}
                                        className="min-w-[120px] px-2 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    >
                                        <option value="">工事種別を選択</option>
                                        {constructionTypes.map(t => {
                                            const isDup = usedTypeIds.has(t.id) && t.id !== row.constructionTypeId;
                                            return (
                                                <option key={t.id} value={t.id} disabled={isDup}>
                                                    {t.name}{isDup ? '（設定済）' : ''}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    <div className="flex-1 flex items-center gap-2">
                                        <span className="text-sm text-slate-500">¥</span>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            min={0}
                                            value={row.amount}
                                            onChange={e => updateRow(row.key, { amount: e.target.value })}
                                            placeholder="0"
                                            className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => deleteRow(row.key)}
                                        className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
                                        title="この行を削除"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                        <button
                            type="button"
                            onClick={addRow}
                            disabled={rows.length >= MAX_ROWS}
                            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors disabled:opacity-50"
                        >
                            <Plus className="w-4 h-4" />
                            行を追加
                        </button>
                        <div className="text-xs text-slate-500">
                            協力業者費 合計:
                            <span className="ml-2 tabular-nums font-semibold text-slate-700">
                                {formatCurrency(subcontractorTotal)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-3">
                    <div>
                        <label className="block text-sm text-slate-700 mb-1.5">材料費</label>
                        <AmountInput value={materialCost} onChange={v => { setMaterialCost(v); markDirty(); }} />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-700 mb-1.5">その他経費</label>
                        <AmountInput value={otherExpenses} onChange={v => { setOtherExpenses(v); markDirty(); }} />
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!isDirty || isSaving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-xl hover:bg-teal-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Save className="w-4 h-4" />
                    {isSaving ? '保存中...' : '保存'}
                </button>
            </div>
        </div>
    );
}

function AmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">¥</span>
            <input
                type="number"
                inputMode="numeric"
                min={0}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder="0"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm tabular-nums"
            />
        </div>
    );
}
