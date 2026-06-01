'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Edit, Trash2, RotateCcw } from 'lucide-react';
import BillingDraftRow from './BillingDraftRow';
import { highlightText } from '@/lib/highlightText';
import type { BillingDraft, BillingDraftStatus } from '@/types/billingDraft';

const STATUS_LABEL: Record<BillingDraftStatus, { label: string; bg: string; text: string }> = {
    pending: { label: '保留中', bg: 'bg-amber-100', text: 'text-amber-700' },
    confirmed: { label: '確定済', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    cancelled: { label: 'キャンセル', bg: 'bg-slate-200', text: 'text-slate-500' },
};

/** 顧客ごとの請求予定グループ（page.tsx で集計して渡す） */
export interface BillingDraftCustomerGroup {
    customerId: string;
    customerName: string;
    drafts: BillingDraft[];
    /** 保留中（請求可能）の件数 */
    pendingCount: number;
    /** 保留中の金額合計（税抜） */
    pendingTotal: number;
    /** 保留中のうち選択中の件数 */
    selectedPendingCount: number;
    /** 保留中をすべて選択済みか */
    allPendingSelected: boolean;
}

interface BillingDraftListProps {
    /** ページネーション済みの顧客グループ */
    groups: BillingDraftCustomerGroup[];
    isLoading: boolean;
    isInitialized: boolean;
    highlightQuery: string;
    /** projectId → 担当者表示名 */
    assigneeMap: Map<string, string>;
    onEdit: (draft: BillingDraft) => void;
    onDelete: (draft: BillingDraft) => void;
    /** 確定済み → 保留中に戻す（戻すと編集・削除できるようになる） */
    onUnconfirm: (draft: BillingDraft) => void;
    currentPage: number;
    totalPages: number;
    /** フィルタ適用後の総件数（明細件数） */
    totalCount: number;
    onPageChange: (page: number) => void;
    hasActiveFilter: boolean;
    selectedIds: Set<string>;
    onToggleSelect: (draft: BillingDraft) => void;
    /** 顧客の保留中をすべて選択/解除 */
    onToggleSelectCustomer: (customerId: string) => void;
    /** その顧客で請求書を作成（選択中の保留中が対象） */
    onCreateInvoiceForCustomer: (customerId: string) => void;
}

function formatYen(amount: BillingDraft['amount']): string {
    if (amount == null) return '—';
    const n = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(n)) return '—';
    return `¥${n.toLocaleString()}`;
}

const yen = (n: number) => `¥${n.toLocaleString()}`;

/** 顧客グループ見出しの中身（トグル・顧客名・集計・請求ボタン）。デスクトップ td / モバイル div で共用。 */
function GroupHeaderInner({
    group,
    expanded,
    onToggleExpand,
    onCreateInvoiceForCustomer,
}: {
    group: BillingDraftCustomerGroup;
    expanded: boolean;
    onToggleExpand: () => void;
    onCreateInvoiceForCustomer: (customerId: string) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={expanded}
                className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
            >
                {expanded ? (
                    <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                )}
                <span className="font-semibold text-slate-800 truncate">{group.customerName}</span>
                <span className="shrink-0 text-xs text-slate-500 whitespace-nowrap">
                    未請求 {group.pendingCount}件・{yen(group.pendingTotal)}（税抜）
                    {group.drafts.length > group.pendingCount && (
                        <span className="text-slate-400">・全{group.drafts.length}件</span>
                    )}
                </span>
            </button>
            <button
                type="button"
                onClick={() => onCreateInvoiceForCustomer(group.customerId)}
                disabled={group.selectedPendingCount === 0}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={group.selectedPendingCount === 0 ? '保留中を選択すると請求書を作成できます' : undefined}
            >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">請求書を作成</span>
                <span className="lg:hidden">請求</span>
                {group.selectedPendingCount > 0 && `（${group.selectedPendingCount}）`}
            </button>
        </div>
    );
}

