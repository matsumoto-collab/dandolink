'use client';

import React from 'react';
import { Search, RotateCw } from 'lucide-react';
import type { Customer } from '@/types/customer';
import type { ProjectMaster } from '@/types/calendar';
import type { BillingDraftStatus } from '@/types/billingDraft';

interface BillingDraftFiltersProps {
    /** 検索バー入力値（生のステート、デバウンスは親側） */
    searchTerm: string;
    onSearchChange: (v: string) => void;

    statusFilter: BillingDraftStatus | 'all';
    onStatusChange: (s: BillingDraftStatus | 'all') => void;

    customerIdFilter: string;
    onCustomerChange: (id: string) => void;

    projectIdFilter: string;
    onProjectChange: (id: string) => void;

    createdByIdFilter: string;
    onCreatedByChange: (id: string) => void;

    customers: Customer[];
    projectMasters: ProjectMaster[];
    /** 一覧から派生した作成者の (id, displayName) リスト */
    createdByOptions: Array<{ id: string; name: string }>;

    onRefresh?: () => void;
}

const SELECT_CLASS =
    'px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm max-w-[220px]';

export default function BillingDraftFilters({
    searchTerm,
    onSearchChange,
    statusFilter,
    onStatusChange,
    customerIdFilter,
    onCustomerChange,
    projectIdFilter,
    onProjectChange,
    createdByIdFilter,
    onCreatedByChange,
    customers,
    projectMasters,
    createdByOptions,
    onRefresh,
}: BillingDraftFiltersProps) {
    return (
        <div className="mb-4 flex-shrink-0 flex flex-col gap-3">
            {/* 横断検索バー */}
            <div className="relative w-full sm:max-w-2xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="担当者 / 案件名 / 顧客名 / タイトル / メモ で検索..."
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm bg-white"
                />
            </div>

            {/* 個別フィルタ（顧客 / ステータス / 案件 / 作成者）+ 更新ボタン */}
            <div className="flex flex-wrap gap-2 items-center">
                <select
                    value={customerIdFilter}
                    onChange={(e) => onCustomerChange(e.target.value)}
                    className={SELECT_CLASS}
                    aria-label="顧客で絞り込み"
                >
                    <option value="">顧客（全て）</option>
                    {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.shortName || c.name}
                        </option>
                    ))}
                </select>

                <select
                    value={statusFilter}
                    onChange={(e) =>
                        onStatusChange(e.target.value as BillingDraftStatus | 'all')
                    }
                    className={SELECT_CLASS}
                    aria-label="ステータスで絞り込み"
                >
                    <option value="all">ステータス（全て）</option>
                    <option value="pending">保留中</option>
                    <option value="confirmed">確定済</option>
                    <option value="cancelled">キャンセル</option>
                </select>

                <select
                    value={projectIdFilter}
                    onChange={(e) => onProjectChange(e.target.value)}
                    className={SELECT_CLASS}
                    aria-label="案件で絞り込み"
                >
                    <option value="">案件（全て）</option>
                    {projectMasters.map((pm) => (
                        <option key={pm.id} value={pm.id}>
                            {pm.name || pm.title}
                        </option>
                    ))}
                </select>

                <select
                    value={createdByIdFilter}
                    onChange={(e) => onCreatedByChange(e.target.value)}
                    className={SELECT_CLASS}
                    aria-label="作成者で絞り込み"
                >
                    <option value="">作成者（全て）</option>
                    {createdByOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.name}
                        </option>
                    ))}
                </select>

                {onRefresh && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
                        title="一覧を再取得"
                    >
                        <RotateCw className="w-4 h-4" />
                        更新
                    </button>
                )}
            </div>
        </div>
    );
}
