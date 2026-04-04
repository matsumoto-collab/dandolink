'use client';

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
    startDate: string | null;
    endDate: string | null;
    actualStartDate: string | null;
    actualEndDate: string | null;
    managerIds: string[];
    status: string;
    foremen: Foreman[];
    workEntries: WorkEntry[];
}

interface GanttChartProps {
    projects: GanttProject[];
    constructionTypes: ConstructionType[];
    foremen: Foreman[];
    viewStartDate: Date;
    viewEndDate: Date;
    onNavigate: (direction: 'prev' | 'next' | 'today') => void;
    viewMode: 'month' | 'week';
    onViewModeChange: (mode: 'month' | 'week') => void;
    filterForemanId: string | null;
    onFilterForemanChange: (id: string | null) => void;
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
const LEFT_COL_WIDTH = 210;
const HEADER_HEIGHT = 56;

// --- Component ---

export default function GanttChart({
    projects,
    constructionTypes,
    foremen,
    viewStartDate,
    viewEndDate,
    onNavigate,
    viewMode,
    onViewModeChange,
    filterForemanId,
    onFilterForemanChange,
}: GanttChartProps) {
    const headerScrollRef = useRef<HTMLDivElement>(null);
    const bodyScrollRef = useRef<HTMLDivElement>(null);
    const leftBodyRef = useRef<HTMLDivElement>(null);
    const todayRef = useRef<HTMLDivElement>(null);
    const [cellWidth, setCellWidth] = useState(30);

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

    // フィルタ適用
    const filteredProjects = useMemo(() => {
        if (!filterForemanId) return projects;
        return projects.filter(p =>
            p.foremen.some(f => f.id === filterForemanId)
        );
    }, [projects, filterForemanId]);

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

                    <select
                        value={filterForemanId ?? ''}
                        onChange={(e) => onFilterForemanChange(e.target.value || null)}
                        className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        style={{ fontSize: 12 }}
                    >
                        <option value="">全担当者</option>
                        {foremen.map(f => (
                            <option key={f.id} value={f.id}>{f.displayName}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Header row (fixed) */}
            <div className="flex-shrink-0 flex border-b border-slate-200">
                {/* Left header */}
                <div className="flex-shrink-0 border-r border-slate-200 bg-slate-50" style={{ width: LEFT_COL_WIDTH, height: HEADER_HEIGHT }}>
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
                                            className={`flex flex-col items-center justify-center border-r border-slate-100 ${isToday ? 'bg-red-50' : isSun ? 'bg-rose-50/50' : isSat ? 'bg-blue-50/50' : ''}`}
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
                    style={{ width: LEFT_COL_WIDTH, scrollbarWidth: 'none' }}
                >
                    {filteredProjects.map((project) => (
                        <div
                            key={project.projectMasterId}
                            className="flex items-center gap-2 px-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                            style={{ height: ROW_HEIGHT }}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-800 truncate" style={{ fontSize: 12 }} title={project.projectTitle}>
                                    {project.projectName || project.projectTitle}
                                </div>
                            </div>
                        </div>
                    ))}

                    {filteredProjects.length === 0 && (
                        <div className="flex items-center justify-center h-32 text-sm text-slate-400">
                            表示できる案件がありません
                        </div>
                    )}
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
                                    className="flex border-b border-slate-100"
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

                                        return (
                                            <div
                                                key={i}
                                                className={`relative border-r border-slate-50 flex items-center justify-center ${isToday ? 'bg-red-50/40' : isSun ? 'bg-rose-50/30' : isSat ? 'bg-blue-50/30' : ''}`}
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
    cellWidth,
}: {
    entries: WorkEntry[];
    ctMap: Map<string, ConstructionType>;
    cellWidth: number;
}) {
    const main = entries[0];
    const ct = main.constructionTypeId ? ctMap.get(main.constructionTypeId) : null;
    const color = ct?.color ?? '#f59e0b';
    const name = ct?.name ?? '';

    return (
        <div
            className="absolute inset-x-0.5 top-1/2 -translate-y-1/2 rounded-sm flex items-center justify-center overflow-hidden cursor-default group"
            style={{
                height: 28,
                backgroundColor: `${color}30`,
                borderLeft: `3px solid ${color}`,
            }}
            title={`${name}${entries.length > 1 ? ` (+${entries.length - 1})` : ''}`}
        >
            {cellWidth >= 32 && (
                <span
                    className="text-[10px] font-medium truncate px-0.5 leading-tight"
                    style={{ color }}
                >
                    {name}
                </span>
            )}
            {entries.length > 1 && (
                <span className="absolute -top-1 -right-0.5 w-3.5 h-3.5 rounded-full bg-slate-600 text-white text-[8px] flex items-center justify-center font-bold">
                    {entries.length}
                </span>
            )}
        </div>
    );
}
