'use client';

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';

// --- Types ---

interface WorkEntry {
    date: string;
    constructionTypeId: string | null;
}

interface Foreman {
    id: string;
    displayName: string;
}

interface ConstructionType {
    id: string;
    name: string;
    color: string;
    sortOrder: number;
}

export interface GanttProject {
    projectMasterId: string;
    projectTitle: string;
    projectName: string | null;
    customerName: string | null;
    constructionSuffixId: string | null;
    startDate: string | null;
    endDate: string | null;
    managerIds: string[];
    status: string;
    foremen: Foreman[];
    workEntries: WorkEntry[];
}

interface ConstructionSuffix {
    id: string;
    name: string;
}

interface GanttChartProps {
    projects: GanttProject[];
    constructionTypes: ConstructionType[];
    constructionSuffixes: ConstructionSuffix[];
    managers: { id: string; displayName: string }[];
    viewStartDate: Date;
    viewEndDate: Date;
    onNavigate: (direction: 'prev' | 'next' | 'today') => void;
    viewMode: 'month' | 'week';
    onViewModeChange: (mode: 'month' | 'week') => void;
    filterManagerId: string | null;
    onFilterManagerChange: (id: string | null) => void;
    filterSuffixIds: string[];
    onFilterSuffixIdsChange: (ids: string[]) => void;
    filterCustomerNames: string[];
    onFilterCustomerNamesChange: (names: string[]) => void;
    filterProjectIds: string[];
    onFilterProjectIdsChange: (ids: string[]) => void;
    isAdmin: boolean;
    onProjectClick?: (projectMasterId: string) => void;
}

// --- Helpers ---

