'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface ProjectProfit {
    id: string;
    title: string;
    customerName: string | null;
    status: string;
    assignmentCount: number;
    estimateAmount: number;
    estimateCostTotal: number | null;
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

interface AggregateRow {
    key: string;
    name: string;
    revenue: number;
    totalCost: number;
    grossProfit: number;
    profitMargin: number;
    projectCount: number;
}

interface FilteredData {
    projects: ProjectProfit[];
    summary: DashboardSummary;
    byCustomer: AggregateRow[];
    byConstructionType: AggregateRow[];
    byForeman: AggregateRow[];
}

interface ProfitDashboardContextType {
    projects: ProjectProfit[];
    isLoading: boolean;
    isInitialLoaded: boolean;
    getFilteredData: (status: string) => FilteredData;
    refreshData: () => Promise<void>;
}

const ProfitDashboardContext = createContext<ProfitDashboardContextType | undefined>(undefined);

function recomputeAggregate(rows: AggregateRow[]): AggregateRow[] {
    return rows.map(r => ({
        ...r,
        profitMargin: r.revenue > 0 ? Math.round((r.grossProfit / r.revenue) * 1000) / 10 : 0,
    }));
}

function aggregate(
    projects: ProjectProfit[],
    keyOf: (p: ProjectProfit) => { key: string; name: string } | null,
): AggregateRow[] {
    const map = new Map<string, AggregateRow>();
    for (const p of projects) {
        const k = keyOf(p);
        if (!k) continue;
        const cur = map.get(k.key) ?? {
            key: k.key, name: k.name, revenue: 0, totalCost: 0,
            grossProfit: 0, profitMargin: 0, projectCount: 0,
        };
        cur.revenue += p.revenue;
        cur.totalCost += p.totalCost;
        cur.grossProfit += p.grossProfit;
        cur.projectCount += 1;
        map.set(k.key, cur);
    }
    return recomputeAggregate(Array.from(map.values())).sort((a, b) => b.grossProfit - a.grossProfit);
}

export function ProfitDashboardProvider({ children }: { children: React.ReactNode }) {
    const { status: authStatus } = useSession();
    const [projects, setProjects] = useState<ProjectProfit[]>([]);
    const [byCustomerAll, setByCustomerAll] = useState<AggregateRow[]>([]);
    const [byConstructionTypeAll, setByConstructionTypeAll] = useState<AggregateRow[]>([]);
    const [byForemanAll, setByForemanAll] = useState<AggregateRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoaded, setIsInitialLoaded] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/profit-dashboard?status=all', { cache: 'no-store' });
            if (response.ok) {
                const result = await response.json();
                setProjects(result.projects);
                setByCustomerAll(result.byCustomer ?? []);
                setByConstructionTypeAll(result.byConstructionType ?? []);
                setByForemanAll(result.byForeman ?? []);
                setIsInitialLoaded(true);
            }
        } catch (error) {
            logger.error('Failed to fetch profit dashboard data:', error);
            toast.error('収益データの取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authStatus === 'authenticated' && !isInitialLoaded) {
            fetchData();
        }
    }, [authStatus, isInitialLoaded, fetchData]);

    const getFilteredData = useCallback((status: string): FilteredData => {
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

        if (status === 'all') {
            return {
                projects: filtered, summary,
                byCustomer: byCustomerAll,
                byConstructionType: byConstructionTypeAll,
                byForeman: byForemanAll,
            };
        }

        // 顧客別/工事種別はクライアント側で再集計可能
        const byCustomer = aggregate(filtered, p => ({
            key: p.customerName ?? '__unset__',
            name: p.customerName ?? '(未設定)',
        }));
        // 工事種別は projects に含まれないため、絞り込み後はサーバ集計をそのまま使用
        return {
            projects: filtered, summary,
            byCustomer,
            byConstructionType: byConstructionTypeAll,
            byForeman: byForemanAll,
        };
    }, [projects, byCustomerAll, byConstructionTypeAll, byForemanAll]);

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
