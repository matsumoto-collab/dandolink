'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, ChevronDown, ChevronRight, Pencil, RotateCcw, Save, X, Plus } from 'lucide-react';
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
    workerCount: number;
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
    /** 協力業者出来高で確定した金額を採用した行。金額は出来高画面で編集する（ここでは上書き不可） */
    fromVolume?: boolean;
    effectiveCost: number;
}

// 各原価項目の「手入力分」明細（摘要＋金額）。labor/vehicle/material/loading/other/subcontractor の6 bucket。
type ManualBucket = 'labor' | 'vehicle' | 'material' | 'loading' | 'other' | 'subcontractor';
interface ManualCostItem {
    label: string;
    amount: number;
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
        subcontractorExpense?: number; // 外注費の手入力分(合計・後方互換)。subcontractor[] は協力業者の自動計上明細。
        manualItems?: Record<ManualBucket, ManualCostItem[]>; // 全6項目の手入力明細(摘要＋金額)
        purchaseInvoices?: { invoiceId: string; payeeName: string | null; categoryName: string | null; bucket: string; date: string; amount: number }[];
    };
    grossProfit: number;
    profitMargin: number;
    // Phase4: 見込み(見積基準)／確定(請求基準)／見積残／消化率
    estimatedRevenue?: number;
    confirmedRevenue?: number;
    isBilled?: boolean;
    estimatedProfit?: number;
    confirmedProfit?: number;
    costConsumptionRate?: number | null;
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

// 原価消化率(%)に応じたバー/文字の色。原価が見積に近づくほど危険（緑→黄→赤）。
function consumptionColor(rate: number): { bar: string; text: string } {
    if (rate >= 90) return { bar: 'bg-red-500', text: 'text-red-600' };
    if (rate >= 70) return { bar: 'bg-amber-500', text: 'text-amber-600' };
    return { bar: 'bg-emerald-500', text: 'text-emerald-600' };
}

// 編集中のドラフト値: undefined=未編集 / null=自動値に戻す / number=明示上書き
type Draft = number | null | undefined;
type AssignmentField = 'laborCostOverride' | 'vehicleCostOverride' | 'subcontractorCostOverride';
// 配置由来でない案件マスタ直値。手入力原価は manual(明細)へ移したので revenueOverride のみ。
type ProjectField = 'revenueOverride';

type ManualDraft = Record<ManualBucket, ManualCostItem[]>;

interface DraftState {
    assignments: Record<string, Partial<Record<AssignmentField, Draft>>>;
    project: Partial<Record<ProjectField, Draft>>;
    manual: ManualDraft | null; // null=未編集（編集開始時に現在値で初期化）
}

const emptyManualDraft = (): ManualDraft => ({ labor: [], vehicle: [], material: [], loading: [], other: [], subcontractor: [] });
const emptyDrafts: DraftState = { assignments: {}, project: {}, manual: null };

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

