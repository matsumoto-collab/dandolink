'use client';

import React from 'react';
import { Edit, Trash2 } from 'lucide-react';
import { highlightText } from '@/lib/highlightText';
import type { BillingDraft, BillingDraftStatus } from '@/types/billingDraft';

const STATUS_LABEL: Record<BillingDraftStatus, { label: string; bg: string; text: string }> = {
    pending: { label: '保留中', bg: 'bg-amber-100', text: 'text-amber-700' },
    confirmed: { label: '確定済', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    cancelled: { label: 'キャンセル', bg: 'bg-slate-200', text: 'text-slate-500' },
};

interface BillingDraftRowProps {
    draft: BillingDraft;
    /** 案件担当者の表示名（projectMaster.createdBy → managerMap で解決済み） */
    assigneeName: string;
    /** デバウンス済み検索クエリ。空文字のときはハイライトしない */
    highlightQuery: string;
    onEdit: (draft: BillingDraft) => void;
    onDelete: (draft: BillingDraft) => void;
    /** 請求書化の選択列を表示するか（Phase 3） */
    selectionEnabled?: boolean;
    /** この行が選択中か */
    selected?: boolean;
    /** チェックボックス切替（pending のみ有効） */
    onToggleSelect?: (draft: BillingDraft) => void;
}

function formatYen(amount: BillingDraft['amount']): string {
    if (amount == null) return '—';
    const n = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(n)) return '—';
    return `¥${n.toLocaleString()}`;
}

export default function BillingDraftRow({
    draft,
    assigneeName,
    highlightQuery,
    onEdit,
    onDelete,
    selectionEnabled = false,
    selected = false,
    onToggleSelect,
}: BillingDraftRowProps) {
    const status = STATUS_LABEL[draft.status];
    const isPending = draft.status === 'pending';
    const isConfirmed = draft.status === 'confirmed';
    const customerName = draft.customer?.name ?? '—';
    const projectName = draft.projectMaster?.name || draft.projectMaster?.title || '—';
    const createdByName = draft.createdBy?.displayName ?? '—';
    const q = highlightQuery;

    return (
        <tr className={`transition-colors ${selected ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
            {selectionEnabled && (
                <td className="px-4 py-4 whitespace-nowrap">
                    <input
                        type="checkbox"
                        checked={selected}
                        disabled={!isPending}
                        onChange={() => onToggleSelect?.(draft)}
                        title={isPending ? '請求書化の対象に含める' : '保留中のみ選択できます'}
                        aria-label="請求書化の対象に含める"
                        className="w-4 h-4 rounded border-slate-300 text-slate-700 focus:ring-2 focus:ring-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                </td>
            )}
            <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                {highlightText(customerName, q)}
            </td>
            <td className="px-6 py-4 text-[12px] text-slate-700">
                {highlightText(projectName, q)}
            </td>
            <td className="px-6 py-4 text-[12px] text-slate-800 font-medium">
                {highlightText(draft.title, q)}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-[12px] font-semibold text-slate-900 text-right">
                {formatYen(draft.amount)}
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${status.bg} ${status.text}`}
                >
                    {status.label}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                {highlightText(assigneeName || '—', q)}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                {highlightText(createdByName, q)}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-right text-[12px] font-medium">
                <button
                    type="button"
                    onClick={() => onEdit(draft)}
                    disabled={!isPending}
                    title={
                        isPending
                            ? '編集'
                            : isConfirmed
                              ? '確定済みは編集できません'
                              : 'キャンセル済みは編集できません'
                    }
                    className={`inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors mr-2 ${
                        isPending
                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            : 'bg-slate-50 text-slate-400 cursor-not-allowed'
                    }`}
                >
                    <Edit className="w-3.5 h-3.5" />
                    編集
                </button>
                <button
                    type="button"
                    onClick={() => onDelete(draft)}
                    disabled={isConfirmed}
                    title={isConfirmed ? '確定済みは削除できません' : '削除'}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                        !isConfirmed
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-slate-50 text-slate-400 cursor-not-allowed'
                    }`}
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    削除
                </button>
            </td>
        </tr>
    );
}
