// 現場調査（図面）の取得フック
// 設計書 §6.3 + 既存 useEstimates のパターン参考
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { SiteSurvey, SiteSurveyInput } from '@/types/site-survey';
import { logger } from '@/lib/logger';

interface UseSiteSurveysOptions {
    projectMasterId?: string;
    enabled?: boolean;
}

const ENDPOINT = '/api/site-surveys';

async function fetchList(projectMasterId?: string): Promise<SiteSurvey[]> {
    const url = projectMasterId
        ? `${ENDPOINT}?projectMasterId=${encodeURIComponent(projectMasterId)}`
        : ENDPOINT;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`現場調査一覧の取得に失敗しました (${res.status})`);
    return (await res.json()) as SiteSurvey[];
}

export function useSiteSurveys(options: UseSiteSurveysOptions = {}) {
    const { projectMasterId, enabled = true } = options;
    const { status } = useSession();
    const [siteSurveys, setSiteSurveys] = useState<SiteSurvey[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (status !== 'authenticated') return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchList(projectMasterId);
            setSiteSurveys(data);
            setIsInitialized(true);
        } catch (e) {
            const message = e instanceof Error ? e.message : '不明なエラー';
            logger.error('[useSiteSurveys] fetch error', e);
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [status, projectMasterId]);

    useEffect(() => {
        if (enabled && status === 'authenticated' && !isInitialized) {
            void refresh();
        }
    }, [enabled, status, isInitialized, refresh]);

    const create = useCallback(
        async (input: SiteSurveyInput): Promise<SiteSurvey> => {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error ?? `作成に失敗しました (${res.status})`);
            }
            const created = (await res.json()) as SiteSurvey;
            await refresh();
            return created;
        },
        [refresh],
    );

    const update = useCallback(
        async (id: string, patch: Partial<SiteSurveyInput>): Promise<SiteSurvey> => {
            const res = await fetch(`${ENDPOINT}/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error ?? `更新に失敗しました (${res.status})`);
            }
            const updated = (await res.json()) as SiteSurvey;
            await refresh();
            return updated;
        },
        [refresh],
    );

    const remove = useCallback(
        async (id: string): Promise<void> => {
            const res = await fetch(`${ENDPOINT}/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error ?? `削除に失敗しました (${res.status})`);
            }
            await refresh();
        },
        [refresh],
    );

    return {
        siteSurveys,
        isLoading,
        isInitialized,
        error,
        refresh,
        create,
        update,
        remove,
    };
}

// 単一レコード取得用のフック
export function useSiteSurvey(id: string | null) {
    const { status } = useSession();
    const [siteSurvey, setSiteSurvey] = useState<SiteSurvey | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!id || status !== 'authenticated') return;
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`${ENDPOINT}/${id}`, { cache: 'no-store' });
            if (res.status === 404) {
                setSiteSurvey(null);
                setError('指定された現場調査が見つかりません');
                return;
            }
            if (!res.ok) throw new Error(`取得に失敗しました (${res.status})`);
            setSiteSurvey((await res.json()) as SiteSurvey);
        } catch (e) {
            const message = e instanceof Error ? e.message : '不明なエラー';
            logger.error('[useSiteSurvey] fetch error', e);
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [id, status]);

    useEffect(() => {
        if (id && status === 'authenticated') {
            void refresh();
        }
    }, [id, status, refresh]);

    return { siteSurvey, isLoading, error, refresh, setSiteSurvey };
}
