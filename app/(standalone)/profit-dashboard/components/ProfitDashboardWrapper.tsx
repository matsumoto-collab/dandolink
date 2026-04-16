'use client';

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import ProfitDashboardClient, { type SerializedProjectProfit } from './ProfitDashboardClient';
import ProfitDashboardLoading from '../loading';
import type { DashboardSummary, AggregateRow, FilterOptions } from '@/lib/profitDashboard';

interface InitialPayload {
    projects: SerializedProjectProfit[];
    summary: DashboardSummary;
    byCustomer: AggregateRow[];
    byConstructionType: AggregateRow[];
    byForeman: AggregateRow[];
}

export default function ProfitDashboardWrapper() {
    const [initial, setInitial] = useState<InitialPayload | null>(null);
    const [options, setOptions] = useState<FilterOptions | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [dataRes, optRes] = await Promise.all([
                    fetch('/api/profit-dashboard?status=active', { cache: 'no-store' }),
                    fetch('/api/profit-dashboard?options=1', { cache: 'no-store' }),
                ]);
                if (!dataRes.ok || !optRes.ok) throw new Error('failed');
                const data = await dataRes.json();
                const opt = await optRes.json();
                if (cancelled) return;
                setInitial(data);
                setOptions(opt);
            } catch (e) {
                logger.error('Failed to load profit dashboard:', e);
                toast.error('収益データの取得に失敗しました');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (!initial || !options) {
        return <ProfitDashboardLoading />;
    }

    return (
        <ProfitDashboardClient
            projects={initial.projects}
            summary={initial.summary}
            byCustomer={initial.byCustomer}
            byConstructionType={initial.byConstructionType}
            byForeman={initial.byForeman}
            filterOptions={options}
            initialFilters={{ status: 'active' }}
        />
    );
}
