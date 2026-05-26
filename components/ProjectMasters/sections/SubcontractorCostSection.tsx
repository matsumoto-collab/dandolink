'use client';

import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Calculator, FileSearch } from 'lucide-react';
import { ProjectMasterFormData, SubcontractorCostEntry } from '../ProjectMasterForm';
import { useMasterStore, selectConstructionTypes } from '@/stores/masterStore';
import { logger } from '@/lib/logger';
import { EstimatePreviewSlideOver } from './EstimatePreviewSlideOver';

interface SubcontractorCostSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
    projectMasterId?: string;
}

const MAX_ROWS = 10;

function makeEntry(constructionTypeId = '', amount = '', transportCost = ''): SubcontractorCostEntry {
    return { id: crypto.randomUUID(), constructionTypeId, amount, transportCost };
}

export function SubcontractorCostSection({ formData, setFormData, projectMasterId }: SubcontractorCostSectionProps) {
    const constructionTypes = useMasterStore(selectConstructionTypes);
    const [isAutoCalc, setIsAutoCalc] = useState(false);
    const [isEstimateOpen, setIsEstimateOpen] = useState(false);

    const rows = formData.subcontractorCosts;

    const usedTypeIds = useMemo(
        () => new Set(rows.map(r => r.constructionTypeId).filter(Boolean)),
        [rows]
    );

    const total = useMemo(() => {
        return rows.reduce((sum, r) => {
            const work = Number(r.amount);
            const trans = Number(r.transportCost);
            const workSum = Number.isFinite(work) && work > 0 ? work : 0;
            const transSum = Number.isFinite(trans) && trans > 0 ? trans : 0;
            return sum + workSum + transSum;
        }, 0);
    }, [rows]);

    const addRow = () => {
        if (rows.length >= MAX_ROWS) {
            toast.error(`行は最大${MAX_ROWS}までです`);
            return;
        }
        // 未使用の種別をデフォルトとして選択
        const nextType = constructionTypes.find(t => !usedTypeIds.has(t.id));
        setFormData(prev => ({
            ...prev,
            subcontractorCosts: [...prev.subcontractorCosts, makeEntry(nextType?.id ?? '', '')],
        }));
    };

    const updateRow = (id: string, patch: Partial<SubcontractorCostEntry>) => {
        setFormData(prev => ({
            ...prev,
            subcontractorCosts: prev.subcontractorCosts.map(r => r.id === id ? { ...r, ...patch } : r),
        }));
    };

    const deleteRow = (id: string) => {
        setFormData(prev => ({
            ...prev,
            subcontractorCosts: prev.subcontractorCosts.filter(r => r.id !== id),
        }));
    };

    const applyAssemblyDemolition = (assembly: number, demolition: number) => {
        const assemblyType = constructionTypes.find(t => t.name === '組立');
        const demolitionType = constructionTypes.find(t => t.name === '解体');
        if (!assemblyType || !demolitionType) {
            toast.error('工事種別「組立」「解体」が見つかりません');
            return;
        }
        setFormData(prev => {
            const existingById = new Map(prev.subcontractorCosts.map(r => [r.constructionTypeId, r]));
            const nextList: SubcontractorCostEntry[] = [];
            const setAmount = (ctId: string, amt: number) => {
                const exist = existingById.get(ctId);
                if (exist) nextList.push({ ...exist, amount: String(amt) });
                else nextList.push(makeEntry(ctId, String(amt)));
                existingById.delete(ctId);
            };
            setAmount(assemblyType.id, assembly);
            setAmount(demolitionType.id, demolition);
            existingById.forEach(r => nextList.push(r));
            return { ...prev, subcontractorCosts: nextList };
        });
    };

    const handleAutoCalc = async () => {
        if (!projectMasterId) {
            toast.error('案件保存後に利用できます');
            return;
        }
        setIsAutoCalc(true);
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

            const subcontractorTotal = revenue * revenueRate / 100;
            const assembly = Math.round(subcontractorTotal * assemblyRate / 100);
            const demolition = Math.round(subcontractorTotal * demolitionRate / 100);

            applyAssemblyDemolition(assembly, demolition);

            const sourceLabel = revenueSource === 'invoice' ? '請求書（税別）' : '見積書（税別）';
            toast.success(`${sourceLabel} ¥${revenue.toLocaleString()} から組立/解体を自動計算しました`);
        } catch (err) {
            logger.error('Auto calc failed', err);
            toast.error('自動計算に失敗しました');
        } finally {
            setIsAutoCalc(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                    <p className="text-xs text-slate-500">
                        工事種別ごとに協力業者の作業費（税別）と、必要なら運搬費を設定します。手配が確定し、担当職長が協力業者ロールのアサインに該当する種別だけが原価に計上されます。運搬費は出来高表で別行として表示されます。
                    </p>
                </div>
                {projectMasterId && (
                    <div className="shrink-0 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setIsEstimateOpen(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-xl hover:bg-teal-100 transition-colors"
                        >
                            <FileSearch className="w-3.5 h-3.5" />
                            見積を確認
                        </button>
                        <button
                            type="button"
                            onClick={handleAutoCalc}
                            disabled={isAutoCalc}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                        >
                            <Calculator className="w-3.5 h-3.5" />
                            {isAutoCalc ? '計算中...' : '組立・解体を自動計算'}
                        </button>
                    </div>
                )}
            </div>

            {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                    <p className="text-xs text-slate-500">協力業者費の設定はありません。</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map(row => {
                        return (
                            <div key={row.id} className="p-3 border border-slate-200 rounded-xl bg-white flex flex-wrap items-center gap-2">
                                <select
                                    value={row.constructionTypeId}
                                    onChange={e => updateRow(row.id, { constructionTypeId: e.target.value })}
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
                                <label className="flex-1 min-w-[180px] flex items-center gap-1.5">
                                    <span className="text-xs text-slate-500 whitespace-nowrap">作業費 ¥</span>
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        value={row.amount}
                                        onChange={e => updateRow(row.id, { amount: e.target.value })}
                                        placeholder="0"
                                        className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    />
                                </label>
                                <label className="flex-1 min-w-[180px] flex items-center gap-1.5">
                                    <span className="text-xs text-slate-500 whitespace-nowrap">運搬費 ¥</span>
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        value={row.transportCost}
                                        onChange={e => updateRow(row.id, { transportCost: e.target.value })}
                                        placeholder="0"
                                        className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => deleteRow(row.id)}
                                    className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors shrink-0"
                                    title="この行を削除"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex items-center justify-between">
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
                    合計:
                    <span className="ml-2 tabular-nums font-semibold text-slate-700">
                        ¥{total.toLocaleString()}
                    </span>
                </div>
            </div>

            {projectMasterId && (
                <EstimatePreviewSlideOver
                    isOpen={isEstimateOpen}
                    onClose={() => setIsEstimateOpen(false)}
                    projectMasterId={projectMasterId}
                    onApplyToCosts={({ assembly, demolition }) => applyAssemblyDemolition(assembly, demolition)}
                />
            )}
        </div>
    );
}
