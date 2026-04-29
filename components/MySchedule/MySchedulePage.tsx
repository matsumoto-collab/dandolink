'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import GanttChart, { GanttProject } from './GanttChart';
import { ProjectMaster } from '@/types/calendar';
import { ProjectMasterFormData } from '@/components/ProjectMasters/ProjectMasterForm';
import toast from 'react-hot-toast';
import Loading from '@/components/ui/Loading';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const ProjectMasterDetailModal = dynamic(
    () => import('@/components/ProjectMaster/ProjectMasterDetailModal'),
    { loading: () => <Loading overlay /> }
);

interface ConstructionType {
    id: string;
    name: string;
    color: string;
    sortOrder: number;
}

interface Manager {
    id: string;
    displayName: string;
    role: string;
}

interface ConstructionSuffix {
    id: string;
    name: string;
}

interface ApiResponse {
    projects: GanttProject[];
    constructionTypes: ConstructionType[];
    constructionSuffixes: ConstructionSuffix[];
    managers: Manager[];
    currentUserRole: string;
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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export default function MySchedulePage() {
    const { data: session } = useSession();
    const [data, setData] = useState<ApiResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [baseMonth, setBaseMonth] = useState(() => getMonthStart(new Date()));
    const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
    const [filterManagerId, setFilterManagerId] = useState<string | null>(session?.user?.id ?? null);
    const [filterSuffixIds, setFilterSuffixIds] = useState<string[]>([]);
    const [filterCustomerNames, setFilterCustomerNames] = useState<string[]>([]);
    const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);

    const isAdmin = session?.user?.role === 'admin';
    const [detailPm, setDetailPm] = useState<ProjectMaster | null>(null);

    const handleProjectClick = useCallback(async (projectMasterId: string) => {
        if (!projectMasterId) return;
        try {
            const res = await fetch(`/api/project-masters/${projectMasterId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('案件情報の取得に失敗しました');
            const pm: ProjectMaster = await res.json();
            setDetailPm(pm);
        } catch {
            toast.error('案件情報の取得に失敗しました');
        }
    }, []);

    // セッション読み込み後にデフォルト設定
    useEffect(() => {
        if (session?.user?.id && filterManagerId === null) {
            setFilterManagerId(session.user.id);
        }
    }, [session?.user?.id, filterManagerId]);

    const { viewStartDate, viewEndDate } = useMemo(() => {
        if (viewMode === 'month') {
            const start = new Date(baseMonth);
            start.setDate(start.getDate() - 7);
            const end = getMonthEnd(addMonths(baseMonth, 2));
            end.setDate(end.getDate() + 7);
            return { viewStartDate: start, viewEndDate: end };
        } else {
            const start = new Date(baseMonth);
            start.setDate(start.getDate() - start.getDay() - 7);
            const end = new Date(start);
            end.setDate(end.getDate() + 27);
            return { viewStartDate: start, viewEndDate: end };
        }
    }, [baseMonth, viewMode]);

    // APIデータ取得期間（前後6ヶ月の広い範囲を固定取得、月移動で再取得しない）
    const fetchRange = useMemo(() => {
        const now = new Date();
        const start = getMonthStart(addMonths(getMonthStart(now), -6));
        const end = getMonthEnd(addMonths(getMonthStart(now), 6));
        return { start: formatDateParam(start), end: formatDateParam(end) };
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // adminの場合、担当者フィルタをAPIに渡す
            // managerの場合、API側で自動的に自分の案件のみに絞り込まれる
            let url = `/api/my-schedule?startDate=${fetchRange.start}&endDate=${fetchRange.end}`;
            if (isAdmin && filterManagerId) {
                url += `&managerId=${filterManagerId}`;
            }

            const res = await fetch(url, { cache: 'no-store' });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'データの取得に失敗しました');
            }

            const schedData: ApiResponse = await res.json();
            setData(schedData);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'エラーが発生しました');
        } finally {
            setLoading(false);
        }
    }, [fetchRange, isAdmin, filterManagerId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Supabase Realtime: 配置・案件マスターの変更を検知して自動再取得
    const isUpdatingRef = useRef(false);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const debouncedFetchData = useCallback(() => {
        if (isUpdatingRef.current) return;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            fetchData();
        }, 500);
    }, [fetchData]);

    useEffect(() => {
        if (!session?.user) return;

        let channel: RealtimeChannel | null = null;

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('my_schedule_changes')
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'ProjectAssignment' },
                        () => debouncedFetchData()
                    )
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'ProjectMaster' },
                        () => debouncedFetchData()
                    )
                    .subscribe();
            } catch (error) {
                logger.error('Failed to setup my-schedule realtime:', error);
            }
        };

        setupRealtime();

        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase')
                    .then(({ supabase }) => {
                        supabase.removeChannel(channelToRemove);
                    })
                    .catch(() => {});
            }
        };
    }, [session?.user, debouncedFetchData]);

    const handleUpdateProjectMaster = useCallback(async (id: string, formData: ProjectMasterFormData) => {
        if (!id) return;
        isUpdatingRef.current = true;
        try {
            const res = await fetch(`/api/project-masters/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (!res.ok) throw new Error('更新に失敗しました');
            const updated: ProjectMaster = await res.json();
            setDetailPm(updated);
            toast.success('案件情報を更新しました');
            await fetchData();
        } finally {
            setTimeout(() => { isUpdatingRef.current = false; }, 1000);
        }
    }, [fetchData]);

    const handleNavigate = useCallback((direction: 'prev' | 'next' | 'today') => {
        if (direction === 'today') {
            setBaseMonth(getMonthStart(new Date()));
        } else if (direction === 'prev') {
            setBaseMonth(prev => addMonths(prev, -1));
        } else {
            setBaseMonth(prev => addMonths(prev, 1));
        }
    }, []);

    return (
        <div className="max-w-[1800px] mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                    マイ工程管理
                </h1>
                <p className="text-sm text-slate-500 mt-1">案件ごとの工程をバーチャートで確認</p>
            </div>

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
                        <p className="text-sm text-slate-400 mt-1">担当案件にアサインメントが存在しません</p>
                    </div>
                </div>
            ) : data ? (
                <GanttChart
                    projects={data.projects}
                    constructionTypes={data.constructionTypes}
                    constructionSuffixes={data.constructionSuffixes}
                    managers={data.managers}
                    viewStartDate={viewStartDate}
                    viewEndDate={viewEndDate}
                    onNavigate={handleNavigate}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    filterManagerId={filterManagerId}
                    onFilterManagerChange={setFilterManagerId}
                    filterSuffixIds={filterSuffixIds}
                    onFilterSuffixIdsChange={setFilterSuffixIds}
                    filterCustomerNames={filterCustomerNames}
                    onFilterCustomerNamesChange={setFilterCustomerNames}
                    filterProjectIds={filterProjectIds}
                    onFilterProjectIdsChange={setFilterProjectIds}
                    isAdmin={isAdmin}
                    onProjectClick={handleProjectClick}
                />
            ) : null}

            {detailPm && (
                <ProjectMasterDetailModal
                    pm={detailPm}
                    onClose={() => setDetailPm(null)}
                    onUpdate={handleUpdateProjectMaster}
                />
            )}
        </div>
    );
}
