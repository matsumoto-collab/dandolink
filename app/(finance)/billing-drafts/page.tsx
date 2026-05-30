'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { useDebounce } from '@/hooks/useDebounce';
import { useBillingDrafts } from '@/hooks/useBillingDrafts';
import { useCustomers } from '@/hooks/useCustomers';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import BillingDraftFilters from '@/components/BillingDraft/BillingDraftFilters';
import BillingDraftList, { type BillingDraftCustomerGroup } from '@/components/BillingDraft/BillingDraftList';
import { billingDraftToInvoiceItems } from '@/lib/billing/draftToInvoiceItem';
import type { BillingDraft, BillingDraftStatus } from '@/types/billingDraft';
import type { InvoiceInput } from '@/types/invoice';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { logger } from '@/lib/logger';

// FormPanel は重め（CRUD フォーム）なので遅延読み込み
const BillingDraftFormPanel = dynamic(
    () => import('@/components/BillingDraft/BillingDraftFormPanel'),
    { ssr: false, loading: () => null },
);

// 請求書化プレビュー（既存の請求書作成フォームを転用）。重いので遅延読み込み。
const InvoiceModal = dynamic(() => import('@/components/Invoices/InvoiceModal'), {
    ssr: false,
    loading: () => null,
});

const ITEMS_PER_PAGE = 20;

