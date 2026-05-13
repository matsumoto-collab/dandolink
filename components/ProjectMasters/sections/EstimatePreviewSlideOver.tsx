'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, FileText, ChevronDown, ChevronRight, Pin, PinOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { EstimateItem } from '@/types/estimate';
import { logger } from '@/lib/logger';

interface EstimatePreviewSlideOverProps {
    isOpen: boolean;
    onClose: () => void;
    projectMasterId: string;
    onApplyToCosts?: (params: { assembly: number; demolition: number }) => void;
}

interface EstimateSummary {
    id: string;
    estimateNumber: string;
    title: string;
    subtotal: number;
    tax: number;
    total: number;
    items: EstimateItem[];
    updatedAt: string;
    status: string;
}

const STATUS_LABEL: Record<string, string> = {
    draft: '下書き',
    sent: '送付済',
    approved: '承認済',
    rejected: '却下',
};

function collectIds(items: EstimateItem[]): string[] {
    const ids: string[] = [];
    for (const item of items) {
        ids.push(item.id);
        if (item.children) ids.push(...collectIds(item.children));
    }
    return ids;
}

// 選択された行の金額を重複なく合計する
// - 親(カテゴリ)が選択されている場合は親の amount を採用し、子は無視
// - 親が未選択で子が選択されている場合は子の amount を加算
function calcSelectedTotal(items: EstimateItem[], selected: Set<string>): number {
    let total = 0;
    for (const item of items) {
        if (selected.has(item.id)) {
            total += Number(item.amount || 0);
        } else if (item.children && item.children.length > 0) {
            total += calcSelectedTotal(item.children, selected);
        }
    }
    return total;
}