function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getDaysBetween(start: Date, end: Date): Date[] {
    const days: Date[] = [];
    const cur = new Date(start);
    while (cur <= end) {
        days.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

const DAY_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];

const ROW_HEIGHT = 32;
const LEFT_COL_WIDTH_PC = 210;
const LEFT_COL_WIDTH_MOBILE = 100;
const HEADER_HEIGHT = 56;

// --- Component ---

export default function GanttChart({
    projects,
    constructionTypes,
    constructionSuffixes,
    managers,
    viewStartDate,
    viewEndDate,
    onNavigate,
    viewMode,
    onViewModeChange,
    filterManagerId,
    onFilterManagerChange,
    filterSuffixIds,
    onFilterSuffixIdsChange,
    filterCustomerNames,
    onFilterCustomerNamesChange,
    filterProjectIds,
    onFilterProjectIdsChange,
    isAdmin,
    onProjectClick,
}: GanttChartProps) {
    // Tailwindの`lg`と同条件で「デスクトップではない」= モバイル扱い（iPad横向きも含む）
    const isMobile = useMediaQuery('not all and (min-width: 1024px) and (min-aspect-ratio: 16/10)');
    const leftColWidth = isMobile ? LEFT_COL_WIDTH_MOBILE : LEFT_COL_WIDTH_PC;

    const headerScrollRef = useRef<HTMLDivElement>(null);
    const bodyScrollRef = useRef<HTMLDivElement>(null);
    const leftBodyRef = useRef<HTMLDivElement>(null);
    const todayRef = useRef<HTMLDivElement>(null);
    const [cellWidth, setCellWidth] = useState(30);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showEmptyProjects, setShowEmptyProjects] = useState(false);
    const [statusFilters, setStatusFilters] = useState<string[]>(['active']);

    const days = useMemo(() => getDaysBetween(viewStartDate, viewEndDate), [viewStartDate, viewEndDate]);
    const today = useMemo(() => formatDate(new Date()), []);

    const ctMap = useMemo(() => {
        const m = new Map<string, ConstructionType>();
        constructionTypes.forEach(ct => m.set(ct.id, ct));
        return m;
    }, [constructionTypes]);

    const monthGroups = useMemo(() => {
        const groups: { label: string; days: Date[] }[] = [];
        let currentMonth = '';
        for (const d of days) {
            const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
            if (label !== currentMonth) {
                groups.push({ label, days: [] });
                currentMonth = label;
            }
            groups[groups.length - 1].days.push(d);
        }
        return groups;
    }, [days]);

    // 今日の列にスクロール
    useEffect(() => {
        if (todayRef.current && bodyScrollRef.current) {
            const container = bodyScrollRef.current;
            const todayEl = todayRef.current;
            const offset = todayEl.offsetLeft - container.clientWidth / 3;
            container.scrollLeft = Math.max(0, offset);
            // ヘッダーも同期
            if (headerScrollRef.current) {
                headerScrollRef.current.scrollLeft = container.scrollLeft;
            }
        }
    }, [days]);

    // 左カラムと右ボディの縦スクロール同期
    useEffect(() => {
        const left = leftBodyRef.current;
        const right = bodyScrollRef.current;
        if (!left || !right) return;

        let syncing = false;
        const onLeftScroll = () => {
            if (syncing) return;
            syncing = true;
            right.scrollTop = left.scrollTop;
            syncing = false;
        };
        const onRightScroll = () => {
            if (syncing) return;
            syncing = true;
            left.scrollTop = right.scrollTop;
            syncing = false;
        };
        left.addEventListener('scroll', onLeftScroll);
        right.addEventListener('scroll', onRightScroll);
        return () => {
            left.removeEventListener('scroll', onLeftScroll);
            right.removeEventListener('scroll', onRightScroll);
        };
    }, []);

    // 右ヘッダーと右ボディの横スクロール同期
    const onBodyHScroll = useCallback(() => {
        if (headerScrollRef.current && bodyScrollRef.current) {
            headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
        }
    }, []);

    // 顧客リスト（フィルタ用、重複排除）
    const customerNames = useMemo(() => {
        const names = new Set<string>();
        projects.forEach(p => { if (p.customerName) names.add(p.customerName); });
        return Array.from(names).sort();
    }, [projects]);

    const normalizeText = (s: string) => s.normalize('NFKC').toLowerCase();
    const viewStartStr = useMemo(() => formatDate(viewStartDate), [viewStartDate]);
    const viewEndStr = useMemo(() => formatDate(viewEndDate), [viewEndDate]);

    const projectStatusKey = useCallback((status: string): 'active' | 'completed' | 'cancelled' => {
        if (status === 'active') return 'active';
        if (status === 'completed') return 'completed';
        return 'cancelled';
    }, []);

    // 既存フィルタ＋担当者の適用結果（件数表示の母数となる）
    const baseFilteredProjects = useMemo(() => {
        return projects.filter(p => {
            if (filterManagerId && !p.managerIds.includes(filterManagerId)) return false;
            if (filterSuffixIds.length > 0 && (!p.constructionSuffixId || !filterSuffixIds.includes(p.constructionSuffixId))) return false;
            if (filterCustomerNames.length > 0 && (!p.customerName || !filterCustomerNames.includes(p.customerName))) return false;
            if (filterProjectIds.length > 0 && !filterProjectIds.includes(p.projectMasterId)) return false;
            return true;
        });
    }, [projects, filterManagerId, filterSuffixIds, filterCustomerNames, filterProjectIds]);

    // 新規追加フィルタ（検索/ステータス/空案件）も含めた最終結果
    const filteredProjects = useMemo(() => {
        const q = normalizeText(searchQuery.trim());
        return baseFilteredProjects.filter(p => {
            // ステータス
            if (statusFilters.length > 0 && !statusFilters.includes(projectStatusKey(p.status))) return false;
            // 検索（案件名/正式名称どちらかに部分一致）
            if (q) {
                const name = normalizeText(p.projectName || '');
                const title = normalizeText(p.projectTitle || '');
                if (!name.includes(q) && !title.includes(q)) return false;
            }
            // 空案件
            if (!showEmptyProjects) {
                const hasEntryInView = p.workEntries.some(e => e.date >= viewStartStr && e.date <= viewEndStr);
                if (!hasEntryInView) return false;
            }
            return true;
        });
    }, [baseFilteredProjects, searchQuery, statusFilters, showEmptyProjects, viewStartStr, viewEndStr, projectStatusKey]);

    // 案件ごとのworkEntriesをdateでインデックス
    const projectWorkMap = useMemo(() => {
        const map = new Map<string, Map<string, WorkEntry[]>>();
        for (const p of filteredProjects) {
            const dateMap = new Map<string, WorkEntry[]>();
            for (const entry of p.workEntries) {
                if (!dateMap.has(entry.date)) dateMap.set(entry.date, []);
                dateMap.get(entry.date)!.push(entry);
            }
            map.set(p.projectMasterId, dateMap);
        }
        return map;
    }, [filteredProjects]);

    const totalWidth = days.length * cellWidth;

    return (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col" style={{ height: 'calc(100vh - 180px)' }}>
            {/* Toolbar */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onNavigate('today')}
                        className="px-3 py-1.5 font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                        style={{ fontSize: 12 }}
                    >
                        今日
                    </button>
                    <button
                        onClick={() => onNavigate('prev')}
                        className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5 text-slate-600" />
                    </button>
                    <button
                        onClick={() => onNavigate('next')}
                        className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                    >
                        <ChevronRight className="w-5 h-5 text-slate-600" />
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden">
                        <button
                            onClick={() => onViewModeChange('week')}
                            className={`px-3 py-1.5 font-medium transition-colors ${viewMode === 'week' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                            style={{ fontSize: 12 }}
                        >
                            週
                        </button>
                        <button
                            onClick={() => onViewModeChange('month')}
                            className={`px-3 py-1.5 font-medium transition-colors ${viewMode === 'month' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                            style={{ fontSize: 12 }}
                        >
                            月
                        </button>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setCellWidth(w => Math.max(24, w - 4))}
                            className="p-1 rounded hover:bg-slate-200 text-slate-500 text-sm font-bold"
                            title="縮小"
                        >
                            −
                        </button>
                        <button
                            onClick={() => setCellWidth(w => Math.min(60, w + 4))}
                            className="p-1 rounded hover:bg-slate-200 text-slate-500 text-sm font-bold"
                            title="拡大"
                        >
                            +
                        </button>
                    </div>

                    {isAdmin && (
                        <select
                            value={filterManagerId ?? ''}
                            onChange={(e) => onFilterManagerChange(e.target.value || null)}
                            className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            style={{ fontSize: 12 }}
                        >
                            <option value="">全担当者</option>
                            {managers.map(m => (
                                <option key={m.id} value={m.id}>{m.displayName}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            {/* Filter toggle button + search/status/empty-toggle/count */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-slate-50/50 flex-wrap">
                <button
                    type="button"
                    onClick={() => setFiltersOpen(o => !o)}
                    aria-expanded={filtersOpen}
                    aria-controls="my-schedule-filter-panel"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                    style={{ fontSize: 12 }}
                >
                    <span>絞り込み{(filterSuffixIds.length + filterCustomerNames.length + filterProjectIds.length) > 0 ? ` (${filterSuffixIds.length + filterCustomerNames.length + filterProjectIds.length})` : ''}</span>
                    <span aria-hidden className="text-slate-400" style={{ fontSize: 10 }}>{filtersOpen ? '▲' : '▼'}</span>
                </button>

                {/* 案件名検索 */}
                <div className="relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="案件名で検索"
                        aria-label="案件名で検索"
                        className="border border-slate-200 rounded-xl pl-3 pr-7 py-1.5 bg-white shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                        style={{ fontSize: 12, width: 180 }}
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            aria-label="検索をクリア"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center text-slate-400 hover:text-red-500 rounded-full"
                            style={{ fontSize: 12 }}
                        >
                            ×
                        </button>
                    )}
                </div>

                {/* ステータスチェックボックス */}
                <div className="inline-flex items-center gap-2 px-2 py-1 bg-white border border-slate-200 rounded-xl shadow-sm" style={{ fontSize: 12 }}>
                    <span className="text-slate-500" style={{ fontSize: 11 }}>ステータス:</span>
                    {([
                        { key: 'active', label: '進行中' },
                        { key: 'completed', label: '完了' },
                        { key: 'cancelled', label: '中止' },
                    ] as const).map(s => (
                        <label key={s.key} className="inline-flex items-center gap-1 cursor-pointer text-slate-700">
                            <input
                                type="checkbox"
                                checked={statusFilters.includes(s.key)}
                                onChange={(e) => {
                                    setStatusFilters(prev =>
                                        e.target.checked ? [...prev, s.key] : prev.filter(x => x !== s.key)
                                    );
                                }}
                                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                            />
                            <span>{s.label}</span>
                        </label>
                    ))}
                </div>

                {/* 空案件トグル */}
                <label className="inline-flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded-xl shadow-sm cursor-pointer text-slate-700" style={{ fontSize: 12 }}>
                    <input
                        type="checkbox"
                        checked={showEmptyProjects}
                        onChange={(e) => setShowEmptyProjects(e.target.checked)}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span>空の案件も表示</span>
                </label>

                {/* 件数表示 */}
                <span className="ml-auto text-slate-500" style={{ fontSize: 11 }}>
                    全{baseFilteredProjects.length}件中{filteredProjects.length}件を表示
                </span>
            </div>

            {/* Filter bar (collapsible) */}
            <div
                id="my-schedule-filter-panel"
                className="flex-shrink-0 overflow-hidden border-b border-slate-200 bg-slate-50/50 transition-[max-height,opacity] duration-300 ease-in-out"
                style={{ maxHeight: filtersOpen ? 400 : 0, opacity: filtersOpen ? 1 : 0 }}
                aria-hidden={!filtersOpen}
            >
              <div className="flex items-center gap-3 px-4 py-2 flex-wrap">
                {/* 工事名称フィルタ */}
                <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 whitespace-nowrap" style={{ fontSize: 11 }}>工事:</span>
                    <select
                        value=""
                        onChange={(e) => {
                            if (e.target.value && !filterSuffixIds.includes(e.target.value)) {
                                onFilterSuffixIdsChange([...filterSuffixIds, e.target.value]);
                            }
                        }}
                        className="border border-slate-300 rounded-lg px-2 py-1 bg-white"
                        style={{ fontSize: 12 }}
                    >
                        <option value="">選択...</option>
                        {constructionSuffixes.filter(s => !filterSuffixIds.includes(s.id)).map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                    {filterSuffixIds.map(id => {
                        const s = constructionSuffixes.find(x => x.id === id);
                        return (
                            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 rounded-md border border-teal-200" style={{ fontSize: 11 }}>
                                {s?.name ?? id.slice(0, 6)}
                                <button onClick={() => onFilterSuffixIdsChange(filterSuffixIds.filter(x => x !== id))} className="hover:text-red-500">×</button>
                            </span>
                        );
                    })}
                </div>

                {/* 顧客フィルタ */}
                <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 whitespace-nowrap" style={{ fontSize: 11 }}>顧客:</span>
                    <select
                        value=""
                        onChange={(e) => {
                            if (e.target.value && !filterCustomerNames.includes(e.target.value)) {
                                onFilterCustomerNamesChange([...filterCustomerNames, e.target.value]);
                            }
                        }}
                        className="border border-slate-300 rounded-lg px-2 py-1 bg-white"
                        style={{ fontSize: 12 }}
                    >
                        <option value="">選択...</option>
                        {customerNames.filter(n => !filterCustomerNames.includes(n)).map(n => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                    {filterCustomerNames.map(name => (
                        <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md border border-blue-200" style={{ fontSize: 11 }}>
                            {name}
                            <button onClick={() => onFilterCustomerNamesChange(filterCustomerNames.filter(x => x !== name))} className="hover:text-red-500">×</button>
                        </span>
                    ))}
                </div>

                {/* 案件フィルタ */}
                <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 whitespace-nowrap" style={{ fontSize: 11 }}>案件:</span>
                    <select
                        value=""
                        onChange={(e) => {
                            if (e.target.value && !filterProjectIds.includes(e.target.value)) {
                                onFilterProjectIdsChange([...filterProjectIds, e.target.value]);
                            }
                        }}
                        className="border border-slate-300 rounded-lg px-2 py-1 bg-white"
                        style={{ fontSize: 12 }}
                    >
                        <option value="">選択...</option>
                        {projects.filter(p => !filterProjectIds.includes(p.projectMasterId)).map(p => (
                            <option key={p.projectMasterId} value={p.projectMasterId}>{p.projectName || p.projectTitle}</option>
                        ))}
                    </select>
                    {filterProjectIds.map(id => {
                        const p = projects.find(x => x.projectMasterId === id);
                        return (
                            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md border border-amber-200" style={{ fontSize: 11 }}>
                                {p?.projectName || p?.projectTitle || id.slice(0, 6)}
                                <button onClick={() => onFilterProjectIdsChange(filterProjectIds.filter(x => x !== id))} className="hover:text-red-500">×</button>
                            </span>
                        );
                    })}
                </div>

                {/* クリアボタン */}
                {(filterSuffixIds.length > 0 || filterCustomerNames.length > 0 || filterProjectIds.length > 0) && (
                    <button
                        onClick={() => {
                            onFilterSuffixIdsChange([]);
                            onFilterCustomerNamesChange([]);
                            onFilterProjectIdsChange([]);
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors whitespace-nowrap"
                        style={{ fontSize: 11 }}
                    >
                        クリア
                    </button>
                )}
              </div>
            </div>

            {/* Header row (fixed) */}
            <div className="flex-shrink-0 flex border-b border-slate-200">
                {/* Left header */}
                <div className="flex-shrink-0 border-r border-slate-200 bg-slate-50" style={{ width: leftColWidth, height: HEADER_HEIGHT }}>
                    <div className="flex items-end h-full px-3 pb-2">
                        <span className="text-xs font-semibold text-slate-500">案件名</span>
                    </div>
                </div>
                {/* Right header - horizontal scroll hidden (synced with body) */}
                <div className="flex-1 overflow-hidden min-w-0" ref={headerScrollRef}>
                    <div style={{ width: totalWidth }}>
                        <div className="bg-slate-50" style={{ height: HEADER_HEIGHT }}>
                            {/* Month row */}
                            <div className="flex" style={{ height: 22 }}>
                                {monthGroups.map((g) => (
                                    <div
                                        key={g.label}
                                        className="font-semibold text-slate-600 flex items-center px-2 border-r border-slate-200"
                                        style={{ fontSize: 11, width: g.days.length * cellWidth }}
                                    >
                                        {g.label}
                                    </div>
                                ))}
                            </div>
                            {/* Date + day-of-week rows */}
                            <div className="flex" style={{ height: 34 }}>
                                {days.map((d, i) => {
                                    const dateStr = formatDate(d);
                                    const isToday = dateStr === today;
                                    const dow = d.getDay();
                                    const isSun = dow === 0;
                                    const isSat = dow === 6;

                                    return (
                                        <div
                                            key={i}
                                            ref={isToday ? todayRef : undefined}
                                            className={`flex flex-col items-center justify-center border-r border-slate-200 ${isToday ? 'bg-red-50' : isSun ? 'bg-rose-50/50' : isSat ? 'bg-blue-50/50' : ''}`}
                                            style={{ width: cellWidth }}
                                        >
                                            <span className={`font-medium leading-none ${isToday ? 'text-red-600 font-bold' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-slate-600'}`} style={{ fontSize: 11, height: 17, display: 'flex', alignItems: 'center' }}>
                                                {d.getDate()}
                                            </span>
                                            <span className={`leading-none ${isToday ? 'text-red-500' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-slate-400'}`} style={{ fontSize: 11, height: 17, display: 'flex', alignItems: 'center' }}>
                                                {DAY_OF_WEEK[dow]}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Body area (scrollable, fills remaining height) */}
            <div className="flex flex-1 min-h-0">
                {/* Left body - vertical scroll only, scrollbar hidden */}
                <div
                    className="flex-shrink-0 border-r border-slate-200 bg-white overflow-y-auto overflow-x-hidden"
                    ref={leftBodyRef}
                    style={{ width: leftColWidth, scrollbarWidth: 'none' }}
                >
                    {filteredProjects.map((project) => (
                        <div
                            key={project.projectMasterId}
                            className="flex items-center gap-2 px-3 border-b border-slate-200 hover:bg-slate-50 transition-colors"
                            style={{ height: ROW_HEIGHT }}
                        >
                            <div className="flex-1 min-w-0">
                                <div
                                    className={`font-medium truncate ${onProjectClick ? 'text-teal-700 hover:text-teal-900 hover:underline cursor-pointer' : 'text-slate-800'}`}
                                    style={{ fontSize: isMobile ? 10 : 12 }}
                                    title={project.projectTitle}
                                    onClick={() => onProjectClick?.(project.projectMasterId)}
                                >
                                    {project.projectName || project.projectTitle}
                                </div>
                            </div>
                        </div>
                    ))}

                    {filteredProjects.length === 0 && (
                        <div className="flex items-center justify-center h-32 text-sm text-slate-400">
                            該当する案件がありません
                        </div>
                    )}
                    {/* 右側の横スクロールバー分のスペーサー */}
                    <div className="flex-shrink-0" style={{ height: 17 }} />
                </div>

                {/* Right body - vertical + horizontal scroll, scrollbar visible at bottom */}
                <div
                    className="flex-1 overflow-auto min-w-0"
                    ref={bodyScrollRef}
                    onScroll={onBodyHScroll}
                >
                    <div style={{ width: totalWidth }}>
                        {filteredProjects.map((project) => {
                            const workMap = projectWorkMap.get(project.projectMasterId);

                            return (
                                <div
                                    key={project.projectMasterId}
                                    className="flex border-b border-slate-200"
                                    style={{ height: ROW_HEIGHT }}
                                >
                                    {days.map((d, i) => {
                                        const dateStr = formatDate(d);
                                        const isToday = dateStr === today;
                                        const dow = d.getDay();
                                        const isSun = dow === 0;
                                        const isSat = dow === 6;
                                        const entries = workMap?.get(dateStr);

                                        const inRange = project.startDate && project.endDate &&
                                            dateStr >= project.startDate && dateStr <= project.endDate;

                                        // 前日と同じ工事種別が連続しているかチェック
                                        let showLabel = true;
                                        if (entries && entries.length > 0 && i > 0) {
                                            const prevDateStr = formatDate(days[i - 1]);
                                            const prevEntries = workMap?.get(prevDateStr);
                                            if (prevEntries && prevEntries.length > 0) {
                                                const curType = entries[0].constructionTypeId;
                                                const prevType = prevEntries[0].constructionTypeId;
                                                if (curType === prevType) {
                                                    showLabel = false;
                                                }
                                            }
                                        }

                                        return (
                                            <div
                                                key={i}
                                                className={`relative border-r border-slate-200 ${isToday ? 'bg-red-50/40' : isSun ? 'bg-rose-50/30' : isSat ? 'bg-blue-50/30' : ''}`}
                                                style={{ width: cellWidth, minWidth: cellWidth }}
                                            >
                                                {inRange && !entries && (
                                                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-6 bg-slate-100/60 border-y border-dashed border-slate-200" />
                                                )}

                                                {entries && entries.length > 0 && (
                                                    <WorkCell
                                                        entries={entries}
                                                        ctMap={ctMap}
                                                        cellWidth={cellWidth}
                                                        showLabel={showLabel}
                                                    />
                                                )}

                                                {isToday && (
                                                    <div className="absolute top-0 left-0 w-px h-full bg-red-400 z-10 pointer-events-none" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- WorkCell sub-component ---

function WorkCell({
    entries,
    ctMap,
    showLabel,
}: {
    entries: WorkEntry[];
    ctMap: Map<string, ConstructionType>;
    cellWidth: number;
    showLabel: boolean;
}) {
    const main = entries[0];
    const ct = main.constructionTypeId ? ctMap.get(main.constructionTypeId) : null;
    const color = ct?.color ?? '#f59e0b';
    const name = ct?.name ?? '';

    return (
        <div
            className="absolute inset-0 flex flex-col cursor-default"
            title={name}
        >
            {/* 上半分: ラベル（初日のみ表示） */}
            <div className="flex-1 flex items-end overflow-visible">
                {showLabel && name && (
                    <span
                        className="font-medium text-slate-700 whitespace-nowrap pl-0.5 leading-none"
                        style={{ fontSize: 11, position: 'relative', zIndex: 5 }}
                    >
                        {name}
                    </span>
                )}
            </div>
            {/* 下半分: カラーバー */}
            <div className="flex items-center justify-center" style={{ height: '45%' }}>
                <div
                    className="rounded-sm w-full mx-0.5"
                    style={{
                        height: '80%',
                        backgroundColor: color,
                    }}
                />
            </div>
        </div>
    );
}