export default function BillingDraftListPage() {
    const { data: session, status: sessionStatus } = useSession();
    const role = session?.user?.role;
    const isAuthorized = role === 'admin' || role === 'manager';

    // フィルタ・検索ステート
    const [statusFilter, setStatusFilter] = useState<BillingDraftStatus | 'all'>('all');
    const [customerIdFilter, setCustomerIdFilter] = useState('');
    const [projectIdFilter, setProjectIdFilter] = useState('');
    const [createdByIdFilter, setCreatedByIdFilter] = useState('');
    const [assigneeIdFilter, setAssigneeIdFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedQuery = useDebounce(searchTerm, 300);

    const trimmedQuery = debouncedQuery.trim();

    const { drafts, isLoading, isInitialized, refresh, create, update, remove, unconfirm } = useBillingDrafts({
        status: statusFilter === 'all' ? undefined : statusFilter,
        customerId: customerIdFilter || undefined,
        projectId: projectIdFilter || undefined,
        createdById: createdByIdFilter || undefined,
        q: trimmedQuery || undefined,
    });

    const { customers, ensureDataLoaded: ensureCustomersLoaded } = useCustomers();
    const { projectMasters, fetchProjectMasters } = useProjectMasters();

    useEffect(() => {
        if (!isAuthorized) return;
        ensureCustomersLoaded();
        fetchProjectMasters();
    }, [isAuthorized, ensureCustomersLoaded, fetchProjectMasters]);

    // /api/users から id → displayName マップを構築（案件担当者の解決用）
    const [userMap, setUserMap] = useState<Record<string, string>>({});
    useEffect(() => {
        if (!isAuthorized) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/users', { cache: 'no-store' });
                if (!res.ok) return;
                const users: Array<{ id: string; displayName: string }> = await res.json();
                if (cancelled) return;
                const map: Record<string, string> = {};
                for (const u of users) map[u.id] = u.displayName;
                setUserMap(map);
            } catch (e) {
                logger.error('ユーザー一覧の取得に失敗:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAuthorized]);

    // 案件 ID → 担当者表示名の Map（案件マスタの createdBy + userMap から導出）
    const assigneeMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const pm of projectMasters) {
            const ids = extractAssigneeIds(pm.createdBy);
            const names = ids.map((id) => userMap[id]).filter(Boolean);
            m.set(pm.id, names.join('、'));
        }
        return m;
    }, [projectMasters, userMap]);

    // 案件ID → 担当者ユーザーID配列（担当者フィルタ判定用）
    const projectAssigneeIds = useMemo(() => {
        const m = new Map<string, string[]>();
        for (const pm of projectMasters) m.set(pm.id, extractAssigneeIds(pm.createdBy));
        return m;
    }, [projectMasters]);

    // 担当者の絞り込み候補（案件担当者のユニーク一覧、名前順）
    const assigneeOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const pm of projectMasters) {
            for (const id of extractAssigneeIds(pm.createdBy)) {
                const name = userMap[id];
                if (name && !seen.has(id)) seen.set(id, name);
            }
        }
        return Array.from(seen.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [projectMasters, userMap]);

    // 担当者フィルタはクライアント側で適用（サーバーは status/customer/project/createdBy/q で絞り込み済み）。
    // 案件担当者は ProjectMaster.createdBy（JSON 配列）由来で API クエリに無いため、ここで案件単位に突き合わせる。
    const filteredDrafts = useMemo(() => {
        if (!assigneeIdFilter) return drafts;
        return drafts.filter((d) => (projectAssigneeIds.get(d.projectId) ?? []).includes(assigneeIdFilter));
    }, [drafts, assigneeIdFilter, projectAssigneeIds]);

    // 作成者ドロップダウン候補：取得済みの drafts から重複排除して抽出
    const createdByOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const d of drafts) {
            if (d.createdBy?.id && !seen.has(d.createdBy.id)) {
                seen.set(d.createdBy.id, d.createdBy.displayName);
            }
        }
        return Array.from(seen.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [drafts]);

    // 請求書化（顧客ごとにグループ化 → チェック → プレビュー → Invoice 発行）
    const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
    const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
    const [invoiceInitialData, setInvoiceInitialData] = useState<Partial<InvoiceInput> | undefined>(undefined);
    const [issuingDraftIds, setIssuingDraftIds] = useState<string[]>([]);

    // 顧客ごとにグループ化（見出しに件数・合計・選択状況を集計）
    const customerGroups = useMemo<BillingDraftCustomerGroup[]>(() => {
        const map = new Map<string, BillingDraft[]>();
        for (const d of filteredDrafts) {
            const arr = map.get(d.customerId);
            if (arr) arr.push(d);
            else map.set(d.customerId, [d]);
        }
        const groups = Array.from(map.entries()).map(([customerId, ds]) => {
            const pending = ds.filter((d) => d.status === 'pending');
            const pendingTotal = pending.reduce((s, d) => s + (d.amount != null ? Number(d.amount) : 0), 0);
            const selectedPendingCount = pending.filter((d) => selectedDraftIds.has(d.id)).length;
            return {
                customerId,
                customerName: ds[0].customer?.name ?? '—',
                drafts: ds,
                pendingCount: pending.length,
                pendingTotal,
                selectedPendingCount,
                allPendingSelected: pending.length > 0 && selectedPendingCount === pending.length,
            };
        });
        groups.sort((a, b) => a.customerName.localeCompare(b.customerName, 'ja'));
        return groups;
    }, [filteredDrafts, selectedDraftIds]);

    // ページネーション（顧客グループ単位）
    const [currentPage, setCurrentPage] = useState(1);
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, customerIdFilter, projectIdFilter, createdByIdFilter, assigneeIdFilter, trimmedQuery]);
    const totalPages = Math.max(1, Math.ceil(customerGroups.length / ITEMS_PER_PAGE));
    const paginatedGroups = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return customerGroups.slice(start, start + ITEMS_PER_PAGE);
    }, [customerGroups, currentPage]);

    // FormPanel ステート
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [editingDraft, setEditingDraft] = useState<BillingDraft | null>(null);

    // 顧客フィルタが変わったら、その顧客の pending を既定で全チェック（顧客ごとに 1 回だけ）
    const lastAutofillKeyRef = useRef<string>('');
    useEffect(() => {
        if (!customerIdFilter) {
            lastAutofillKeyRef.current = '';
            return;
        }
        if (!isInitialized || isLoading) return;
        if (lastAutofillKeyRef.current === customerIdFilter) return;
        setSelectedDraftIds(new Set(filteredDrafts.filter((d) => d.status === 'pending').map((d) => d.id)));
        lastAutofillKeyRef.current = customerIdFilter;
    }, [customerIdFilter, isInitialized, isLoading, filteredDrafts]);

    const handleToggleSelect = useCallback((draft: BillingDraft) => {
        setSelectedDraftIds((prev) => {
            const next = new Set(prev);
            if (next.has(draft.id)) next.delete(draft.id);
            else next.add(draft.id);
            return next;
        });
    }, []);

    // 顧客の保留中をすべて選択 / 解除
    const handleToggleSelectCustomer = useCallback(
        (customerId: string) => {
            const group = customerGroups.find((g) => g.customerId === customerId);
            if (!group) return;
            const ids = group.drafts.filter((d) => d.status === 'pending').map((d) => d.id);
            setSelectedDraftIds((prev) => {
                const next = new Set(prev);
                const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
                if (allSelected) ids.forEach((id) => next.delete(id));
                else ids.forEach((id) => next.add(id));
                return next;
            });
        },
        [customerGroups],
    );

    // その顧客で請求書を作成（選択中の保留中が対象。1 顧客 = 1 請求書）
    const handleCreateInvoiceForCustomer = useCallback(
        (customerId: string) => {
            const group = customerGroups.find((g) => g.customerId === customerId);
            if (!group) return;
            const chosen = group.drafts.filter((d) => selectedDraftIds.has(d.id) && d.status === 'pending');
            if (chosen.length === 0) {
                toast.error('請求書化する請求予定を選択してください');
                return;
            }
            // D-f: 金額未入力（null）は確認のうえ除外。0 円は明示として通す。
            let finalDrafts = chosen;
            const nullAmount = chosen.filter((d) => d.amount == null);
            if (nullAmount.length > 0) {
                const ok = window.confirm(`金額が未入力の請求予定が ${nullAmount.length} 件あります。除外して続けますか？`);
                if (!ok) return;
                finalDrafts = chosen.filter((d) => d.amount != null);
                if (finalDrafts.length === 0) {
                    toast.error('金額が入力された請求予定がありません');
                    return;
                }
            }
            const projectMasterIds = Array.from(new Set(finalDrafts.map((d) => d.projectId)));
            const items = finalDrafts.flatMap((d) => billingDraftToInvoiceItems(d));
            setIssuingDraftIds(finalDrafts.map((d) => d.id));
            // 件名は空欄（D-h、未入力では InvoiceForm が発行を弾く）。発行日/支払期限は InvoiceForm 既定。
            setInvoiceInitialData({ customerId, projectMasterIds, items, title: '' });
            setIsInvoiceModalOpen(true);
        },
        [customerGroups, selectedDraftIds],
    );

    const handleCloseInvoiceModal = useCallback(() => {
        setIsInvoiceModalOpen(false);
        setInvoiceInitialData(undefined);
        setIssuingDraftIds([]);
    }, []);

    const handleIssueInvoice = useCallback(
        async (data: InvoiceInput) => {
            try {
                const res = await fetch('/api/invoices/from-billing-drafts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    cache: 'no-store',
                    body: JSON.stringify({
                        billingDraftIds: issuingDraftIds,
                        title: data.title,
                        dueDate: data.dueDate instanceof Date ? data.dueDate.toISOString() : data.dueDate,
                        status: data.status,
                        notes: data.notes ?? null,
                        items: data.items,
                    }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error || '請求書の発行に失敗しました');
                }
                toast.success('請求書を発行しました');
                setIsInvoiceModalOpen(false);
                setInvoiceInitialData(undefined);
                setIssuingDraftIds([]);
                setSelectedDraftIds(new Set());
                lastAutofillKeyRef.current = ''; // 残りの pending を再オートフィルできるように
                await refresh();
            } catch (e) {
                logger.error('Failed to issue invoice from billing drafts:', e);
                toast.error(e instanceof Error ? e.message : '請求書の発行に失敗しました');
            }
        },
        [issuingDraftIds, refresh],
    );

    const handleNewClick = useCallback(() => {
        setEditingDraft(null);
        setIsPanelOpen(true);
    }, []);

    const handleEdit = useCallback((draft: BillingDraft) => {
        setEditingDraft(draft);
        setIsPanelOpen(true);
    }, []);

    const handleClosePanel = useCallback(() => {
        setIsPanelOpen(false);
        setEditingDraft(null);
    }, []);

    const handleDelete = useCallback(
        async (draft: BillingDraft) => {
            if (draft.status === 'confirmed') {
                toast.error('確定済みの請求予定は「確定解除」してから削除してください');
                return;
            }
            if (!window.confirm(`「${draft.title}」を削除してもよろしいですか？`)) return;
            try {
                await remove(draft.id);
                toast.success('請求予定を削除しました');
            } catch (e) {
                logger.error('Failed to delete billing draft:', e);
                toast.error(e instanceof Error ? e.message : '削除に失敗しました');
            }
        },
        [remove],
    );

    // 確定解除：確定済み → 保留中に戻す。請求書との紐づけは外れる（請求書本体は残る）。
    const handleUnconfirm = useCallback(
        async (draft: BillingDraft) => {
            if (draft.status !== 'confirmed') return;
            const invNo = draft.invoice?.invoiceNumber;
            const msg = invNo
                ? `「${draft.title}」を保留中に戻します。\n\n発行済み請求書 ${invNo} との紐づけを解除します（請求書自体は残ります）。重複請求を避けるため、不要な請求書は請求書一覧から削除してください。\n\n確定解除しますか？`
                : `「${draft.title}」を保留中に戻します。確定解除しますか？`;
            if (!window.confirm(msg)) return;
            try {
                await unconfirm(draft.id);
                toast.success('確定解除しました（保留中に戻しました）');
            } catch (e) {
                logger.error('Failed to unconfirm billing draft:', e);
                toast.error(e instanceof Error ? e.message : '確定解除に失敗しました');
            }
        },
        [unconfirm],
    );

    const hasActiveFilter =
        statusFilter !== 'all' ||
        !!customerIdFilter ||
        !!projectIdFilter ||
        !!assigneeIdFilter ||
        !!createdByIdFilter ||
        !!trimmedQuery;

    // 権限ガード：admin / manager 以外は非マウント（DOM に出さない）
    if (sessionStatus === 'loading') return null;
    if (!isAuthorized) return null;

    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6 flex-shrink-0 flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">請求予定</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        請求書化前の予定を管理します。確定済みは「確定解除」で保留中に戻すと編集・削除できます。
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                        variant="primary"
                        leftIcon={<Plus className="w-5 h-5" />}
                        onClick={handleNewClick}
                    >
                        <span className="hidden sm:inline">新規請求予定</span>
                        <span className="sm:hidden">新規</span>
                    </Button>
                </div>
            </div>

            <BillingDraftFilters
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                statusFilter={statusFilter}
                onStatusChange={setStatusFilter}
                customerIdFilter={customerIdFilter}
                onCustomerChange={setCustomerIdFilter}
                projectIdFilter={projectIdFilter}
                onProjectChange={setProjectIdFilter}
                assigneeIdFilter={assigneeIdFilter}
                onAssigneeChange={setAssigneeIdFilter}
                createdByIdFilter={createdByIdFilter}
                onCreatedByChange={setCreatedByIdFilter}
                customers={customers}
                projectMasters={projectMasters}
                assigneeOptions={assigneeOptions}
                createdByOptions={createdByOptions}
                onRefresh={refresh}
            />

            <BillingDraftList
                groups={paginatedGroups}
                isLoading={isLoading}
                isInitialized={isInitialized}
                highlightQuery={trimmedQuery}
                assigneeMap={assigneeMap}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUnconfirm={handleUnconfirm}
                currentPage={currentPage}
                totalPages={totalPages}
                totalCount={filteredDrafts.length}
                onPageChange={setCurrentPage}
                hasActiveFilter={hasActiveFilter}
                selectedIds={selectedDraftIds}
                onToggleSelect={handleToggleSelect}
                onToggleSelectCustomer={handleToggleSelectCustomer}
                onCreateInvoiceForCustomer={handleCreateInvoiceForCustomer}
            />

            <BillingDraftFormPanel
                open={isPanelOpen}
                draft={editingDraft}
                customers={customers}
                projectMasters={projectMasters}
                onClose={handleClosePanel}
                onCreate={create}
                onUpdate={update}
            />

            {isInvoiceModalOpen && (
                <InvoiceModal
                    isOpen={isInvoiceModalOpen}
                    onClose={handleCloseInvoiceModal}
                    onSubmit={handleIssueInvoice}
                    initialData={invoiceInitialData}
                />
            )}
        </div>
    );
}