/** モバイル用：1 請求予定のカード（顧客はグループ見出しにあるため省略） */
function MobileDraftCard({
    draft,
    assigneeName,
    highlightQuery,
    selected,
    onToggleSelect,
    onEdit,
    onDelete,
    onUnconfirm,
}: {
    draft: BillingDraft;
    assigneeName: string;
    highlightQuery: string;
    selected: boolean;
    onToggleSelect: (d: BillingDraft) => void;
    onEdit: (d: BillingDraft) => void;
    onDelete: (d: BillingDraft) => void;
    onUnconfirm: (d: BillingDraft) => void;
}) {
    const status = STATUS_LABEL[draft.status];
    const isPending = draft.status === 'pending';
    const isConfirmed = draft.status === 'confirmed';
    const projectName = draft.projectMaster?.name || draft.projectMaster?.title || '—';
    const createdByName = draft.createdBy?.displayName ?? '—';
    return (
        <div className="border border-slate-200 rounded-xl p-3 bg-white">
            <div className="flex items-start gap-2">
                <input
                    type="checkbox"
                    checked={selected}
                    disabled={!isPending}
                    onChange={() => onToggleSelect(draft)}
                    aria-label="請求書化の対象に含める"
                    className="mt-0.5 w-4 h-4 shrink-0 rounded border-slate-300 text-slate-700 focus:ring-2 focus:ring-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800 break-words min-w-0">
                            {highlightText(draft.title, highlightQuery)}
                        </div>
                        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.text}`}>
                            {status.label}
                        </span>
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5 break-words">
                        {highlightText(projectName, highlightQuery)}
                    </div>
                    <div className="flex items-baseline justify-between mt-1.5">
                        <span className="text-[11px] text-slate-500 min-w-0 truncate">
                            {highlightText(assigneeName || '—', highlightQuery)}
                            <span className="text-slate-300 mx-1">/</span>
                            {highlightText(createdByName, highlightQuery)}
                        </span>
                        <span className="text-base font-bold text-slate-900 shrink-0">{formatYen(draft.amount)}</span>
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                        {isConfirmed && (
                            <button
                                type="button"
                                onClick={() => onUnconfirm(draft)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                            >
                                <RotateCcw className="w-3.5 h-3.5" /> 確定解除
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => onEdit(draft)}
                            disabled={!isPending}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${isPending ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-slate-50 text-slate-400 cursor-not-allowed'}`}
                        >
                            <Edit className="w-3.5 h-3.5" /> 編集
                        </button>
                        <button
                            type="button"
                            onClick={() => onDelete(draft)}
                            disabled={isConfirmed}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${!isConfirmed ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-slate-50 text-slate-400 cursor-not-allowed'}`}
                        >
                            <Trash2 className="w-3.5 h-3.5" /> 削除
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function BillingDraftList({
    groups,
    isLoading,
    isInitialized,
    highlightQuery,
    assigneeMap,
    onEdit,
    onDelete,
    onUnconfirm,
    currentPage,
    totalPages,
    totalCount,
    onPageChange,
    hasActiveFilter,
    selectedIds,
    onToggleSelect,
    onToggleSelectCustomer,
    onCreateInvoiceForCustomer,
}: BillingDraftListProps) {
    const showSkeleton = !isInitialized || isLoading;
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    // 顧客が 1 グループだけ（顧客で絞り込んだ等）のときは自動展開
    const autoExpandAll = groups.length === 1;
    const isExpanded = (id: string) => autoExpandAll || expandedIds.has(id);
    const toggleExpand = (id: string) =>
        setExpandedIds((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });

    const emptyMessage = hasActiveFilter ? '検索結果が見つかりませんでした' : '請求予定が登録されていません';

    if (showSkeleton) {
        return (
            <div className="flex-1 overflow-auto space-y-3">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
                        <div className="h-6 bg-slate-200 rounded w-1/3" />
                    </div>
                ))}
            </div>
        );
    }

    if (groups.length === 0) {
        return (
            <div className="flex-1">
                <div className="text-center py-12 bg-slate-50 rounded-xl text-slate-500">{emptyMessage}</div>
            </div>
        );
    }

    return (
        <>
            {/* デスクトップ: ひとつのテーブル（顧客は見出し行・列は全体で揃う） */}
            <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
                <div className="flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100 sticky top-0 z-20">
                            <tr>
                                <th className="px-4 py-3 w-10" />
                                <Th>案件</Th>
                                <Th>タイトル</Th>
                                <Th align="right">金額</Th>
                                <Th>ステータス</Th>
                                <Th>担当者</Th>
                                <Th>作成者</Th>
                                <Th align="right">操作</Th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {groups.map((g) => {
                                const expanded = isExpanded(g.customerId);
                                return (
                                    <React.Fragment key={g.customerId}>
                                        {/* 顧客グループ見出し行 */}
                                        <tr className="bg-slate-50 border-t-2 border-slate-200">
                                            <td className="px-4 py-2.5 align-middle">
                                                <input
                                                    type="checkbox"
                                                    checked={g.allPendingSelected}
                                                    disabled={g.pendingCount === 0}
                                                    onChange={() => onToggleSelectCustomer(g.customerId)}
                                                    title="この顧客の保留中をすべて選択"
                                                    aria-label="この顧客の保留中をすべて選択"
                                                    className="w-4 h-4 rounded border-slate-300 text-slate-700 focus:ring-2 focus:ring-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                                />
                                            </td>
                                            <td colSpan={7} className="px-3 py-2">
                                                <GroupHeaderInner
                                                    group={g}
                                                    expanded={expanded}
                                                    onToggleExpand={() => toggleExpand(g.customerId)}
                                                    onCreateInvoiceForCustomer={onCreateInvoiceForCustomer}
                                                />
                                            </td>
                                        </tr>
                                        {/* 明細行 */}
                                        {expanded &&
                                            g.drafts.map((d) => (
                                                <BillingDraftRow
                                                    key={d.id}
                                                    draft={d}
                                                    hideCustomer
                                                    selectionEnabled
                                                    assigneeName={assigneeMap.get(d.projectId) || ''}
                                                    highlightQuery={highlightQuery}
                                                    selected={selectedIds.has(d.id)}
                                                    onToggleSelect={onToggleSelect}
                                                    onEdit={onEdit}
                                                    onDelete={onDelete}
                                                    onUnconfirm={onUnconfirm}
                                                />
                                            ))}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div className="flex-shrink-0 flex justify-center items-center gap-2 py-3 border-t border-slate-200">
                        <button
                            type="button"
                            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            前へ
                        </button>
                        <span className="text-sm font-medium text-slate-600 px-4">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            次へ
                        </button>
                    </div>
                )}
            </div>

            {/* モバイル: 顧客ごとセクション（カード） */}
            <div className="md:hidden flex-1 overflow-auto space-y-3 min-h-0">
                {groups.map((g) => {
                    const expanded = isExpanded(g.customerId);
                    return (
                        <div key={g.customerId} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-100">
                                <input
                                    type="checkbox"
                                    checked={g.allPendingSelected}
                                    disabled={g.pendingCount === 0}
                                    onChange={() => onToggleSelectCustomer(g.customerId)}
                                    aria-label="この顧客の保留中をすべて選択"
                                    className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-700 focus:ring-2 focus:ring-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                />
                                <div className="flex-1 min-w-0">
                                    <GroupHeaderInner
                                        group={g}
                                        expanded={expanded}
                                        onToggleExpand={() => toggleExpand(g.customerId)}
                                        onCreateInvoiceForCustomer={onCreateInvoiceForCustomer}
                                    />
                                </div>
                            </div>
                            {expanded && (
                                <div className="p-3 space-y-2">
                                    {g.drafts.map((d) => (
                                        <MobileDraftCard
                                            key={d.id}
                                            draft={d}
                                            assigneeName={assigneeMap.get(d.projectId) || ''}
                                            highlightQuery={highlightQuery}
                                            selected={selectedIds.has(d.id)}
                                            onToggleSelect={onToggleSelect}
                                            onEdit={onEdit}
                                            onDelete={onDelete}
                                            onUnconfirm={onUnconfirm}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-2 py-3">
                        <button
                            type="button"
                            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            前へ
                        </button>
                        <span className="text-sm font-medium text-slate-600 px-4">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            次へ
                        </button>
                    </div>
                )}
            </div>

            <div className="mt-3 flex-shrink-0 text-sm text-slate-600">全 {totalCount} 件</div>
        </>
    );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
    const alignClass = align === 'right' ? 'text-right' : 'text-left';
    return (
        <th
            className={`px-6 py-3 ${alignClass} text-[11px] font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap`}
        >
            {children}
        </th>
    );
}
