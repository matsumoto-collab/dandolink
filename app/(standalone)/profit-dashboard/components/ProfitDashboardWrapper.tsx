'use client';

import React, { useState, useMemo } from 'react';
import { useProfitDashboard } from '@/contexts/ProfitDashboardContext';
import ProfitDashboardClient from './ProfitDashboardClient';
import ProfitDashboardLoading from '../loading';

export default function ProfitDashboardWrapper() {
    const { isLoading, isInitialLoaded, getFilteredData, refreshData } = useProfitDashboard();
    const [status, setStatus] = useState('active');

    const filteredData = useMemo(() => {
        return getFilteredData(status);
    }, [status, getFilteredData]);

    if (!isInitialLoaded || isLoading) {
        return <ProfitDashboardLoading />;
    }

    return (
        <ProfitDashboardClient
            projects={filteredData.projects}
            summary={filteredData.summary}
            byCustomer={filteredData.byCustomer}
            byConstructionType={filteredData.byConstructionType}
            byForeman={filteredData.byForeman}
            currentStatus={status}
            onStatusChange={setStatus}
            onRefresh={refreshData}
        />
    );
}
