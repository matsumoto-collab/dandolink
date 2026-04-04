'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import GanttChart, { GanttProject } from './GanttChart';

interface ConstructionType {
    id: string;
    name: string;
    color: string;
    sortOrder: number;
}

interface Foreman {
    id: string;
    displayName: string;
}

interface ApiResponse {
    projects: GanttProject[];
    constructionTypes: ConstructionType[];
}

function getMonthStart(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getMonthEnd(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function formatDateParam(d: Date): string {
    return d.toISOString().split('T')[0];
}

export default function MySchedulePage() {
    const [data, setData] = useState<ApiResponse | null>(null);
    const [foremen, setForemen] = useState<Foreman[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 表示の基準月（月初）
    const [baseMonth, setBaseMonth] = useState(() => getMonthStart(new Date()));
    const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
    const [filterForemanId, setFilterForemanId] = useState<string | null>(null);

    // 表示期間：基準月から3ヶ月分（月モード）/ 基準週の前後（週モード）
    const { viewStartDate, viewEndDate } = useMemo(() => {
        if (viewMode === 'month') {
            const start = new Date(baseMonth);
            start.setDate(start.getDate() - 7); // 前月末の一部も表示
            const end = getMonthEnd(addMonths(baseMonth, 2));
            end.setDate(end.getDate() + 7); // 翌月初の一部も表示
            return { viewStartDate: start, viewEndDate: end };
        } else {
            // 週モード: 基準月の属する週の前後4週間
            const start = new Date(baseMonth);
            start.setDate(start.getDate() - start.getDay() - 7);
            const end = new Date(start);
            end.setDate(end.getDate() + 27); // 4週間
            return { viewStartDate: start, viewEndDate: end };
        }
    }, [baseMonth, viewMode]);

    // APIデータ取得期間（表示期間より広めに）
    const fetchRange = useMemo(() => {
        const start = getMonthStart(addMonths(baseMonth, -1));
        const end = getMonthEnd(addMonths(baseMonth, 3));
        return { start: formatDateParam(start), end: formatDateParam(end) };
    }, [baseMonth]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [schedRes, foremenRes] = await Promise.all([
                fetch(`/api/my-schedule?startDate=${fetchRange.start}&endDate=${fetchRange.end}`, { cache: 'no-store' }),
                fetch('/api/dispatch/foremen', { cache: 'no-store' }),
            ]);

            if (!schedRes.ok) {
                const err = await schedRes.json().catch(() => ({}));
                throw new Error(err.error || 'データの取得に失敗しました');
            }

            const schedData: ApiResponse = await schedRes.json();
            const foremenData: Foreman[] = foremenRes.ok ? await foremenRes.json() : [];

            setData(schedData);
            setForemen(foremenData);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'エラーが発生しました');
        } finally {
            setLoading(false);
        }
    }, [fetchRange]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleNavigate = useCallback((direction: 'prev' | 'next' | 'today') => {
        if (direction === 'today') {
            setBaseMonth(getMonthStart(new Date()));
        } else if (direction === 'prev') {
            setBaseMonth(prev => addMonths(prev, viewMode === 'month' ? -1 : -1));
        } else {
            setBaseMonth(prev => addMonths(prev, viewMode === 'month' ? 1 : 1));
        }
    }, [viewMode]);

    return (
        <div className="max-w-[1800px] mx-auto">
            {/* Page header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                    マイスケジュール管理
                </h1>
                <p className="text-sm text-slate-500 mt-1">案件ごとの工程をバーチャートで確認</p>
            </div>

            {/* Content */}
            {loading && !data ? (
                <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500" />
                        <span className="text-sm text-slate-400">読み込み中...</span>
                    </div>
                </div>
            ) : error ? (
                <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <p className="text-sm text-red-500">{error}</p>
                        <button
                            onClick={fetchData}
                            className="mt-3 px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                        >
                            再読み込み
                        </button>
                    </div>
                </div>
            ) : data && data.projects.length === 0 ? (
                <div className="flex items-center justify-center h-64 bg-white rounded-xl border border-slate-200">
                    <div className="text-center">
                        <p className="text-slate-500">表示できる案件がありません</p>
                        <p className="text-sm text-slate-400 mt-1">指定期間にアサインメントが存在しません</p>
                    </div>
                </div>
            ) : data ? (
                <GanttChart
                    projects={data.projects}
                    constructionTypes={data.constructionTypes}
                    foremen={foremen}
                    viewStartDate={viewStartDate}
                    viewEndDate={viewEndDate}
                    onNavigate={handleNavigate}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    filterForemanId={filterForemanId}
                    onFilterForemanChange={setFilterForemanId}
                />
            ) : null}
        </div>
    );
}
