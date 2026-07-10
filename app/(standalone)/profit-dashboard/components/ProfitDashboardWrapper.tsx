'use client';

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import ProfitDashboardClient from './ProfitDashboardClient';
import ProfitDashboardLoading from '../loading';
import type { MonthlySalesData } from '@/lib/profitDashboard';

// SPA（/?page=profit-dashboard）経由のエントリ。サーバーページと同じ Client に合流する。
export default function ProfitDashboardWrapper() {
    const [monthlySales, setMonthlySales] = useState<MonthlySalesData | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/profit-dashboard', { cache: 'no-store' });
                if (!res.ok) throw new Error('failed');
                const data = await res.json();
                if (!cancelled) setMonthlySales(data.monthlySales);
            } catch (e) {
                logger.error('Failed to load profit dashboard:', e);
                toast.error('収益データの取得に失敗しました');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (!monthlySales) {
        return <ProfitDashboardLoading />;
    }

    return <ProfitDashboardClient monthlySales={monthlySales} />;
}
