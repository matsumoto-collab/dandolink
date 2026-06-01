'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, ChevronDown, ChevronRight, Pencil, RotateCcw, Save, X } from 'lucide-react';
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

interface EstimateBreakdownItem {
    id: string;
    estimateNumber: string;
    title: string;
    total: number;
    subtotal: number;
    costTotal: number | null;
    createdAt: string;
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
    estimateBreakdown?: EstimateBreakdownItem[];
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

// 編集中のドラフト値: undefined=未編集 / null=自動値に戻す / number=明示上書き
type Draft = number | null | undefined;
type AssignmentField = 'laborCostOverride' | 'vehicleCostOverride' | 'subcontractorCostOverride';
type ProjectField = 'materialCost' | 'otherExpenses' | 'loadingCost' | 'revenueOverride';

interface DraftState {
    assignments: Record<string, Partial<Record<AssignmentField, Draft>>>;
    project: Partial<Record<ProjectField, Draft>>;
}

const emptyDrafts: DraftState = { assignments: {}, project: {} };

function AmountCell({
    editMode, value, auto, override, draft, onChange,
}: {
    editMode: boolean;
    value: number;
    auto: number;
    override: number | null | undefined;
    draft: Draft;
    onChange: (next: Draft) => void;
}) {
    const effectiveOverride = draft === undefined ? override : draft;
    const hasOverride = effectiveOverride != null;
    const isDirty = draft !== undefined;

    if (!editMode) {
        return (
            // 親が flex justify-between の右側に置かれるので、モバイルで金額が
            // 縮められないよう flex-shrink-0 を付与（左ラベル側で truncate させる）
            <span className="inline-flex items-center gap-1.5 flex-shrink-0">
                <span className={`tabular-nums font-medium ${hasOverride ? 'text-amber-700' : 'text-slate-700'}`}>
                    {formatCurrency(value)}
                </span>
                {hasOverride && (
                    <span className="text-[10px] text-amber-600 px-1 py-0.5 bg-amber-50 rounded border border-amber-200">上書き</span>
                )}
            </span>
        );
    }

    return (
        // 編集モードも同様に flex-shrink-0。input はモバイルで w-24 に縮め、md: 以上で従来の w-32
        <span className="inline-flex items-center gap-1 flex-shrink-0">
            <input
                type="number"
                inputMode="numeric"
                className={`w-24 md:w-32 px-2 py-0.5 text-sm border rounded-md tabular-nums text-right ${isDirty ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                value={effectiveOverride ?? auto}
                placeholder={String(auto)}
                onChange={e => {
                    const v = e.target.value;
                    if (v === '') { onChange(null); return; }
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) onChange(Math.round(n));
                }}
            />
            {hasOverride && (
                <button
                    type="button"
                    onClick={() => onChange(null)}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                    aria-label="自動値に戻す"
                    title={`自動: ${formatCurrency(auto)}`}
                >
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
    const [estimateBreakdownOpen, setEstimateBreakdownOpen] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [drafts, setDrafts] = useState<DraftState>(emptyDrafts);
    const [saving, setSaving] = useState(false);

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

    const setAssignmentDraft = (assignmentId: string, field: AssignmentField, v: Draft) => {
        setDrafts(prev => {
            const cur = { ...(prev.assignments[assignmentId] ?? {}) };
            cur[field] = v;
            return { ...prev, assignments: { ...prev.assignments, [assignmentId]: cur } };
        });
    };
    const setProjectDraft = (field: ProjectField, v: Draft) => {
        setDrafts(prev => ({ ...prev, project: { ...prev.project, [field]: v } }));
    };

    const dirtyCount = useMemo(() => {
        let n = 0;
        for (const aId of Object.keys(drafts.assignments)) {
            for (const f of Object.keys(drafts.assignments[aId])) {
                if (drafts.assignments[aId][f as AssignmentField] !== undefined) n++;
            }
        }
        for (const f of Object.keys(drafts.project)) {
            if (drafts.project[f as ProjectField] !== undefined) n++;
        }
        return n;
    }, [drafts]);

    const cancelEdit = () => {
        setDrafts(emptyDrafts);
        setEditMode(false);
    };

    const saveAll = async () => {
        if (dirtyCount === 0) { setEditMode(false); return; }
        setSaving(true);
        try {
            const calls: Promise<Response>[] = [];
            // assignment ごとに1リクエストに集約
            for (const [aId, fields] of Object.entries(drafts.assignments)) {
                const payload: Record<string, number | null> = {};
                for (const [f, v] of Object.entries(fields)) {
                    if (v === undefined) continue;
                    payload[f] = v;
                }
                if (Object.keys(payload).length > 0) {
                    calls.push(fetch(`/api/assignments/${aId}/cost-override`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    }));
                }
            }
            // project の各フィールドをまとめて1リクエスト
            const projectPayload: Record<string, number | null> = {};
            for (const [f, v] of Object.entries(drafts.project)) {
                if (v === undefined) continue;
                projectPayload[f] = v;
            }
            if (Object.keys(projectPayload).length > 0) {
                calls.push(fetch(`/api/project-masters/${projectMasterId}/cost`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(projectPayload),
                }));
            }
            const results = await Promise.all(calls);
            const failed = results.filter(r => !r.ok);
            if (failed.length > 0) {
                toast.error(`${failed.length}件の保存に失敗しました`);
            } else {
                toast.success(`${dirtyCount}件まとめて保存しました`);
                setDrafts(emptyDrafts);
                setEditMode(false);
            }
            await fetchProfitData();
        } catch (e) {
            logger.error('saveAll failed', e);
            toast.error('保存に失敗しました');
        } finally {
            setSaving(false);
        }
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
            <div className="px-5 py-3 bg-[rgb(var(--color-navy-primary))] flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">利益サマリー</h3>
                {!editMode ? (
                    <button
                        type="button"
                        onClick={() => setEditMode(true)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white"
                    >
                        <Pencil className="w-3.5 h-3.5" />
                        編集
                    </button>
                ) : (
                    <div className="inline-flex items-center gap-2">
                        <span className="text-xs text-white/80">{dirtyCount > 0 ? `${dirtyCount}件の変更` : '変更なし'}</span>
                        <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white"
                        >
                            <X className="w-3.5 h-3.5" />
                            キャンセル
                        </button>
                        <button
                            type="button"
                            onClick={saveAll}
                            disabled={saving || dirtyCount === 0}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
                        >
                            <Save className="w-3.5 h-3.5" />
                            {saving ? '保存中…' : '保存'}
                        </button>
                    </div>
                )}
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
                        {(() => {
                            const breakdown = profitData.estimateBreakdown ?? [];
                            const hasMultiple = breakdown.length >= 2;
                            const canExpand = hasMultiple && !editMode && revenueSource === 'estimate';
                            return (
                                <button
                                    type="button"
                                    onClick={() => { if (canExpand) setEstimateBreakdownOpen(o => !o); }}
                                    disabled={!canExpand}
                                    className={`inline-flex items-center gap-1 text-sm text-slate-600 ${canExpand ? 'hover:text-slate-900 cursor-pointer' : 'cursor-default'}`}
                                >
                                    {canExpand && (
                                        estimateBreakdownOpen
                                            ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                            : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                    )}
                                    <span>売上</span>
                                    {hasMultiple && (
                                        <span className="text-[10px] text-slate-500 px-1.5 py-0.5 bg-slate-100 rounded">
                                            見積{breakdown.length}件
                                        </span>
                                    )}
                                </button>
                            );
                        })()}
                        <AmountCell
                            editMode={editMode}
                            value={revenue}
                            auto={profitData.autoRevenue ?? revenue}
                            override={profitData.revenueOverride ?? null}
                            draft={drafts.project.revenueOverride}
                            onChange={(v) => setProjectDraft('revenueOverride', v)}
                        />
                    </div>
                    {estimateBreakdownOpen && revenueSource === 'estimate' && (profitData.estimateBreakdown?.length ?? 0) >= 2 && (
                        <div className="ml-5 pl-2 border-l-2 border-slate-200 space-y-1">
                            {profitData.estimateBreakdown!.map((est, idx) => (
                                <div key={est.id} className="flex items-center justify-between text-xs">
                                    <span className="text-slate-600 truncate mr-2">
                                        <span className="font-medium text-slate-700">{est.estimateNumber}</span>
                                        {idx > 0 && <span className="ml-1.5 text-[10px] text-slate-500 px-1 py-0.5 bg-slate-50 rounded border border-slate-200">追加見積</span>}
                                    </span>
                                    <span className="tabular-nums text-slate-700 flex-shrink-0">{formatCurrency(est.total)}</span>
                                </div>
                            ))}
                        </div>
                    )}
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
                                            // モバイルで右側 AmountCell が押し出されないよう、
                                            // ラベル側を min-w-0 truncate で収縮可能に
                                            className={`flex items-center gap-1 text-sm min-w-0 truncate ${section.expandable ? 'text-slate-700 hover:text-slate-900' : 'text-slate-700 cursor-default'}`}
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
                                            <AmountCell
                                                editMode={editMode}
                                                value={section.amount}
                                                auto={0}
                                                override={breakdown?.materialCost && breakdown.materialCost > 0 ? breakdown.materialCost : null}
                                                draft={drafts.project.materialCost}
                                                onChange={(v) => setProjectDraft('materialCost', v)}
                                            />
                                        ) : section.key === 'loading' ? (
                                            <AmountCell
                                                editMode={editMode}
                                                value={section.amount}
                                                auto={0}
                                                override={breakdown?.loadingCost && breakdown.loadingCost > 0 ? breakdown.loadingCost : null}
                                                draft={drafts.project.loadingCost}
                                                onChange={(v) => setProjectDraft('loadingCost', v)}
                                            />
                                        ) : section.key === 'other' ? (
                                            <AmountCell
                                                editMode={editMode}
                                                value={section.amount}
                                                auto={0}
                                                override={breakdown?.otherExpenses && breakdown.otherExpenses > 0 ? breakdown.otherExpenses : null}
                                                draft={drafts.project.otherExpenses}
                                                onChange={(v) => setProjectDraft('otherExpenses', v)}
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
                                                        <AmountCell
                                                            editMode={editMode}
                                                            value={r.effectiveCost}
                                                            auto={r.autoCost}
                                                            override={r.override}
                                                            draft={drafts.assignments[r.assignmentId]?.laborCostOverride}
                                                            onChange={(v) => setAssignmentDraft(r.assignmentId, 'laborCostOverride', v)}
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
                                                        <AmountCell
                                                            editMode={editMode}
                                                            value={r.effectiveCost}
                                                            auto={r.autoCost}
                                                            override={r.override}
                                                            draft={drafts.assignments[r.assignmentId]?.vehicleCostOverride}
                                                            onChange={(v) => setAssignmentDraft(r.assignmentId, 'vehicleCostOverride', v)}
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
                                                        <AmountCell
                                                            editMode={editMode}
                                                            value={r.effectiveCost}
                                                            auto={r.autoCost}
                                                            override={r.override}
                                                            draft={drafts.assignments[r.assignmentId]?.subcontractorCostOverride}
                                                            onChange={(v) => setAssignmentDraft(r.assignmentId, 'subcontractorCostOverride', v)}
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
