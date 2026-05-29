'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import BillingDraftList from '@/components/BillingDraft/BillingDraftList';
import type { BillingDraft, BillingDraftStatus } from '@/types/billingDraft';
import type { ProjectMaster } from '@/types/calendar';
import { logger } from '@/lib/logger';

// FormPanel は重め（CRUD フォーム）なので遅延読み込み
const BillingDraftFormPanel = dynamic(
    () => import('@/components/BillingDraft/BillingDraftFormPanel'),
    { ssr: false, loading: () => null },
);

const ITEMS_PER_PAGE = 20;

/**
 * 案件マスタの `createdBy` を担当者 ID 配列に正規化する。
 * - 配列ならそのまま
 * - JSON 文字列（["id1","id2"]）なら parse
 * - 単独文字列なら 1 要素配列
 * - null / undefined / 不正値は空配列
 *
 * 経緯: §MEMORY.md「ProjectMaster 担当者フィールドの落とし穴」参照。
 */
function extractAssigneeIds(createdBy: ProjectMaster['createdBy']): string[] {
    if (!createdBy) return [];
    if (Array.isArray(createdBy)) return createdBy.filter(Boolean);
    if (typeof createdBy === 'string') {
        const trimmed = createdBy.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed.filter(Boolean) : [trimmed];
            } catch {
                return [trimmed];
            }
        }
        return [trimmed];
    }
    return [];
}

export default function BillingDraftListPage() {
    const { data: session, status: sessionStatus } = useSession();
    const role = session?.user?.role;
    const isAuthorized = role === 'admin' || role === 'manager';

    // フィルタ・検索ステート
    const [statusFilter, setStatusFilter] = useState<BillingDraftStatus | 'all'>('all');
    const [customerIdFilter, setCustomerIdFilter] = useState('');
    const [projectIdFilter, setProjectIdFilter] = useState('');
    const [createdByIdFilter, setCreatedByIdFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedQuery = useDebounce(searchTerm, 300);

    const trimmedQuery = debouncedQuery.trim();

    const { drafts, isLoading, isInitialized, refresh, create, update, remove } = useBillingDrafts({
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

    // ページネーション
    const [currentPage, setCurrentPage] = useState(1);
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, customerIdFilter, projectIdFilter, createdByIdFilter, trimmedQuery]);

    const totalPages = Math.max(1, Math.ceil(drafts.length / ITEMS_PER_PAGE));
    const paginatedDrafts = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return drafts.slice(start, start + ITEMS_PER_PAGE);
    }, [drafts, currentPage]);

    // FormPanel ステート
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [editingDraft, setEditingDraft] = useState<BillingDraft | null>(null);

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
                toast.error('確定済みの請求予定は削除できません');
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

    const hasActiveFilter =
        statusFilter !== 'all' ||
        !!customerIdFilter ||
        !!projectIdFilter ||
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
                        請求書化前の予定を管理します。確定済みは編集・削除できません。
                    </p>
                </div>
                <Button
                    variant="primary"
                    leftIcon={<Plus className="w-5 h-5" />}
                    onClick={handleNewClick}
                >
                    <span className="hidden sm:inline">新規請求予定</span>
                    <span className="sm:hidden">新規</span>
                </Button>
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
                createdByIdFilter={createdByIdFilter}
                onCreatedByChange={setCreatedByIdFilter}
                customers={customers}
                projectMasters={projectMasters}
                createdByOptions={createdByOptions}
                onRefresh={refresh}
            />

            <BillingDraftList
                drafts={paginatedDrafts}
                isLoading={isLoading}
                isInitialized={isInitialized}
                highlightQuery={trimmedQuery}
                assigneeMap={assigneeMap}
                onEdit={handleEdit}
                onDelete={handleDelete}
                currentPage={currentPage}
                totalPages={totalPages}
                totalCount={drafts.length}
                onPageChange={setCurrentPage}
                hasActiveFilter={hasActiveFilter}
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
        </div>
    );
}
