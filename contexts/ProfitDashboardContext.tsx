'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';

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

interface ProfitDashboardContextType {
    projects: ProjectProfit[];
    isLoading: boolean;
    isInitialLoaded: boolean;
    getFilteredData: (status: string) => { projects: ProjectProfit[]; summary: DashboardSummary };
    refreshData: () => Promise<void>;
}

const ProfitDashboardContext = createContext<ProfitDashboardContextType | undefined>(undefined);

export function ProfitDashboardProvider({ children }: { children: React.ReactNode }) {
    const { status: authStatus } = useSession();
    const [projects, setProjects] = useState<ProjectProfit[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoaded, setIsInitialLoaded] = useState(false);

    // データ取得（全データを取得してクライアントでフィルタリング）
    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/profit-dashboard?mode=full');
            if (response.ok) {
                const result = await response.json();
                setProjects(result.projects);
                setIsInitialLoaded(true);
            }
        } catch (error) {
            console.error('Failed to fetch profit dashboard data:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // 認証後に初回データを自動取得
    useEffect(() => {
        if (authStatus === 'authenticated' && !isInitialLoaded) {
            fetchData();
        }
    }, [authStatus, isInitialLoaded, fetchData]);

    // ステータスでフィルタリングしたデータとサマリーを返す
    const getFilteredData = useCallback((status: string) => {
        const filtered = status === 'all'
            ? projects
            : projects.filter(p => p.status === status);

        const summary: DashboardSummary = {
            totalProjects: filtered.length,
            totalRevenue: filtered.reduce((sum, p) => sum + p.revenue, 0),
            totalCost: filtered.reduce((sum, p) => sum + p.totalCost, 0),
            totalGrossProfit: filtered.reduce((sum, p) => sum + p.grossProfit, 0),
            averageProfitMargin: filtered.length > 0
                ? Math.round(filtered.reduce((sum, p) => sum + p.profitMargin, 0) / filtered.length * 10) / 10
                : 0,
        };

        return { projects: filtered, summary };
    }, [projects]);

    // 手動更新
    const refreshData = useCallback(async () => {
        await fetchData();
    }, [fetchData]);

    const contextValue = useMemo(() => ({
        projects,
        isLoading,
        isInitialLoaded,
        getFilteredData,
        refreshData,
    }), [projects, isLoading, isInitialLoaded, getFilteredData, refreshData]);

    return (
        <ProfitDashboardContext.Provider value={contextValue}>
            {children}
        </ProfitDashboardContext.Provider>
    );
}

export function useProfitDashboard() {
    const context = useContext(ProfitDashboardContext);
    if (!context) {
        throw new Error('useProfitDashboard must be used within ProfitDashboardProvider');
    }
    return context;
}
