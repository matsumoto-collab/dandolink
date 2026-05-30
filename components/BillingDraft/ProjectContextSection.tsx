'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Receipt, ExternalLink } from 'lucide-react';
import type {
    ProjectContext,
    ProjectContextHistoryItem,
} from '@/types/billingDraft';

/**
 * 請求予定サイドパネル上部に表示する案件サマリ。
 *
 * Phase 2 起動経路（カレンダー右クリック / 案件詳細「請求予定を追加」ボタン）からのみ表示。
 * 請求予定タブ（Phase 1）からの起動時は親が projectContext を渡さないため非表示。
 */

interface ProjectContextSectionProps {
    projectContext: ProjectContext;
}

const yen = (n: number): string => `¥${n.toLocaleString()}`;

const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${dd}`;
};

const ESTIMATE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    approved: { label: '承認', cls: 'bg-emerald-100 text-emerald-700' },
    draft: { label: '下書き', cls: 'bg-slate-200 text-slate-600' },
    sent: { label: '送付済', cls: 'bg-blue-100 text-blue-700' },
    rejected: { label: '却下', cls: 'bg-rose-100 text-rose-700' },
};

const BILLING_DRAFT_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    pending: { label: '保留中', cls: 'bg-amber-100 text-amber-700' },
    confirmed: { label: '確定済', cls: 'bg-emerald-100 text-emerald-700' },
    cancelled: { label: 'キャンセル', cls: 'bg-slate-200 text-slate-500' },
};

const INVOICE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    draft: { label: '下書き', cls: 'bg-slate-200 text-slate-600' },
    sent: { label: '送付済', cls: 'bg-blue-100 text-blue-700' },
    paid: { label: '支払済', cls: 'bg-emerald-100 text-emerald-700' },
    overdue: { label: '期限超過', cls: 'bg-rose-100 text-rose-700' },
    cancelled: { label: 'キャンセル', cls: 'bg-slate-200 text-slate-500' },
};

const fallbackBadge = (status: string) => ({
    label: status,
    cls: 'bg-slate-100 text-slate-600',
});

function HistoryRow({ item }: { item: ProjectContextHistoryItem }) {
    const statusMap =
        item.type === 'billing-draft' ? BILLING_DRAFT_STATUS_LABEL : INVOICE_STATUS_LABEL;
    const status = statusMap[item.status] ?? fallbackBadge(item.status);
    const typeLabel = item.type === 'billing-draft' ? '請求予定' : '請求書';
    const typeCls =
        item.type === 'billing-draft'
            ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-blue-50 text-blue-700 border border-blue-200';
    const amount = item.amount;
    return (
        <li className="flex items-start justify-between gap-2 text-xs">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                        className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeCls}`}
                    >
                        {typeLabel}
                    </span>
                    <span
                        className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${status.cls}`}
                    >
                        {status.label}
                    </span>
                    {item.type === 'invoice' && (
                        <span className="shrink-0 text-[10px] text-slate-500">
                            {item.invoiceNumber}
                        </span>
                    )}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-700 truncate">{item.title}</div>
                <div className="text-[10px] text-slate-500">{formatDate(item.createdAt)}</div>
            </div>
            <span className="shrink-0 text-slate-900 font-semibold tabular-nums">
                {amount != null ? yen(amount) : '—'}
            </span>
        </li>
    );
}

export default function ProjectContextSection({ projectContext }: ProjectContextSectionProps) {
    const { contractAmount, totalInvoicedAmount, estimates, history } = projectContext;
    const [openEstimates, setOpenEstimates] = useState(true);
    const [openHistory, setOpenHistory] = useState(false);

    const remainingEstimates = Math.max(0, estimates.totalCount - estimates.items.length);

    // 見積額（代表＝approved 優先 / 最新が先頭。税別）と、残り（見積額 − この案件の請求済み）
    const estimateAmount = estimates.items[0]?.subtotal ?? null;
    const remaining = estimateAmount != null ? estimateAmount - totalInvoicedAmount : null;

    return (
        <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            {/* 金額情報 */}
            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">見積額<span className="text-slate-400">（税別）</span></div>
                    <div className="text-sm font-bold text-slate-900">
                        {estimateAmount != null ? yen(estimateAmount) : '—'}
                    </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">この案件の請求済み<span className="text-slate-400">（税別）</span></div>
                    <div className="text-sm font-bold text-slate-900">{yen(totalInvoicedAmount)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">残り<span className="text-slate-400">（見積−請求済）</span></div>
                    <div className={`text-sm font-bold ${remaining != null && remaining < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                        {remaining == null
                            ? '—'
                            : remaining < 0
                              ? `-¥${Math.abs(remaining).toLocaleString()}`
                              : yen(remaining)}
                    </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">契約金額</div>
                    <div className="text-sm font-bold text-slate-900">
                        {contractAmount != null ? yen(contractAmount) : '未設定'}
                    </div>
                </div>
            </div>

            {/* 見積書 ▼ */}
            <div className="rounded-xl border border-slate-200 bg-white">
                <button
                    type="button"
                    onClick={() => setOpenEstimates((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    aria-expanded={openEstimates}
                >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                        <FileText className="w-4 h-4" />
                        見積書 ({estimates.totalCount})
                    </span>
                    {openEstimates ? (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                    )}
                </button>
                {openEstimates && (
                    <div className="px-3 pb-3">
                        {estimates.items.length === 0 ? (
                            <p className="text-xs text-slate-500">見積書はありません</p>
                        ) : (
                            <ul className="space-y-1.5">
                                {estimates.items.map((e) => {
                                    const status =
                                        ESTIMATE_STATUS_LABEL[e.status] ?? fallbackBadge(e.status);
                                    return (
                                        <li key={e.id}>
                                            <button
                                                type="button"
                                                onClick={() => window.open(`/estimates/${e.id}`, '_blank', 'noopener,noreferrer')}
                                                title="見積書（PDF）を新しいタブで開く"
                                                className="w-full flex items-start justify-between gap-2 text-xs text-left rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-slate-100 transition-colors"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${status.cls}`}
                                                        >
                                                            {status.label}
                                                        </span>
                                                        <span className="truncate text-slate-800 font-medium">
                                                            {e.title}
                                                        </span>
                                                        <ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
                                                    </div>
                                                    <div className="mt-0.5 text-[10px] text-slate-500">
                                                        {e.estimateNumber}　{formatDate(e.createdAt)}
                                                        {e.createdByName ? `　${e.createdByName}` : ''}
                                                    </div>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <div className="text-slate-900 font-semibold tabular-nums">{yen(e.subtotal)}</div>
                                                    <div className="text-[9px] text-slate-400 leading-none">税別</div>
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {remainingEstimates > 0 && (
                            <p className="mt-2 text-[11px] text-slate-500">他 {remainingEstimates} 件</p>
                        )}
                    </div>
                )}
            </div>

            {/* 履歴 ▼ */}
            <div className="rounded-xl border border-slate-200 bg-white">
                <button
                    type="button"
                    onClick={() => setOpenHistory((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    aria-expanded={openHistory}
                >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                        <Receipt className="w-4 h-4" />
                        履歴 ({history.length})
                    </span>
                    {openHistory ? (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                    )}
                </button>
                {openHistory && (
                    <div className="px-3 pb-3">
                        {history.length === 0 ? (
                            <p className="text-xs text-slate-500">履歴はありません</p>
                        ) : (
                            <ul className="space-y-1.5">
                                {history.map((h) => (
                                    <HistoryRow key={`${h.type}-${h.id}`} item={h} />
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
