'use client';

import React, { useMemo } from 'react';
import { Search, RotateCw } from 'lucide-react';
import SearchableSelect from '@/components/ui/SearchableSelect';
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

    /** 担当者（案件担当者）での絞り込み */
    assigneeIdFilter: string;
    onAssigneeChange: (id: string) => void;

    createdByIdFilter: string;
    onCreatedByChange: (id: string) => void;

    customers: Customer[];
    projectMasters: ProjectMaster[];
    /** 案件担当者の (id, name) リスト */
    assigneeOptions: Array<{ id: string; name: string }>;
    /** 一覧から派生した作成者の (id, displayName) リスト */
    createdByOptions: Array<{ id: string; name: string }>;

    onRefresh?: () => void;
}

const FILTER_WIDTH = 'w-[200px]';

export default function BillingDraftFilters({
    searchTerm,
    onSearchChange,
    statusFilter,
    onStatusChange,
    customerIdFilter,
    onCustomerChange,
    projectIdFilter,
    onProjectChange,
    assigneeIdFilter,
    onAssigneeChange,
    createdByIdFilter,
    onCreatedByChange,
    customers,
    projectMasters,
    assigneeOptions,
    createdByOptions,
    onRefresh,
}: BillingDraftFiltersProps) {
    const customerOptions = useMemo(
        () => customers.map((c) => ({ id: c.id, label: c.shortName || c.name })),
        [customers],
    );
    const projectOptions = useMemo(
        () => projectMasters.map((pm) => ({ id: pm.id, label: pm.name || pm.title })),
        [projectMasters],
    );
    const assigneeSelectOptions = useMemo(
        () => assigneeOptions.map((o) => ({ id: o.id, label: o.name })),
        [assigneeOptions],
    );
    const createdBySelectOptions = useMemo(
        () => createdByOptions.map((o) => ({ id: o.id, label: o.name })),
        [createdByOptions],
    );

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

            {/* 個別フィルタ（顧客 / ステータス / 案件 / 担当者 / 作成者）+ 更新ボタン。
                顧客・案件・担当者・作成者は検索付きコンボボックス（候補が多くても入力で素早く絞り込める）。 */}
            <div className="flex flex-wrap gap-2 items-center">
                <SearchableSelect
                    className={FILTER_WIDTH}
                    options={customerOptions}
                    value={customerIdFilter}
                    onChange={onCustomerChange}
                    placeholder="顧客（全て）"
                    emptyLabel="顧客（全て）"
                    searchable
                />

                <select
                    value={statusFilter}
                    onChange={(e) => onStatusChange(e.target.value as BillingDraftStatus | 'all')}
                    className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white w-[150px]"
                    aria-label="ステータスで絞り込み"
                >
                    <option value="all">ステータス（全て）</option>
                    <option value="pending">保留中</option>
                    <option value="confirmed">確定済</option>
                    <option value="cancelled">キャンセル</option>
                </select>

                <SearchableSelect
                    className={FILTER_WIDTH}
                    options={projectOptions}
                    value={projectIdFilter}
                    onChange={onProjectChange}
                    placeholder="案件（全て）"
                    emptyLabel="案件（全て）"
                    searchable
                />

                <SearchableSelect
                    className={FILTER_WIDTH}
                    options={assigneeSelectOptions}
                    value={assigneeIdFilter}
                    onChange={onAssigneeChange}
                    placeholder="担当者（全て）"
                    emptyLabel="担当者（全て）"
                    searchable
                />

                <SearchableSelect
                    className={FILTER_WIDTH}
                    options={createdBySelectOptions}
                    value={createdByIdFilter}
                    onChange={onCreatedByChange}
                    placeholder="作成者（全て）"
                    emptyLabel="作成者（全て）"
                    searchable
                />

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
