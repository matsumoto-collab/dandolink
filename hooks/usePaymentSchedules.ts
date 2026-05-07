'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PaymentSchedule, PaymentScheduleInput, PaymentType } from '@/types/paymentSchedule';
import { logger } from '@/lib/logger';

export interface PaymentSchedulesQuery {
    year?: number;
    month?: number;
    paymentType?: PaymentType;
    isPaid?: boolean;
    from?: string;
    to?: string;
}

export function usePaymentSchedules(query: PaymentSchedulesQuery = {}) {
    const { status } = useSession();
    const [items, setItems] = useState<PaymentSchedule[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    const buildUrl = useCallback(() => {
        const params = new URLSearchParams();
        if (query.year !== undefined) params.set('year', String(query.year));
        if (query.month !== undefined) params.set('month', String(query.month));
        if (query.paymentType) params.set('paymentType', query.paymentType);
        if (query.isPaid === true) params.set('isPaid', '1');
        if (query.isPaid === false) params.set('isPaid', '0');
        if (query.from) params.set('from', query.from);
        if (query.to) params.set('to', query.to);
        const qs = params.toString();
        return qs ? `/api/payment-schedules?${qs}` : '/api/payment-schedules';
    }, [query.year, query.month, query.paymentType, query.isPaid, query.from, query.to]);

    const fetchItems = useCallback(async () => {
        try {
            setIsLoading(true);
            const res = await fetch(buildUrl(), { cache: 'no-store' });
            if (!res.ok) throw new Error('支払予定の取得に失敗しました');
            const data = await res.json();
            setItems(data);
            setIsInitialized(true);
        } catch (e) {
            logger.error('Failed to fetch payment schedules:', e);
            throw e;
        } finally {
            setIsLoading(false);
        }
    }, [buildUrl]);

    useEffect(() => {
        if (status !== 'authenticated') return;
        fetchItems();
    }, [status, fetchItems]);

    const addItem = useCallback(async (data: PaymentScheduleInput) => {
        const res = await fetch('/api/payment-schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '支払予定の追加に失敗しました');
        }
        await fetchItems();
    }, [fetchItems]);

    const updateItem = useCallback(async (id: string, data: Partial<PaymentScheduleInput>) => {
        const res = await fetch(`/api/payment-schedules/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '支払予定の更新に失敗しました');
        }
        await fetchItems();
    }, [fetchItems]);

    const deleteItem = useCallback(async (id: string) => {
        const res = await fetch(`/api/payment-schedules/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '支払予定の削除に失敗しました');
        }
        await fetchItems();
    }, [fetchItems]);

    const togglePaid = useCallback(async (id: string, isPaid: boolean) => {
        await updateItem(id, { isPaid });
    }, [updateItem]);

    return {
        items,
        isLoading,
        isInitialized,
        refresh: fetchItems,
        addItem,
        updateItem,
        deleteItem,
        togglePaid,
    };
}
