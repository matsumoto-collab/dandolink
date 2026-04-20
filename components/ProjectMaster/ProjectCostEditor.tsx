'use client';

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Calculator, Save } from 'lucide-react';
import { logger } from '@/lib/logger';
import { formatCurrency } from '@/utils/costCalculation';

interface ProjectCostEditorProps {
    projectMasterId: string;
    initialValues: {
        materialCost?: number | null;
        subcontractorCost?: number | null;
        subcontractorAssemblyCost?: number | null;
        subcontractorDemolitionCost?: number | null;
        otherExpenses?: number | null;
    };
    onSaved?: () => void;
}

interface AutoCalcContext {
    revenue: number;
    revenueSource: 'invoice' | 'estimate' | 'none';
    revenueRate: number;
    assemblyRate: number;
    demolitionRate: number;
}

const toInputValue = (v: number | null | undefined): string =>
    v == null ? '' : String(v);

const parseAmount = (s: string): number | null => {
    const trimmed = s.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

export default function ProjectCostEditor({ projectMasterId, initialValues, onSaved }: ProjectCostEditorProps) {
    const [materialCost, setMaterialCost] = useState(toInputValue(initialValues.materialCost));
    const [subcontractorCost, setSubcontractorCost] = useState(toInputValue(initialValues.subcontractorCost));
    const [assemblyCost, setAssemblyCost] = useState(toInputValue(initialValues.subcontractorAssemblyCost));
    const [demolitionCost, setDemolitionCost] = useState(toInputValue(initialValues.subcontractorDemolitionCost));
    const [otherExpenses, setOtherExpenses] = useState(toInputValue(initialValues.otherExpenses));
    const [isSaving, setIsSaving] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setMaterialCost(toInputValue(initialValues.materialCost));
        setSubcontractorCost(toInputValue(initialValues.subcontractorCost));
        setAssemblyCost(toInputValue(initialValues.subcontractorAssemblyCost));
        setDemolitionCost(toInputValue(initialValues.subcontractorDemolitionCost));
        setOtherExpenses(toInputValue(initialValues.otherExpenses));
        setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectMasterId]);

    const markDirty = () => setIsDirty(true);

    const handleAutoCalc = async () => {
        setIsCalculating(true);
        try {
            const [profitRes, settingsRes] = await Promise.all([
                fetch(`/api/project-masters/${projectMasterId}/profit`),
                fetch('/api/master-data/settings'),
            ]);
            if (!profitRes.ok || !settingsRes.ok) {
                throw new Error('情報取得に失敗しました');
            }
            const profit = await profitRes.json();
            const settings = await settingsRes.json();

            const ctx: AutoCalcContext = {
                revenue: Number(profit.revenue || 0),
                revenueSource: profit.revenueSource || 'none',
                revenueRate: Number(settings.subcontractorRevenueRate ?? 60),
                assemblyRate: Number(settings.subcontractorAssemblyRate ?? 60),
                demolitionRate: Number(settings.subcontractorDemolitionRate ?? 40),
            };

            if (ctx.revenueSource === 'none' || ctx.revenue <= 0) {
                toast.error('請求書または見積書が必要です');
                return;
            }

            const subcontractorTotal = ctx.revenue * ctx.revenueRate / 100;
            const assembly = Math.round(subcontractorTotal * ctx.assemblyRate / 100);
            const demolition = Math.round(subcontractorTotal * ctx.demolitionRate / 100);

            setAssemblyCost(String(assembly));
            setDemolitionCost(String(demolition));
            setIsDirty(true);

            const sourceLabel = ctx.revenueSource === 'invoice' ? '請求書（税別）' : '見積書（税別）';
            toast.success(`${sourceLabel} ¥${ctx.revenue.toLocaleString()} から自動計算しました`);
        } catch (err) {
            logger.error('Auto calc failed', err);
            toast.error('自動計算に失敗しました');
        } finally {
            setIsCalculating(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const body = {
                materialCost: parseAmount(materialCost),
                subcontractorCost: parseAmount(subcontractorCost),
                subcontractorAssemblyCost: parseAmount(assemblyCost),
                subcontractorDemolitionCost: parseAmount(demolitionCost),
                otherExpenses: parseAmount(otherExpenses),
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

    const subcontractorDisplayTotal =
        (parseAmount(subcontractorCost) ?? 0)
        + (parseAmount(assemblyCost) ?? 0)
        + (parseAmount(demolitionCost) ?? 0);

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-slate-900">原価の入力</h4>
                    <p className="text-xs text-slate-500 mt-0.5">手入力の原価（税別）</p>
                </div>
                <button
                    type="button"
                    onClick={handleAutoCalc}
                    disabled={isCalculating}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                    <Calculator className="w-3.5 h-3.5" />
                    {isCalculating ? '計算中...' : '協力業者費を自動計算'}
                </button>
            </div>

            <div className="space-y-3">
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm text-slate-700">協力業者費（組立）</label>
                    </div>
                    <AmountInput value={assemblyCost} onChange={v => { setAssemblyCost(v); markDirty(); }} />
                </div>

                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm text-slate-700">協力業者費（解体）</label>
                    </div>
                    <AmountInput value={demolitionCost} onChange={v => { setDemolitionCost(v); markDirty(); }} />
                </div>

                {(initialValues.subcontractorCost ?? 0) > 0 || subcontractorCost !== '' ? (
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-sm text-slate-700">協力業者費（旧フィールド）</label>
                            <span className="text-[11px] text-slate-400">組立・解体に移行後は0に</span>
                        </div>
                        <AmountInput value={subcontractorCost} onChange={v => { setSubcontractorCost(v); markDirty(); }} />
                    </div>
                ) : null}

                <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-slate-500">協力業者費 合計</span>
                    <span className="tabular-nums font-semibold text-slate-700">{formatCurrency(subcontractorDisplayTotal)}</span>
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
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
