'use client';

import React, { useMemo, useRef, useEffect, useState } from 'react';
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

const FOREMAN_COLORS = [
    '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#3b82f6',
    '#ec4899', '#10b981', '#f97316', '#6366f1', '#06b6d4',
];

function getForemanColor(index: number): string {
    return FOREMAN_COLORS[index % FOREMAN_COLORS.length];
}

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
    const scrollRef = useRef<HTMLDivElement>(null);
    const todayRef = useRef<HTMLDivElement>(null);
    const [cellWidth, setCellWidth] = useState(36);

    const days = useMemo(() => getDaysBetween(viewStartDate, viewEndDate), [viewStartDate, viewEndDate]);
    const today = useMemo(() => formatDate(new Date()), []);

    const ctMap = useMemo(() => {
        const m = new Map<string, ConstructionType>();
        constructionTypes.forEach(ct => m.set(ct.id, ct));
        return m;
    }, [constructionTypes]);

    // 月グループ
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
        if (todayRef.current && scrollRef.current) {
            const container = scrollRef.current;
            const todayEl = todayRef.current;
            const offset = todayEl.offsetLeft - container.clientWidth / 3;
            container.scrollLeft = Math.max(0, offset);
        }
    }, [days]);

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

    // 職長カラーマップ
    const foremanColorMap = useMemo(() => {
        const m = new Map<string, string>();
        foremen.forEach((f, i) => m.set(f.id, getForemanColor(i)));
        return m;
    }, [foremen]);

    const ROW_HEIGHT = 56;
    const LEFT_COL_WIDTH = 250;

    return (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onNavigate('today')}
                        className="px-3 py-1.5 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
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
                    {/* 表示切替 */}
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden">
                        <button
                            onClick={() => onViewModeChange('week')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'week' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                            週
                        </button>
                        <button
                            onClick={() => onViewModeChange('month')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'month' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                            月
                        </button>
                    </div>

                    {/* セル幅 */}
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

                    {/* 職長フィルタ */}
                    <select
                        value={filterForemanId ?? ''}
                        onChange={(e) => onFilterForemanChange(e.target.value || null)}
                        className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    >
                        <option value="">全担当者</option>
                        {foremen.map(f => (
                            <option key={f.id} value={f.id}>{f.displayName}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Chart area */}
            <div className="flex overflow-hidden">
                {/* Left column - project names */}
                <div className="flex-shrink-0 border-r border-slate-200 bg-white z-10" style={{ width: LEFT_COL_WIDTH }}>
                    {/* Header placeholder */}
                    <div className="border-b border-slate-200 bg-slate-50" style={{ height: 68 }}>
                        <div className="flex items-end h-full px-3 pb-2">
                            <span className="text-xs font-semibold text-slate-500">案件名</span>
                        </div>
                    </div>

                    {/* Project rows */}
                    {filteredProjects.map((project) => (
                        <div
                            key={project.projectMasterId}
                            className="flex items-center gap-2 px-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                            style={{ height: ROW_HEIGHT }}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-800 truncate" title={project.projectTitle}>
                                    {project.projectName || project.projectTitle}
                                </div>
                                <div className="flex items-center gap-1 mt-0.5">
                                    {project.foremen.slice(0, 3).map((f) => (
                                        <span
                                            key={f.id}
                                            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                                            style={{ backgroundColor: foremanColorMap.get(f.id) ?? '#94a3b8' }}
                                            title={f.displayName}
                                        >
                                            {f.displayName.charAt(0)}
                                        </span>
                                    ))}
                                    {project.foremen.length > 3 && (
                                        <span className="text-[10px] text-slate-400">+{project.foremen.length - 3}</span>
                                    )}
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

                {/* Right area - scrollable calendar */}
                <div className="flex-1 overflow-x-auto" ref={scrollRef}>
                    <div style={{ width: days.length * cellWidth, minWidth: '100%' }}>
                        {/* Header: month + date + day-of-week */}
                        <div className="border-b border-slate-200 bg-slate-50" style={{ height: 68 }}>
                            {/* Month row */}
                            <div className="flex" style={{ height: 22 }}>
                                {monthGroups.map((g) => (
                                    <div
                                        key={g.label}
                                        className="text-xs font-semibold text-slate-600 flex items-center px-2 border-r border-slate-200"
                                        style={{ width: g.days.length * cellWidth }}
                                    >
                                        {g.label}
                                    </div>
                                ))}
                            </div>
                            {/* Date + day-of-week rows */}
                            <div className="flex" style={{ height: 46 }}>
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
                                            <span className={`text-xs font-medium ${isToday ? 'text-red-600 font-bold' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-slate-600'}`}>
                                                {d.getDate()}
                                            </span>
                                            <span className={`text-[10px] ${isToday ? 'text-red-500' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-slate-400'}`}>
                                                {DAY_OF_WEEK[dow]}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Data rows */}
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

                                        // スケジュール範囲内かどうか（薄い背景を表示）
                                        const inRange = project.startDate && project.endDate &&
                                            dateStr >= project.startDate && dateStr <= project.endDate;

                                        return (
                                            <div
                                                key={i}
                                                className={`relative border-r border-slate-50 flex items-center justify-center ${isToday ? 'bg-red-50/40' : isSun ? 'bg-rose-50/30' : isSat ? 'bg-blue-50/30' : ''}`}
                                                style={{ width: cellWidth }}
                                            >
                                                {/* 工期範囲の薄い背景 */}
                                                {inRange && !entries && (
                                                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-6 bg-slate-100/60 border-y border-dashed border-slate-200" />
                                                )}

                                                {/* 作業エントリ */}
                                                {entries && entries.length > 0 && (
                                                    <WorkCell
                                                        entries={entries}
                                                        ctMap={ctMap}
                                                        cellWidth={cellWidth}
                                                    />
                                                )}

                                                {/* 今日マーカー */}
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
    // 同日に複数エントリある場合、最初のものをメインで表示
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