// 手入力分の明細（摘要＋金額）を行単位で表示／編集する。全6項目で共通利用。
function ManualCostItemsEditor({ editMode, items, onChange }: {
    editMode: boolean;
    items: ManualCostItem[];
    onChange: (next: ManualCostItem[]) => void;
}) {
    const setItem = (i: number, patch: Partial<ManualCostItem>) =>
        onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));
    const addItem = () => onChange([...items, { label: '', amount: 0 }]);

    if (!editMode) {
        // 閲覧時は金額か摘要のある行のみ表示（無ければ何も出さない＝呼び出し側が「明細なし」を判断）
        const shown = items.filter(it => it.label || it.amount);
        return (
            <>
                {shown.map((it, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                        <span className="flex-1 min-w-0 truncate">{it.label || '手入力分'}</span>
                        <span className="text-sm font-medium tabular-nums text-slate-700 flex-shrink-0">{formatCurrency(it.amount)}</span>
                    </div>
                ))}
            </>
        );
    }

    return (
        <div className="space-y-1">
            {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5 py-0.5">
                    <input
                        type="text"
                        value={it.label}
                        placeholder="摘要（例: 5月〇〇請求）"
                        onChange={e => setItem(i, { label: e.target.value })}
                        className="flex-1 min-w-0 px-2 py-0.5 text-sm border border-slate-300 rounded-md"
                    />
                    <input
                        type="number"
                        inputMode="numeric"
                        value={it.amount === 0 ? '' : it.amount}
                        placeholder="0"
                        onChange={e => {
                            const v = e.target.value;
                            const n = v === '' ? 0 : Number(v);
                            if (Number.isFinite(n) && n >= 0) setItem(i, { amount: Math.round(n) });
                        }}
                        className="w-24 px-2 py-0.5 text-sm border border-slate-300 rounded-md tabular-nums text-right flex-shrink-0"
                    />
                    <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded flex-shrink-0"
                        aria-label="この行を削除"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 px-1 py-1"
            >
                <Plus className="w-3.5 h-3.5" />
                行を追加
            </button>
        </div>
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
    const setManualItems = (bucket: ManualBucket, next: ManualCostItem[]) => {
        setDrafts(prev => ({ ...prev, manual: { ...(prev.manual ?? emptyManualDraft()), [bucket]: next } }));
    };

    // 手入力明細が初期値(保存値)から変わったか。空行は無視して正規化比較。
    const manualDirty = useMemo(() => {
        if (!drafts.manual) return false;
        const orig = profitData?.breakdown?.manualItems;
        const norm = (m: Partial<ManualDraft> | undefined) =>
            JSON.stringify((['labor', 'vehicle', 'material', 'loading', 'other', 'subcontractor'] as ManualBucket[])
                .map(b => (m?.[b] ?? []).filter(it => it.label || it.amount).map(it => [it.label, it.amount])));
        return norm(drafts.manual) !== norm(orig);
    }, [drafts.manual, profitData]);

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
        if (manualDirty) n++;
        return n;
    }, [drafts, manualDirty]);

    const enterEditMode = () => {
        setEditMode(true);
        // 編集時は各項目を自動展開し、手入力明細と配置由来の明細をその場で編集できるようにする
        setOpenSections(prev => ({ ...prev, labor: true, vehicle: true, subcontractor: true, material: true, loading: true, other: true }));
        // 手入力明細を現在値(保存値)で初期化（ディープコピー）。
        const mi = profitData?.breakdown?.manualItems;
        setDrafts(prev => ({
            ...prev,
            manual: {
                labor: (mi?.labor ?? []).map(it => ({ ...it })),
                vehicle: (mi?.vehicle ?? []).map(it => ({ ...it })),
                material: (mi?.material ?? []).map(it => ({ ...it })),
                loading: (mi?.loading ?? []).map(it => ({ ...it })),
                other: (mi?.other ?? []).map(it => ({ ...it })),
                subcontractor: (mi?.subcontractor ?? []).map(it => ({ ...it })),
            },
        }));
    };

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
            // project（revenueOverride）＋手入力明細(manualCostItems)をまとめて1リクエスト
            const projectPayload: Record<string, unknown> = {};
            for (const [f, v] of Object.entries(drafts.project)) {
                if (v === undefined) continue;
                projectPayload[f] = v;
            }
            if (manualDirty && drafts.manual) {
                projectPayload.manualCostItems = drafts.manual;
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

    // Phase4: 見込み(見積基準)／確定(請求基準)／見積残／消化率
    const estimatedRevenue = profitData.estimatedRevenue ?? 0;
    const confirmedRevenue = profitData.confirmedRevenue ?? 0;
    const isBilled = profitData.isBilled ?? false;
    const estimatedProfit = profitData.estimatedProfit ?? (estimatedRevenue - costBreakdown.totalCost);
    const confirmedProfit = profitData.confirmedProfit ?? (confirmedRevenue - costBreakdown.totalCost);
    const costConsumptionRate = profitData.costConsumptionRate ?? null;

    type Section = { key: 'labor' | 'vehicle' | 'subcontractor' | 'material' | 'loading' | 'other'; label: string; amount: number; expandable: boolean };

    const piRows = breakdown?.purchaseInvoices ?? [];
    const piByBucket = (bucket: string) => piRows.filter(p => p.bucket === bucket);

    // 材料費・積込費・その他は「手入力分の編集」と「仕入請求書の明細」を展開内に置くため常に展開可能
    const sections: Section[] = [
        { key: 'labor', label: '人件費', amount: costBreakdown.laborCost, expandable: true },
        { key: 'vehicle', label: '車両費', amount: costBreakdown.vehicleCost, expandable: true },
        { key: 'material', label: '材料費', amount: costBreakdown.materialCost, expandable: true },
        { key: 'subcontractor', label: '外注費', amount: costBreakdown.subcontractorCost, expandable: true },
        { key: 'loading', label: '積込費', amount: costBreakdown.loadingCost, expandable: true },
        { key: 'other', label: 'その他', amount: costBreakdown.otherExpenses, expandable: true },
    ];

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-[rgb(var(--color-navy-primary))] flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">利益サマリー</h3>
                {!editMode ? (
                    <button
                        type="button"
                        onClick={enterEditMode}
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

                {!editMode && (
                    <div className="border-t border-slate-100 pt-4 space-y-4">
                        {/* 見込み（見積基準） vs 確定（請求基準） */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-slate-200 p-3">
                                <div className="text-xs font-medium text-slate-500 mb-2">見込み（見積基準）</div>
                                <div className="space-y-1 text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">見積</span>
                                        <span className="tabular-nums text-slate-700">{formatCurrency(estimatedRevenue)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">原価</span>
                                        <span className="tabular-nums text-slate-500">{formatCurrency(costBreakdown.totalCost)}</span>
                                    </div>
                                    <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                                        <span className="font-medium text-slate-600">見積残</span>
                                        <span className={`tabular-nums font-semibold ${estimatedProfit >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{formatCurrency(estimatedProfit)}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 p-3">
                                <div className="text-xs font-medium text-slate-500 mb-2">確定（請求基準）</div>
                                {isBilled ? (
                                    <div className="space-y-1 text-sm">
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500">請求</span>
                                            <span className="tabular-nums text-slate-700">{formatCurrency(confirmedRevenue)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500">原価</span>
                                            <span className="tabular-nums text-slate-500">{formatCurrency(costBreakdown.totalCost)}</span>
                                        </div>
                                        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                                            <span className="font-medium text-slate-600">利益</span>
                                            <span className={`tabular-nums font-semibold ${confirmedProfit >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{formatCurrency(confirmedProfit)}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-[72px] text-sm text-slate-400">未請求</div>
                                )}
                            </div>
                        </div>

                        {/* 原価消化率バー（緑→黄→赤） */}
                        {costConsumptionRate != null && (() => {
                            const c = consumptionColor(costConsumptionRate);
                            return (
                                <div>
                                    <div className="flex items-center justify-between text-xs mb-1.5">
                                        <span className="text-slate-500">原価消化率（見積に対する原価）</span>
                                        <span className={`font-semibold tabular-nums ${c.text}`}>{costConsumptionRate}%</span>
                                    </div>
                                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                                        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${Math.min(100, Math.max(0, costConsumptionRate))}%` }} />
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                                        <span>見積 {formatCurrency(estimatedRevenue)}</span>
                                        <span>残 {formatCurrency(estimatedProfit)}</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}

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
                    {editMode && (
                        <p className="text-xs text-slate-500 -mt-2 mb-3">
                            各項目とも<span className="font-medium text-slate-600">手入力分</span>に摘要（例: 5月〇〇請求）＋金額の行を追加できます。人件費・車両費・外注費は配置(日付)ごとの自動計上も<span className="font-medium text-slate-600">行ごと</span>に上書きできます。外注費の<span className="font-medium text-sky-700">出来高</span>バッジの行は協力業者出来高で確定した金額のため、変更は出来高の画面で行います。
                        </p>
                    )}
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
                                        <span className="text-sm font-medium tabular-nums text-slate-700">
                                            {formatCurrency(section.amount)}
                                        </span>
                                    </div>

                                    {section.expandable && opened && (() => {
                                        const bucket = section.key as ManualBucket;
                                        // 手入力明細: 編集時はドラフト、閲覧時は保存値（profitData の breakdown.manualItems）
                                        const manualItems = editMode ? (drafts.manual?.[bucket] ?? []) : (breakdown?.manualItems?.[bucket] ?? []);
                                        const hasManualShown = manualItems.some(it => it.label || it.amount);
                                        // 自動明細（人件費/車両費/外注費=配置由来、材料費/積込費/その他=仕入請求書由来）
                                        const laborRows = section.key === 'labor' ? (breakdown?.labor ?? []) : [];
                                        const vehicleRows = section.key === 'vehicle' ? (breakdown?.vehicle ?? []) : [];
                                        const subRows = section.key === 'subcontractor' ? (breakdown?.subcontractor ?? []) : [];
                                        const piRowsB = (section.key === 'material' || section.key === 'loading' || section.key === 'other') ? piByBucket(section.key) : [];
                                        const hasAuto = laborRows.length + vehicleRows.length + subRows.length + piRowsB.length > 0;
                                        return (
                                            <div className="mt-2 ml-5 space-y-1 bg-slate-50/60 rounded-md p-2">
                                                {/* 手入力分（摘要＋金額の明細・全項目共通） */}
                                                <ManualCostItemsEditor
                                                    editMode={editMode}
                                                    items={manualItems}
                                                    onChange={(next) => setManualItems(bucket, next)}
                                                />
                                                {/* 人件費: 配置(日報)由来の明細。行ごとに上書き可 */}
                                                {laborRows.map(r => (
                                                    <div key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                                                        <span className="flex-1 min-w-0 truncate">
                                                            {formatDateMd(r.date)}　{r.constructionTypeName ?? '—'}　{r.hours}h　{r.foremanName ?? '未割当'}　{r.workerCount}名
                                                        </span>
                                                        <AmountCell editMode={editMode} value={r.effectiveCost} auto={r.autoCost} override={r.override}
                                                            draft={drafts.assignments[r.assignmentId]?.laborCostOverride}
                                                            onChange={(v) => setAssignmentDraft(r.assignmentId, 'laborCostOverride', v)} />
                                                    </div>
                                                ))}
                                                {/* 車両費: 確定車両の明細 */}
                                                {vehicleRows.map(r => (
                                                    <div key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                                                        <span className="flex-1 min-w-0 truncate">
                                                            {formatDateMd(r.date)}　{r.vehicleNames.join('、') || '車両なし'}
                                                        </span>
                                                        <AmountCell editMode={editMode} value={r.effectiveCost} auto={r.autoCost} override={r.override}
                                                            draft={drafts.assignments[r.assignmentId]?.vehicleCostOverride}
                                                            onChange={(v) => setAssignmentDraft(r.assignmentId, 'vehicleCostOverride', v)} />
                                                    </div>
                                                ))}
                                                {/* 外注費: 協力業者の手配確定由来の明細。出来高で確定した行は出来高画面が正（ここでは上書き不可） */}
                                                {subRows.map(r => (
                                                    <div key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                                                        <span className="flex-1 min-w-0 truncate">
                                                            {formatDateMd(r.date)}　{r.constructionTypeName ?? '—'}　{r.foremanName ?? '—'}
                                                        </span>
                                                        {r.fromVolume ? (
                                                            <span className="inline-flex items-center gap-1.5 flex-shrink-0" title="協力業者出来高で確定した金額です。変更は協力業者出来高の画面で行ってください。">
                                                                <span className="text-[10px] text-sky-700 px-1 py-0.5 bg-sky-50 rounded border border-sky-200">出来高</span>
                                                                <span className="tabular-nums font-medium text-slate-700">{formatCurrency(r.effectiveCost)}</span>
                                                            </span>
                                                        ) : (
                                                            <AmountCell editMode={editMode} value={r.effectiveCost} auto={r.autoCost} override={r.override}
                                                                draft={drafts.assignments[r.assignmentId]?.subcontractorCostOverride}
                                                                onChange={(v) => setAssignmentDraft(r.assignmentId, 'subcontractorCostOverride', v)} />
                                                        )}
                                                    </div>
                                                ))}
                                                {/* 材料費・積込費・その他: 仕入請求書由来の明細（自動・表示のみ） */}
                                                {piRowsB.map(r => (
                                                    <div key={r.invoiceId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">
                                                        <span className="flex-1 min-w-0 truncate">{r.date ? formatDateMd(r.date) + '　' : ''}{r.payeeName ?? '—'}{r.categoryName ? `　${r.categoryName}` : ''}</span>
                                                        <span className="text-sm font-medium tabular-nums text-slate-700">{formatCurrency(r.amount)}</span>
                                                    </div>
                                                ))}
                                                {/* 閲覧時、手入力も自動明細も無ければ「明細なし」 */}
                                                {!editMode && !hasManualShown && !hasAuto && <div className="text-xs text-slate-400 py-1">明細なし</div>}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
