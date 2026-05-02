'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, ChevronDown, ChevronRight, Pencil, RotateCcw, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Loading from '@/components/ui/Loading';
import { formatCurrency, getProfitMarginColor } from '@/utils/costCalculation';
import { logger } from '@/lib/logger';

interface CostBreakdown {
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
    totalCost: number;
}
type RevenueSource = 'invoice' | 'estimate' | 'contract' | 'override' | 'none';

interface LaborRow {
    assignmentId: string;
    date: string;
    constructionTypeName: string | null;
    hours: number;
    foremanName: string | null;
    memberCount: number;
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}
interface VehicleRow {
    assignmentId: string;
    date: string;
    vehicleNames: string[];
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}
interface SubcontractorRow {
    assignmentId: string;
    date: string;
    constructionTypeName: string | null;
    foremanName: string | null;
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}

interface ProfitData {
    projectMasterId: string;
    projectTitle: string;
    revenue: number;
    revenueSource?: RevenueSource;
    autoRevenue?: number;
    revenueOverride?: number | null;
    invoiceAmount?: number;
    estimateAmount: number;
    estimateSubtotal?: number;
    estimateCostTotal: number | null;
    costBreakdown: CostBreakdown;
    breakdown?: {
        labor: LaborRow[];
        vehicle: VehicleRow[];
        subcontractor: SubcontractorRow[];
        materialCost: number;
        otherExpenses: number;
        loadingCost: number;
    };
    grossProfit: number;
    profitMargin: number;
}

interface ProjectProfitDisplayProps {
    projectMasterId: string;
}

const BADGE_STYLES: Record<RevenueSource, string> = {
    invoice: 'border-slate-300 text-slate-700 bg-white',
    estimate: 'border-amber-300 text-amber-700 bg-amber-50',
    contract: 'border-sky-300 text-sky-700 bg-sky-50',
    override: 'border-amber-400 text-amber-800 bg-amber-100',
    none: 'border-slate-200 text-slate-500 bg-slate-50',
};

const BADGE_LABELS: Record<RevenueSource, string> = {
    invoice: '請求済・税別',
    estimate: '見積・税別',
    contract: '足場工事金額',
    override: '手動入力',
    none: '未入力',
};

const formatDateMd = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
};

function InlineAmountEdit({
    value, auto, onSave, onClear, canClear,
}: {
    value: number;
    auto: number;
    onSave: (v: number) => Promise<void>;
    onClear?: () => Promise<void>;
    canClear: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [input, setInput] = useState(String(value));
    const [busy, setBusy] = useState(false);

    const start = () => { setInput(String(value)); setEditing(true); };
    const cancel = () => { setEditing(false); };
    const submit = async () => {
        const n = Number(input);
        if (!Number.isFinite(n) || n < 0) { toast.error('0以上の数値で入力してください'); return; }
        setBusy(true);
        try { await onSave(Math.round(n)); setEditing(false); }
        finally { setBusy(false); }
    };

    if (editing) {
        return (
            <span className="inline-flex items-center gap-1">
                <input
                    type="number"
                    inputMode="numeric"
                    className="w-28 px-2 py-0.5 text-sm border border-slate-300 rounded-md tabular-nums"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); submit(); }
                        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                    }}
                    autoFocus
                    disabled={busy}
                />
                <button onClick={submit} disabled={busy} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" aria-label="保存">
                    <Check className="w-4 h-4" />
                </button>
                <button onClick={cancel} disabled={busy} className="p-1 text-slate-500 hover:bg-slate-100 rounded" aria-label="キャンセル">
                    <X className="w-4 h-4" />
                </button>
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={`tabular-nums font-medium ${canClear ? 'text-amber-700' : 'text-slate-700'}`}>
                {formatCurrency(value)}
            </span>
            {canClear && (
                <span className="text-[10px] text-amber-600 px-1 py-0.5 bg-amber-50 rounded border border-amber-200">上書き</span>
            )}
            <button onClick={start} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" aria-label="編集">
                <Pencil className="w-3.5 h-3.5" />
            </button>
            {canClear && onClear && (
                <button onClick={onClear} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" aria-label="自動値に戻す" title={`自動: ${formatCurrency(auto)}`}>
                    <RotateCcw className="w-3.5 h-3.5" />
                </button>
            )}
        </span>
    );
}

