'use client';

import React, { useState, useMemo } from 'react';
import { useProfitDashboard } from '@/contexts/ProfitDashboardContext';
import ProfitDashboardClient from './ProfitDashboardClient';
import ProfitDashboardLoading from '../loading';

/**
 * Client Component版の利益ダッシュボード
 * MainContent.tsxから使用される
 * Contextからキャッシュされたデータを使用
 */
export default function ProfitDashboardWrapper() {
    const { isLoading, isInitialLoaded, getFilteredData, refreshData } = useProfitDashboard();
    const [status, setStatus] = useState('active');

    // ステータスでフィルタリングしたデータを取得
    const filteredData = useMemo(() => {
        return getFilteredData(status);
    }, [status, getFilteredData]);

    // 初回読み込み中
    if (!isInitialLoaded || isLoading) {
        return <ProfitDashboardLoading />;
    }

    return (
        <ProfitDashboardClient
            projects={filteredData.projects}
            summary={filteredData.summary}
            currentStatus={status}
            onStatusChange={setStatus}
            onRefresh={refreshData}
        />
    );
}
