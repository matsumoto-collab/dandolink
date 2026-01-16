'use client';

import React, { useState, useEffect } from 'react';
import ProfitDashboardClient from './ProfitDashboardClient';
import ProfitDashboardLoading from '../loading';

interface ProjectProfit {
    id: string;
    title: string;
    customerName: string | null;
    status: string;
    assignmentCount: number;
    estimateAmount: number;
    revenue: number;
    laborCost: number;
    loadingCost: number;
    vehicleCost: number;
    materialCost: number;
    subcontractorCost: number;
    otherExpenses: number;
    totalCost: number;
    grossProfit: number;
    profitMargin: number;
    updatedAt: string;
}

interface DashboardSummary {
    totalProjects: number;
    totalRevenue: number;
    totalCost: number;
    totalGrossProfit: number;
    averageProfitMargin: number;
}

interface DashboardData {
    projects: ProjectProfit[];
    summary: DashboardSummary;
}

/**
 * Client Component版の利益ダッシュボード
 * MainContent.tsxから使用される
 */
export default function ProfitDashboardWrapper() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [status, setStatus] = useState('active');

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams();
                if (status !== 'all') {
                    params.set('status', status);
                }
                params.set('mode', 'full');

                const response = await fetch(`/api/profit-dashboard?${params.toString()}`);
                if (response.ok) {
                    const result = await response.json();
                    setData({
                        projects: result.projects,
                        summary: result.summary,
                    });
                }
            } catch (error) {
                console.error('Failed to fetch dashboard data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [status]);

    if (isLoading || !data) {
        return <ProfitDashboardLoading />;
    }

    return (
        <ProfitDashboardClient
            projects={data.projects}
            summary={data.summary}
            currentStatus={status}
            onStatusChange={setStatus}
        />
    );
}
