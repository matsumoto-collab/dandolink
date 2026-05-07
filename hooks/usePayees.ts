'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Payee, PayeeInput } from '@/types/payee';
import { logger } from '@/lib/logger';

/**
 * 振込先マスターを管理するシンプルなフック
 * Customer 等のように Zustand Store ではなく、自己完結型で管理
 */
export function usePayees(opts: { activeOnly?: boolean } = {}) {
    const { status } = useSession();
    const [payees, setPayees] = useState<Payee[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    const fetchPayees = useCallback(async () => {
        try {
            setIsLoading(true);
            const url = opts.activeOnly ? '/api/payees?activeOnly=1' : '/api/payees';
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error('振込先の取得に失敗しました');
            const data = await res.json();
            setPayees(data);
            setIsInitialized(true);
        } catch (e) {
            logger.error('Failed to fetch payees:', e);
            throw e;
        } finally {
            setIsLoading(false);
        }
    }, [opts.activeOnly]);

    const ensureDataLoaded = useCallback(async () => {
        if (status === 'authenticated' && !isInitialized) {
            await fetchPayees();
        }
    }, [status, isInitialized, fetchPayees]);

    useEffect(() => {
        if (status === 'authenticated' && !isInitialized) {
            fetchPayees();
        }
    }, [status, isInitialized, fetchPayees]);

    const addPayee = useCallback(async (data: PayeeInput) => {
        const res = await fetch('/api/payees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '振込先の追加に失敗しました');
        }
        await fetchPayees();
    }, [fetchPayees]);

    const updatePayee = useCallback(async (id: string, data: Partial<PayeeInput>) => {
        const res = await fetch(`/api/payees/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '振込先の更新に失敗しました');
        }
        await fetchPayees();
    }, [fetchPayees]);

    const deletePayee = useCallback(async (id: string) => {
        const res = await fetch(`/api/payees/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '振込先の削除に失敗しました');
        }
        await fetchPayees();
    }, [fetchPayees]);

    return {
        payees,
        isLoading,
        isInitialized,
        ensureDataLoaded,
        refreshPayees: fetchPayees,
        addPayee,
        updatePayee,
        deletePayee,
    };
}
