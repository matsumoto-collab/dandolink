'use client';

import React, { createContext, useContext, useCallback, useState, useMemo, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { DailyReport, DailyReportInput } from '@/types/dailyReport';

interface DailyReportContextType {
    dailyReports: DailyReport[];
    isLoading: boolean;
    isInitialLoaded: boolean;
    fetchDailyReports: (params?: { foremanId?: string; date?: string; startDate?: string; endDate?: string }) => Promise<void>;
    getDailyReportByForemanAndDate: (foremanId: string, date: string) => DailyReport | undefined;
    saveDailyReport: (input: DailyReportInput) => Promise<DailyReport>;
    deleteDailyReport: (id: string) => Promise<void>;
}

const DailyReportContext = createContext<DailyReportContextType | undefined>(undefined);

export function DailyReportProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoaded, setIsInitialLoaded] = useState(false);

    // 日報一覧を取得
    const fetchDailyReports = useCallback(async (params?: { foremanId?: string; date?: string; startDate?: string; endDate?: string }) => {
        try {
            setIsLoading(true);
            const searchParams = new URLSearchParams();
            if (params?.foremanId) searchParams.set('foremanId', params.foremanId);
            if (params?.date) searchParams.set('date', params.date);
            if (params?.startDate) searchParams.set('startDate', params.startDate);
            if (params?.endDate) searchParams.set('endDate', params.endDate);

            const response = await fetch(`/api/daily-reports?${searchParams.toString()}`);
            if (response.ok) {
                const data = await response.json();
                const parsed = data.map((report: DailyReport & { date: string; createdAt: string; updatedAt: string }) => ({
                    ...report,
                    date: new Date(report.date),
                    createdAt: new Date(report.createdAt),
                    updatedAt: new Date(report.updatedAt),
                }));
                setDailyReports(parsed);
                setIsInitialLoaded(true);
            }
        } catch (error) {
            console.error('Failed to fetch daily reports:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // 認証後に初回データを自動取得（過去30日分）
    useEffect(() => {
        if (status === 'authenticated' && !isInitialLoaded) {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            fetchDailyReports({
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
            });
        }
    }, [status, isInitialLoaded, fetchDailyReports]);

    // 職長と日付で日報を取得
    const getDailyReportByForemanAndDate = useCallback((foremanId: string, date: string): DailyReport | undefined => {
        return dailyReports.find(report => {
            const reportDate = report.date instanceof Date ? report.date.toISOString().split('T')[0] : report.date;
            return report.foremanId === foremanId && reportDate === date;
        });
    }, [dailyReports]);

    // 日報を保存（作成/更新）
    const saveDailyReport = useCallback(async (input: DailyReportInput): Promise<DailyReport> => {
        const response = await fetch('/api/daily-reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save daily report');
        }

        const saved = await response.json();
        const parsed: DailyReport = {
            ...saved,
            date: new Date(saved.date),
            createdAt: new Date(saved.createdAt),
            updatedAt: new Date(saved.updatedAt),
        };

        // ローカル状態を更新
        setDailyReports(prev => {
            const existingIndex = prev.findIndex(r => r.id === parsed.id);
            if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex] = parsed;
                return updated;
            }
            return [...prev, parsed];
        });

        return parsed;
    }, []);

    // 日報を削除
    const deleteDailyReport = useCallback(async (id: string): Promise<void> => {
        const response = await fetch(`/api/daily-reports/${id}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            throw new Error('Failed to delete daily report');
        }

        setDailyReports(prev => prev.filter(r => r.id !== id));
    }, []);

    // Context valueをuseMemoでメモ化
    const contextValue = useMemo(() => ({
        dailyReports,
        isLoading,
        isInitialLoaded,
        fetchDailyReports,
        getDailyReportByForemanAndDate,
        saveDailyReport,
        deleteDailyReport,
    }), [dailyReports, isLoading, isInitialLoaded, fetchDailyReports, getDailyReportByForemanAndDate, saveDailyReport, deleteDailyReport]);

    return (
        <DailyReportContext.Provider value={contextValue}>
            {children}
        </DailyReportContext.Provider>
    );
}

export function useDailyReports() {
    const context = useContext(DailyReportContext);
    if (!context) {
        throw new Error('useDailyReports must be used within DailyReportProvider');
    }
    return context;
}