export default function ProjectProfitDisplay({ projectMasterId }: ProjectProfitDisplayProps) {
    const [profitData, setProfitData] = useState<ProfitData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

    const fetchProfitData = useCallback(async () => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/project-masters/${projectMasterId}/profit`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Failed to fetch profit data');
            const data = await response.json();
            setProfitData(data);
        } catch (err) {
            logger.error('Error fetching profit data:', err);
            setError('利益情報の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [projectMasterId]);

    useEffect(() => {
        if (projectMasterId) fetchProfitData();
    }, [projectMasterId, fetchProfitData]);

    const patchAssignment = async (assignmentId: string, payload: Record<string, number | null>) => {
        const res = await fetch(`/api/assignments/${assignmentId}/cost-override`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            toast.error(e.error || '保存に失敗しました');
            throw new Error('save failed');
        }
        toast.success('保存しました');
        await fetchProfitData();
    };
    const patchProjectCost = async (payload: Record<string, number | null>) => {
        const res = await fetch(`/api/project-masters/${projectMasterId}/cost`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            toast.error(e.error || '保存に失敗しました');
            throw new Error('save failed');
        }
        toast.success('保存しました');
        await fetchProfitData();
    };

    const toggle = (key: string) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

    if (isLoading) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-center py-8">
                    <Loading text="利益情報を読み込み中..." />
                </div>
            </div>
        );
    }
    if (error || !profitData) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="text-center py-8 text-slate-500">{error || '利益情報がありません'}</div>
            </div>
        );
    }

    const { costBreakdown, grossProfit, profitMargin, revenue, breakdown } = profitData;
    const revenueSource: RevenueSource = profitData.revenueSource ?? (revenue > 0 ? 'invoice' : 'none');
    const isProfit = grossProfit >= 0;

    type Section =
        | { key: 'labor'; label: '人件費'; amount: number; expandable: true }
        | { key: 'vehicle'; label: '車両費'; amount: number; expandable: true }
        | { key: 'subcontractor'; label: '外注費'; amount: number; expandable: true }
        | { key: 'material'; label: '材料費'; amount: number; expandable: false }
        | { key: 'loading'; label: '積込費'; amount: number; expandable: false }
        | { key: 'other'; label: 'その他'; amount: number; expandable: false };

    const sections: Section[] = [
        { key: 'labor', label: '人件費', amount: costBreakdown.laborCost, expandable: true },
        { key: 'vehicle', label: '車両費', amount: costBreakdown.vehicleCost, expandable: true },
        { key: 'material', label: '材料費', amount: costBreakdown.materialCost, expandable: false },
        { key: 'subcontractor', label: '外注費', amount: costBreakdown.subcontractorCost, expandable: true },
        { key: 'loading', label: '積込費', amount: costBreakdown.loadingCost, expandable: false },
        { key: 'other', label: 'その他', amount: costBreakdown.otherExpenses, expandable: false },
    ];

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-[rgb(var(--color-navy-primary))]">
                <h3 className="text-base font-semibold text-white">利益サマリー</h3>
            </div>

            <div className="p-5 space-y-5">
                <div>
                    <div className="mb-2">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${BADGE_STYLES[revenueSource]}`}>
                            {BADGE_LABELS[revenueSource]}
                        </span>
                    </div>
                    <div className="text-sm text-slate-500 mb-1">利益</div>
                    <div className={`text-4xl font-bold tracking-tight tabular-nums ${isProfit ? 'text-slate-900' : 'text-red-600'}`}>
                        {formatCurrency(grossProfit)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                        {isProfit ? <TrendingUp className="w-4 h-4 text-slate-400" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                        <span className={`text-sm font-medium ${getProfitMarginColor(profitMargin)}`}>利益率 {profitMargin}%</span>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">売上</span>
                        <InlineAmountEdit
                            value={revenue}
                            auto={profitData.autoRevenue ?? revenue}
                            canClear={profitData.revenueOverride != null}
                            onSave={(v) => patchProjectCost({ revenueOverride: v })}
                            onClear={() => patchProjectCost({ revenueOverride: null })}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">原価</span>
                        <span className="text-base font-semibold text-slate-800 tabular-nums">{formatCurrency(costBreakdown.totalCost)}</span>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">原価内訳</h4>
                    <div className="divide-y divide-slate-100">
                        {sections.map(section => {
                            const opened = !!openSections[section.key];
                            return (
                                <div key={section.key} className="py-1.5">
                                    <div className="flex items-center justify-between">
                                        <button
                                            type="button"
                                            onClick={() => section.expandable && toggle(section.key)}
                                            className={`flex items-center gap-1 text-sm ${section.expandable ? 'text-slate-700 hover:text-slate-900' : 'text-slate-700 cursor-default'}`}
                                            disabled={!section.expandable}
                                        >
                                            {section.expandable ? (
                                                opened ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                                            ) : (
                                                <span className="w-4 h-4 inline-block" />
                                            )}
                                            <span>{section.label}</span>
                                        </button>
                                        {section.key === 'material' ? (
                                            <InlineAmountEdit
                                                value={breakdown?.materialCost ?? section.amount}
                                                auto={breakdown?.materialCost ?? 0}
                                                canClear={(breakdown?.materialCost ?? 0) > 0}
                                                onSave={(v) => patchProjectCost({ materialCost: v })}
                                                onClear={() => patchProjectCost({ materialCost: null })}
                                            />
                                        ) : section.key === 'loading' ? (
                                            <InlineAmountEdit
                                                value={breakdown?.loadingCost ?? section.amount}
                                                auto={breakdown?.loadingCost ?? 0}
                                                canClear={(breakdown?.loadingCost ?? 0) > 0}
                                                onSave={(v) => patchProjectCost({ loadingCost: v })}
                                                onClear={() => patchProjectCost({ loadingCost: null })}
                                            />
                                        ) : section.key === 'other' ? (
                                            <InlineAmountEdit
                                                value={breakdown?.otherExpenses ?? section.amount}
                                                auto={breakdown?.otherExpenses ?? 0}
                                                canClear={(breakdown?.otherExpenses ?? 0) > 0}
                                                onSave={(v) => patchProjectCost({ otherExpenses: v })}
                                                onClear={() => patchProjectCost({ otherExpenses: null })}
                                            />
                                        ) : (
                                            <span className="text-sm font-medium tabular-nums text-slate-700">
                                                {formatCurrency(section.amount)}
                                            </span>
                                        )}
                                    </div>

                                    {section.expandable && opened && (
                                        <div className="mt-2 ml-5 space-y-1 bg-slate-50/60 rounded-md p-2">
                                            {section.key === 'labor' && (
                                                breakdown?.labor.length ? breakdown.labor.map(r => (
                                                    <div key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                                                        <span className="flex-1 min-w-0 truncate">
                                                            {formatDateMd(r.date)}　{r.constructionTypeName ?? '—'}　{r.hours}h　{r.foremanName ?? '未割当'}　{r.memberCount}名
                                                        </span>
                                                        <InlineAmountEdit
                                                            value={r.effectiveCost}
                                                            auto={r.autoCost}
                                                            canClear={r.override != null}
                                                            onSave={(v) => patchAssignment(r.assignmentId, { laborCostOverride: v })}
                                                            onClear={() => patchAssignment(r.assignmentId, { laborCostOverride: null })}
                                                        />
                                                    </div>
                                                )) : <div className="text-xs text-slate-400 py-1">明細なし</div>
                                            )}
                                            {section.key === 'vehicle' && (
                                                breakdown?.vehicle.length ? breakdown.vehicle.map(r => (
                                                    <div key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                                                        <span className="flex-1 min-w-0 truncate">
                                                            {formatDateMd(r.date)}　{r.vehicleNames.join('、') || '車両なし'}
                                                        </span>
                                                        <InlineAmountEdit
                                                            value={r.effectiveCost}
                                                            auto={r.autoCost}
                                                            canClear={r.override != null}
                                                            onSave={(v) => patchAssignment(r.assignmentId, { vehicleCostOverride: v })}
                                                            onClear={() => patchAssignment(r.assignmentId, { vehicleCostOverride: null })}
                                                        />
                                                    </div>
                                                )) : <div className="text-xs text-slate-400 py-1">明細なし</div>
                                            )}
                                            {section.key === 'subcontractor' && (
                                                breakdown?.subcontractor.length ? breakdown.subcontractor.map(r => (
                                                    <div key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                                                        <span className="flex-1 min-w-0 truncate">
                                                            {formatDateMd(r.date)}　{r.constructionTypeName ?? '—'}　{r.foremanName ?? '—'}
                                                        </span>
                                                        <InlineAmountEdit
                                                            value={r.effectiveCost}
                                                            auto={r.autoCost}
                                                            canClear={r.override != null}
                                                            onSave={(v) => patchAssignment(r.assignmentId, { subcontractorCostOverride: v })}
                                                            onClear={() => patchAssignment(r.assignmentId, { subcontractorCostOverride: null })}
                                                        />
                                                    </div>
                                                )) : <div className="text-xs text-slate-400 py-1">明細なし</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