export function EstimatePreviewSlideOver({ isOpen, onClose, projectMasterId, onApplyToCosts }: EstimatePreviewSlideOverProps) {
    const [estimates, setEstimates] = useState<EstimateSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [pinned, setPinned] = useState(false);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const [manualAmount, setManualAmount] = useState<string>('');

    // 配分設定（システム設定からデフォルトを取得）
    const [revenueRate, setRevenueRate] = useState<string>('60');
    const [assemblyRate, setAssemblyRate] = useState<string>('60');
    const [demolitionRate, setDemolitionRate] = useState<string>('40');

    useEffect(() => {
        if (!isOpen || !projectMasterId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        Promise.all([
            fetch(`/api/estimates?projectMasterId=${encodeURIComponent(projectMasterId)}`, { cache: 'no-store' }).then(r => {
                if (!r.ok) throw new Error('見積書の取得に失敗しました');
                return r.json();
            }),
            fetch('/api/master-data/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        ])
            .then(([data, settings]: [EstimateSummary[], { subcontractorRevenueRate?: number; subcontractorAssemblyRate?: number; subcontractorDemolitionRate?: number } | null]) => {
                if (cancelled) return;
                setEstimates(data);
                setSelectedId(data[0]?.id ?? null);
                const ids = new Set<string>();
                (data[0]?.items ?? []).forEach(item => {
                    if (item.isCategory) ids.add(item.id);
                });
                setExpandedCategories(ids);
                setSelectedItemIds(new Set());
                if (settings) {
                    if (settings.subcontractorRevenueRate != null) setRevenueRate(String(settings.subcontractorRevenueRate));
                    if (settings.subcontractorAssemblyRate != null) setAssemblyRate(String(settings.subcontractorAssemblyRate));
                    if (settings.subcontractorDemolitionRate != null) setDemolitionRate(String(settings.subcontractorDemolitionRate));
                }
            })
            .catch(err => {
                if (cancelled) return;
                logger.error('estimate fetch failed', err);
                setError('見積書の取得に失敗しました');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, projectMasterId]);

    // 見積書切替時は選択をリセット
    useEffect(() => {
        setSelectedItemIds(new Set());
        setManualAmount('');
    }, [selectedId]);

    // Escキーで閉じる（ピン留め中は無効）
    useEffect(() => {
        if (!isOpen || pinned) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, onClose, pinned]);

    const selected = estimates.find(e => e.id === selectedId) ?? null;

    const selectedTotal = useMemo(() => {
        if (!selected) return 0;
        return calcSelectedTotal(selected.items, selectedItemIds);
    }, [selected, selectedItemIds]);

    const manualAmountNum = Math.max(0, Number(manualAmount) || 0);
    const totalAmount = selectedTotal + manualAmountNum;
    const rRate = Number(revenueRate) || 0;
    const aRate = Number(assemblyRate) || 0;
    const dRate = Number(demolitionRate) || 0;
    const subTotalCost = Math.round(totalAmount * rRate / 100);
    const assemblyCost = Math.round(subTotalCost * aRate / 100);
    const demolitionCost = Math.round(subTotalCost * dRate / 100);
    const ratesValid = aRate + dRate === 100;

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelect = (item: EstimateItem) => {
        setSelectedItemIds(prev => {
            const next = new Set(prev);
            const ids = item.isCategory ? collectIds([item]) : [item.id];
            const allSelected = ids.every(id => next.has(id));
            if (allSelected) ids.forEach(id => next.delete(id));
            else ids.forEach(id => next.add(id));
            return next;
        });
    };

    const handleSelectAll = () => {
        if (!selected) return;
        setSelectedItemIds(new Set(collectIds(selected.items)));
    };

    const handleClearAll = () => setSelectedItemIds(new Set());

    const handleApply = () => {
        if (!onApplyToCosts) return;
        if (totalAmount <= 0) {
            toast.error('項目を選択するか、追加金額を入力してください');
            return;
        }
        if (!ratesValid) {
            toast.error('組立配分と解体配分の合計を100%にしてください');
            return;
        }
        onApplyToCosts({ assembly: assemblyCost, demolition: demolitionCost });
        toast.success(`組立 ¥${assemblyCost.toLocaleString()} / 解体 ¥${demolitionCost.toLocaleString()} を反映しました`);
    };

    const handleBackdropClick = () => {
        if (!pinned) onClose();
    };

    return (
        <>
            {/* 背景 (ピン留め中はクリックスルー) */}
            {isOpen && (
                <div
                    className={`fixed inset-0 z-[65] ${pinned ? 'pointer-events-none' : ''}`}
                    onClick={handleBackdropClick}
                    aria-hidden="true"
                />
            )}
            {/* スライドオーバーパネル */}
            <aside
                role="dialog"
                aria-label="見積書プレビュー"
                aria-hidden={!isOpen}
                className={`fixed right-0 bottom-0 top-[calc(4rem+env(safe-area-inset-top,0px))] lg:top-0 w-full max-w-md z-[66] bg-white shadow-2xl border-l border-slate-200 flex flex-col transform transition-transform duration-300 ease-out ${
                    isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
                }`}
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 border-b border-slate-200 px-4 py-3 flex items-center justify-between bg-slate-50">
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-5 h-5 text-teal-600 shrink-0" />
                        <h3 className="text-sm font-semibold text-slate-900 truncate">見積書プレビュー</h3>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setPinned(p => !p)}
                            className={`p-1.5 rounded-lg transition-colors ${pinned ? 'bg-teal-100 text-teal-700 hover:bg-teal-200' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                            aria-label={pinned ? 'ピン留め解除' : 'ピン留め'}
                            title={pinned ? 'ピン留め解除（背景クリック・Escで閉じられるようになります）' : 'ピン留め（背景操作中も開いたままにします）'}
                        >
                            {pinned ? <Pin className="w-5 h-5" /> : <PinOff className="w-5 h-5" />}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            aria-label="閉じる"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 見積セレクター */}
                {estimates.length > 1 && (
                    <div className="flex-shrink-0 border-b border-slate-200 px-4 py-2 bg-white">
                        <label className="text-xs text-slate-500 block mb-1">表示する見積書</label>
                        <select
                            value={selectedId ?? ''}
                            onChange={e => setSelectedId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                        >
                            {estimates.map(est => (
                                <option key={est.id} value={est.id}>
                                    {est.estimateNumber} - {est.title}（{STATUS_LABEL[est.status] ?? est.status}）
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* 本体 */}
                <div className="flex-1 overflow-y-auto overscroll-contain">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500" />
                        </div>
                    ) : error ? (
                        <div className="p-4 text-sm text-red-600 bg-red-50 m-4 rounded-xl">{error}</div>
                    ) : !selected ? (
                        <div className="p-6 text-center text-sm text-slate-500">
                            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                            この案件に紐づく見積書はありません。
                        </div>
                    ) : (
                        <div className="p-4 space-y-3">
                            <div className="space-y-1">
                                <h4 className="text-base font-semibold text-slate-900">{selected.title}</h4>
                                <p className="text-xs text-slate-500">No. {selected.estimateNumber}</p>
                            </div>

                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-center">
                                    <div className="text-slate-500">小計</div>
                                    <div className="font-semibold text-slate-900 tabular-nums">
                                        ¥{Math.round(selected.subtotal).toLocaleString()}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-center">
                                    <div className="text-slate-500">消費税</div>
                                    <div className="font-semibold text-slate-900 tabular-nums">
                                        ¥{Math.round(selected.tax).toLocaleString()}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-teal-200 bg-teal-50 px-2 py-2 text-center">
                                    <div className="text-teal-700">合計</div>
                                    <div className="font-semibold text-teal-800 tabular-nums">
                                        ¥{Math.round(selected.total).toLocaleString()}
                                    </div>
                                </div>
                            </div>

                            <div className="pt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-xs font-semibold text-slate-700">明細（チェックで選択）</h5>
                                    {onApplyToCosts && selected.items.length > 0 && (
                                        <div className="flex items-center gap-2 text-[11px]">
                                            <button type="button" onClick={handleSelectAll} className="text-teal-700 hover:underline">
                                                全選択
                                            </button>
                                            <span className="text-slate-300">|</span>
                                            <button type="button" onClick={handleClearAll} className="text-slate-500 hover:underline">
                                                解除
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {selected.items.length === 0 ? (
                                    <p className="text-xs text-slate-500">明細はありません。</p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {selected.items.map(item => (
                                            <EstimateItemRow
                                                key={item.id}
                                                item={item}
                                                expanded={expandedCategories.has(item.id)}
                                                onToggleExpand={() => toggleCategory(item.id)}
                                                selectedIds={selectedItemIds}
                                                onToggleSelect={toggleSelect}
                                                showCheckbox={!!onApplyToCosts}
                                            />
                                        ))}
                                    </ul>
                                )}
                            </div>

                            {selected.items.length > 0 && (
                                <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
                                    最終更新: {new Date(selected.updatedAt).toLocaleString('ja-JP')}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* 振り分けフッター */}
                {onApplyToCosts && selected && selected.items.length > 0 && (
                    <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50 px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] space-y-2.5">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500">
                                    選択 <span className="font-semibold text-slate-700">{selectedItemIds.size}</span> 項目
                                </span>
                                <span className="text-slate-500 tabular-nums">
                                    選択合計 <span className="font-medium text-slate-700">¥{selectedTotal.toLocaleString()}</span>
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <label htmlFor="manual-amount-input" className="text-[11px] text-slate-500 whitespace-nowrap">＋ 追加金額</label>
                                <div className="flex-1 flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-slate-500">
                                    <span className="text-xs text-slate-400">¥</span>
                                    <input
                                        id="manual-amount-input"
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        value={manualAmount}
                                        onChange={e => setManualAmount(e.target.value)}
                                        placeholder="0"
                                        className="flex-1 min-w-0 text-sm tabular-nums focus:outline-none bg-transparent text-right"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200">
                                <span className="text-slate-700 font-medium">合計</span>
                                <span className="font-semibold text-slate-900 tabular-nums">¥{totalAmount.toLocaleString()}</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <RateInput label="協力業者費" value={revenueRate} onChange={setRevenueRate} />
                            <RateInput label="組立配分" value={assemblyRate} onChange={setAssemblyRate} />
                            <RateInput label="解体配分" value={demolitionRate} onChange={setDemolitionRate} />
                        </div>
                        {!ratesValid && (
                            <p className="text-[11px] text-red-600">組立+解体配分は100%にしてください（現在 {aRate + dRate}%）</p>
                        )}
                        <div className="rounded-xl border border-teal-200 bg-white px-3 py-2 flex items-center justify-between text-xs">
                            <span className="text-slate-500">プレビュー</span>
                            <span className="tabular-nums">
                                組立 <span className="font-semibold text-slate-900">¥{assemblyCost.toLocaleString()}</span>
                                <span className="mx-1.5 text-slate-300">/</span>
                                解体 <span className="font-semibold text-slate-900">¥{demolitionCost.toLocaleString()}</span>
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={totalAmount <= 0 || !ratesValid}
                            className="w-full px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            組立・解体に反映
                        </button>
                    </div>
                )}
            </aside>
        </>
    );
}

interface RateInputProps {
    label: string;
    value: string;
    onChange: (v: string) => void;
}

function RateInput({ label, value, onChange }: RateInputProps) {
    return (
        <label className="block">
            <span className="text-[11px] text-slate-500 block mb-0.5">{label}</span>
            <div className="flex items-center gap-1 px-2 py-1.5 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-slate-500">
                <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className="flex-1 min-w-0 text-sm tabular-nums focus:outline-none bg-transparent"
                />
                <span className="text-xs text-slate-400">%</span>
            </div>
        </label>
    );
}

interface EstimateItemRowProps {
    item: EstimateItem;
    expanded: boolean;
    onToggleExpand: () => void;
    selectedIds: Set<string>;
    onToggleSelect: (item: EstimateItem) => void;
    showCheckbox: boolean;
}

function EstimateItemRow({ item, expanded, onToggleExpand, selectedIds, onToggleSelect, showCheckbox }: EstimateItemRowProps) {
    const isSelected = selectedIds.has(item.id);
    if (item.isCategory) {
        const children = item.children ?? [];
        return (
            <li className="rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-stretch">
                    {showCheckbox && (
                        <label className="flex items-center px-3 cursor-pointer" onClick={e => e.stopPropagation()}>
                            <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => onToggleSelect(item)}
                                className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                            />
                        </label>
                    )}
                    <button
                        type="button"
                        onClick={onToggleExpand}
                        className="flex-1 flex items-center justify-between gap-2 px-2 py-2 text-left"
                    >
                        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800 min-w-0">
                            {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                            <span className="truncate">{item.description || '(無題)'}</span>
                        </span>
                        <span className="text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            ¥{Math.round(item.amount || 0).toLocaleString()}
                        </span>
                    </button>
                </div>
                {expanded && children.length > 0 && (
                    <ul className="px-3 pb-2 space-y-1 border-t border-slate-200 pt-2">
                        {children.map(child => {
                            const childSelected = selectedIds.has(child.id);
                            return (
                                <li key={child.id} className="flex items-center gap-2">
                                    {showCheckbox && (
                                        <input
                                            type="checkbox"
                                            checked={childSelected}
                                            onChange={() => onToggleSelect(child)}
                                            className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                                        />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <DetailRow item={child} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </li>
        );
    }
    return (
        <li className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-center gap-2">
            {showCheckbox && (
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(item)}
                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                />
            )}
            <div className="flex-1 min-w-0">
                <DetailRow item={item} />
            </div>
        </li>
    );
}

function DetailRow({ item }: { item: EstimateItem }) {
    const qty = Number(item.quantity || 0);
    const price = Number(item.unitPrice || 0);
    const amount = Number(item.amount || 0);
    return (
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 truncate">{item.description || '(無題)'}</p>
                {item.specification && (
                    <p className="text-[11px] text-slate-500 truncate">{item.specification}</p>
                )}
                <p className="text-[11px] text-slate-500 tabular-nums">
                    {qty.toLocaleString()}{item.unit ? ` ${item.unit}` : ''} × ¥{price.toLocaleString()}
                </p>
            </div>
            <div className="text-sm font-medium text-slate-800 tabular-nums whitespace-nowrap">
                ¥{Math.round(amount).toLocaleString()}
            </div>
        </div>
    );
}
