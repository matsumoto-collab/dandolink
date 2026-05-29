'use client';

import React from 'react';
import { Edit, Trash2 } from 'lucide-react';
import BillingDraftRow from './BillingDraftRow';
import { highlightText } from '@/lib/highlightText';
import type { BillingDraft, BillingDraftStatus } from '@/types/billingDraft';

const STATUS_LABEL: Record<BillingDraftStatus, { label: string; bg: string; text: string }> = {
    pending: { label: '保留中', bg: 'bg-amber-100', text: 'text-amber-700' },
    confirmed: { label: '確定済', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    cancelled: { label: 'キャンセル', bg: 'bg-slate-200', text: 'text-slate-500' },
};

interface BillingDraftListProps {
    /** ページネーション済みの請求予定 */
    drafts: BillingDraft[];
    isLoading: boolean;
    isInitialized: boolean;
    /** デバウンス済み検索クエリ */
    highlightQuery: string;
    /** projectId → 担当者表示名（projectMaster.createdBy → /api/users で解決済み） */
    assigneeMap: Map<string, string>;
    onEdit: (draft: BillingDraft) => void;
    onDelete: (draft: BillingDraft) => void;
    currentPage: number;
    totalPages: number;
    /** フィルタ適用後の全件数（ページネーション前） */
    totalCount: number;
    onPageChange: (page: number) => void;
    /** フィルタが空かどうか（空表示の文言切替に使う） */
    hasActiveFilter: boolean;
    /** 請求書化の選択列を表示するか（Phase 3、未指定なら非表示） */
    selectionEnabled?: boolean;
    /** 選択中の draft ID 集合 */
    selectedIds?: Set<string>;
    /** チェックボックス切替（pending のみ） */
    onToggleSelect?: (draft: BillingDraft) => void;
    /** ヘッダの全選択切替 */
    onToggleSelectAll?: () => void;
    /** 表示中の pending がすべて選択済みか（ヘッダチェックボックス用） */
    allPendingSelected?: boolean;
    /** 表示中に選択可能な pending が存在するか */
    hasPendingInView?: boolean;
}

function formatYen(amount: BillingDraft['amount']): string {
    if (amount == null) return '—';
    const n = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(n)) return '—';
    return `¥${n.toLocaleString()}`;
}

