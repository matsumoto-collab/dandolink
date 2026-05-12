'use client';

import React, { useEffect, useState } from 'react';
import { X, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { EstimateItem } from '@/types/estimate';
import { logger } from '@/lib/logger';

interface EstimatePreviewSlideOverProps {
    isOpen: boolean;
    onClose: () => void;
    projectMasterId: string;
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

export function EstimatePreviewSlideOver({ isOpen, onClose, projectMasterId }: EstimatePreviewSlideOverProps) {
    const [estimates, setEstimates] = useState<EstimateSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!isOpen || !projectMasterId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetch(`/api/estimates?projectMasterId=${encodeURIComponent(projectMasterId)}`, { cache: 'no-store' })
            .then(async res => {
                if (!res.ok) throw new Error('見積書の取得に失敗しました');
                return res.json();
            })
            .then((data: EstimateSummary[]) => {
                if (cancelled) return;
                setEstimates(data);
                setSelectedId(data[0]?.id ?? null);
                // 最初はカテゴリを全展開
                const ids = new Set<string>();
                (data[0]?.items ?? []).forEach(item => {
                    if (item.isCategory) ids.add(item.id);
                });
                setExpandedCategories(ids);
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

    // Escキーで閉じる
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    const selected = estimates.find(e => e.id === selectedId) ?? null;

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <>
            {/* 背景クリックで閉じる（透過、モーダルは見えたまま） */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-[65]"
                    onClick={onClose}
                    aria-hidden="true"
                />
            )}
            {/* スライドオーバーパネル */}
            <aside
                role="dialog"
                aria-label="見積書プレビュー"
                aria-hidden={!isOpen}
                className={`fixed top-0 right-0 h-full w-full max-w-md z-[66] bg-white shadow-2xl border-l border-slate-200 flex flex-col transform transition-transform duration-300 ease-out ${
                    isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
                }`}
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 border-b border-slate-200 px-4 py-3 flex items-center justify-between bg-slate-50">
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-5 h-5 text-teal-600 shrink-0" />
                        <h3 className="text-sm font-semibold text-slate-900 truncate">見積書プレビュー</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
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
                                <h5 className="text-xs font-semibold text-slate-700 mb-2">明細</h5>
                                {selected.items.length === 0 ? (
                                    <p className="text-xs text-slate-500">明細はありません。</p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {selected.items.map(item => (
                                            <EstimateItemRow
                                                key={item.id}
                                                item={item}
                                                expanded={expandedCategories.has(item.id)}
                                                onToggle={() => toggleCategory(item.id)}
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
            </aside>
        </>
    );
}

interface EstimateItemRowProps {
    item: EstimateItem;
    expanded: boolean;
    onToggle: () => void;
}

function EstimateItemRow({ item, expanded, onToggle }: EstimateItemRowProps) {
    if (item.isCategory) {
        const children = item.children ?? [];
        return (
            <li className="rounded-xl border border-slate-200 bg-slate-50">
                <button
                    type="button"
                    onClick={onToggle}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800 min-w-0">
                        {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                        <span className="truncate">{item.description || '(無題)'}</span>
                    </span>
                    <span className="text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        ¥{Math.round(item.amount || 0).toLocaleString()}
                    </span>
                </button>
                {expanded && children.length > 0 && (
                    <ul className="px-3 pb-2 space-y-1 border-t border-slate-200 pt-2">
                        {children.map(child => (
                            <DetailRow key={child.id} item={child} />
                        ))}
                    </ul>
                )}
            </li>
        );
    }
    return (
        <li className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <DetailRow item={item} />
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
