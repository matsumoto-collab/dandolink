'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/logger';
import type {
    BillingDraft,
    BillingDraftListParams,
    CreateBillingDraftInput,
    UpdateBillingDraftInput,
} from '@/types/billingDraft';

/**
 * 請求予定（BillingDraft）CRUD クライアントフック。
 *
 * - 一覧取得は params の値（status / customerId / projectId / createdById / q / includeDeleted）に
 *   応じて GET /api/billing-drafts に問い合わせる。
 * - PATCH / POST / DELETE 後は自動で一覧を refetch（Realtime は Phase 1 では未採用、§17.18.1 D3）。
 * - 既存 hooks/usePaymentSchedules.ts と同じ手動 refetch パターンを踏襲。
 */
export function useBillingDrafts(params: BillingDraftListParams = {}) {
    const { status: authStatus } = useSession();
    const [drafts, setDrafts] = useState<BillingDraft[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // params の各フィールドを依存配列に展開（オブジェクトを直接 deps に入れると毎回再フェッチ）
    const { status, customerId, projectId, createdById, q, includeDeleted } = params;

    const url = useMemo(() => {
        const usp = new URLSearchParams();
        if (status) usp.set('status', status);
        if (customerId) usp.set('customerId', customerId);
        if (projectId) usp.set('projectId', projectId);
        if (createdById) usp.set('createdById', createdById);
        if (q && q.trim()) usp.set('q', q.trim());
        if (includeDeleted) usp.set('includeDeleted', '1');
        const qs = usp.toString();
        return qs ? `/api/billing-drafts?${qs}` : '/api/billing-drafts';
    }, [status, customerId, projectId, createdById, q, includeDeleted]);

    const fetchDrafts = useCallback(async () => {
        try {
            setIsLoading(true);
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error('請求予定の取得に失敗しました');
            const data = (await res.json()) as BillingDraft[];
            setDrafts(data);
            setIsInitialized(true);
        } catch (e) {
            logger.error('Failed to fetch billing drafts:', e);
            throw e;
        } finally {
            setIsLoading(false);
        }
    }, [url]);

    useEffect(() => {
        if (authStatus !== 'authenticated') return;
        fetchDrafts().catch(() => {/* logged inside fetchDrafts */});
    }, [authStatus, fetchDrafts]);

    const create = useCallback(async (data: CreateBillingDraftInput) => {
        const res = await fetch('/api/billing-drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '請求予定の作成に失敗しました');
        }
        await fetchDrafts();
    }, [fetchDrafts]);

    const update = useCallback(async (id: string, data: UpdateBillingDraftInput) => {
        const res = await fetch(`/api/billing-drafts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '請求予定の更新に失敗しました');
        }
        await fetchDrafts();
    }, [fetchDrafts]);

    const remove = useCallback(async (id: string) => {
        const res = await fetch(`/api/billing-drafts/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '請求予定の削除に失敗しました');
        }
        await fetchDrafts();
    }, [fetchDrafts]);

    // 確定解除：確定済み → 保留中に戻す（戻した後は編集・削除可能になる）
    const unconfirm = useCallback(async (id: string) => {
        const res = await fetch(`/api/billing-drafts/${id}/unconfirm`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '確定解除に失敗しました');
        }
        await fetchDrafts();
    }, [fetchDrafts]);

    return {
        drafts,
        isLoading,
        isInitialized,
        refresh: fetchDrafts,
        create,
        update,
        remove,
        unconfirm,
    };
}