export default function BillingDraftList({
    drafts,
    isLoading,
    isInitialized,
    highlightQuery,
    assigneeMap,
    onEdit,
    onDelete,
    currentPage,
    totalPages,
    totalCount,
    onPageChange,
    hasActiveFilter,
    selectionEnabled = false,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    allPendingSelected = false,
    hasPendingInView = false,
}: BillingDraftListProps) {
    const showSkeleton = !isInitialized || isLoading;
    const columnCount = selectionEnabled ? 9 : 8;
    const emptyMessage = hasActiveFilter
        ? '検索結果が見つかりませんでした'
        : '請求予定が登録されていません';

    return (
        <>
            {/* モバイル: カードビュー */}
            <div className="md:hidden flex-1 overflow-auto">
                {showSkeleton ? (
                    <div className="grid grid-cols-1 gap-3">
                        {[...Array(5)].map((_, i) => (
                            <div
                                key={i}
                                className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse"
                            >
                                <div className="h-5 bg-slate-200 rounded w-32 mb-3" />
                                <div className="h-4 bg-slate-200 rounded w-48 mb-2" />
                                <div className="h-6 bg-slate-200 rounded w-24 mb-2" />
                                <div className="h-5 bg-slate-200 rounded-full w-20" />
                            </div>
                        ))}
                    </div>
                ) : drafts.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-xl text-slate-500">
                        {emptyMessage}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {drafts.map((d) => {
                            const status = STATUS_LABEL[d.status];
                            const isPending = d.status === 'pending';
                            const isConfirmed = d.status === 'confirmed';
                            const customerName = d.customer?.name ?? '—';
                            const projectName =
                                d.projectMaster?.name || d.projectMaster?.title || '—';
                            const assigneeName = assigneeMap.get(d.projectId) || '';
                            const createdByName = d.createdBy?.displayName ?? '—';
                            return (
                                <div
                                    key={d.id}
                                    className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-start justify-between gap-3 mb-2">
                                        <div className="flex items-start gap-2 min-w-0">
                                            {selectionEnabled && (
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds?.has(d.id) ?? false}
                                                    disabled={!isPending}
                                                    onChange={() => onToggleSelect?.(d)}
                                                    aria-label="請求書化の対象に含める"
                                                    className="mt-0.5 w-4 h-4 shrink-0 rounded border-slate-300 text-slate-700 focus:ring-2 focus:ring-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                                />
                                            )}
                                            <div className="min-w-0">
                                                <div className="text-xs text-slate-500 mb-0.5">
                                                    {highlightText(customerName, highlightQuery)}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-800 break-words">
                                                    {highlightText(d.title, highlightQuery)}
                                                </div>
                                                <div className="text-xs text-slate-600 mt-1 break-words">
                                                    {highlightText(projectName, highlightQuery)}
                                                </div>
                                            </div>
                                        </div>
                                        <span
                                            className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.text}`}
                                        >
                                            {status.label}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-between mb-2">
                                        <span className="text-xs text-slate-500">金額（税抜）</span>
                                        <span className="text-base font-bold text-slate-900">
                                            {formatYen(d.amount)}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                                        <div>
                                            <span className="text-slate-400">担当者：</span>
                                            {highlightText(assigneeName || '—', highlightQuery)}
                                        </div>
                                        <div className="text-right">
                                            <span className="text-slate-400">作成者：</span>
                                            {highlightText(createdByName, highlightQuery)}
                                        </div>
                                    </div>
                                    <div className="mt-3 flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onEdit(d)}
                                            disabled={!isPending}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                                isPending
                                                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                                    : 'bg-slate-50 text-slate-400 cursor-not-allowed'
                                            }`}
                                        >
                                            <Edit className="w-3.5 h-3.5" /> 編集
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDelete(d)}
                                            disabled={isConfirmed}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                                !isConfirmed
                                                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                                    : 'bg-slate-50 text-slate-400 cursor-not-allowed'
                                            }`}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" /> 削除
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* デスクトップ: テーブルビュー */}
            <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
                <div className="flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100 sticky top-0 z-10">
                            <tr>
                                {selectionEnabled && (
                                    <th className="px-4 py-4 text-left w-10">
                                        <input
                                            type="checkbox"
                                            checked={allPendingSelected}
                                            disabled={!hasPendingInView}
                                            onChange={onToggleSelectAll}
                                            aria-label="表示中の保留中をすべて選択"
                                            title="表示中の保留中をすべて選択"
                                            className="w-4 h-4 rounded border-slate-300 text-slate-700 focus:ring-2 focus:ring-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                        />
                                    </th>
                                )}
                                <Th>顧客</Th>
                                <Th>案件</Th>
                                <Th>タイトル</Th>
                                <Th align="right">金額</Th>
                                <Th>ステータス</Th>
                                <Th>担当者</Th>
                                <Th>作成者</Th>
                                <Th align="right">操作</Th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {showSkeleton ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        {[...Array(columnCount)].map((_, j) => (
                                            <td key={j} className="px-6 py-4">
                                                <div className="h-4 bg-slate-200 rounded w-20" />
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : drafts.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={columnCount}
                                        className="px-6 py-12 text-center text-slate-500"
                                    >
                                        {emptyMessage}
                                    </td>
                                </tr>
                            ) : (
                                drafts.map((d) => (
                                    <BillingDraftRow
                                        key={d.id}
                                        draft={d}
                                        assigneeName={assigneeMap.get(d.projectId) || ''}
                                        highlightQuery={highlightQuery}
                                        onEdit={onEdit}
                                        onDelete={onDelete}
                                        selectionEnabled={selectionEnabled}
                                        selected={selectedIds?.has(d.id) ?? false}
                                        onToggleSelect={onToggleSelect}
                                    />
                                ))
                            )}
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

            {/* 統計情報 */}
            <div className="mt-4 flex-shrink-0 text-sm text-slate-600">全 {totalCount} 件</div>
        </>
    );
}

function Th({
    children,
    align = 'left',
}: {
    children: React.ReactNode;
    align?: 'left' | 'right';
}) {
    const alignClass = align === 'right' ? 'text-right' : 'text-left';
    return (
        <th
            className={`px-6 py-4 ${alignClass} text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap`}
        >
            {children}
        </th>
    );
}
