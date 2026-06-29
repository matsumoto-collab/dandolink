'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, X, Calendar, Loader2, User, ArrowRight } from 'lucide-react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useMasterStore, selectConstructionTypes } from '@/stores/masterStore';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { logger } from '@/lib/logger';
import { normalizeForSearch } from '@/utils/searchNormalize';

interface AssignmentRow {
    id: string;
    date: Date;
    constructionTypeId?: string | null;
    assignedEmployeeId: string;
}

interface ResultItem {
    masterId: string;
    title: string;
    name?: string;
    honorific?: string;
    constructionSuffixName?: string;
    customerName?: string;
    customerShortName?: string;
    assignments: AssignmentRow[];
    isLoadingAssignments?: boolean;
}

interface ScheduleSearchPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onJump: (date: Date, assignmentId: string) => void;
}

const MAX_RESULTS = 30;
const DEBOUNCE_MS = 250;

const assignmentsCache = new Map<string, AssignmentRow[]>();

export default function ScheduleSearchPanel({ isOpen, onClose, onJump }: ScheduleSearchPanelProps) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [results, setResults] = useState<ResultItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const { projectMasters } = useProjectMasters();
    const { allForemen } = useCalendarDisplay();
    const constructionTypes = useMasterStore(selectConstructionTypes);

    const modalRef = useModalKeyboard(isOpen, onClose);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setDebouncedQuery('');
            setResults([]);
            setTimeout(() => inputRef.current?.focus(), 80);
        }
    }, [isOpen]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [query]);

    const { filteredMasters, totalMatches } = useMemo(() => {
        const empty = { filteredMasters: [] as typeof projectMasters, totalMatches: 0 };
        if (!debouncedQuery) return empty;
        // スペース区切りで複数語 AND 検索（例:「アレス 中田」で元請×案件名を同時に絞り込み）。
        // normalizeForSearch は NFKC 正規化するため全角スペースも半角に揃ってから分割される。
        const tokens = normalizeForSearch(debouncedQuery).split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return empty;
        const matched = projectMasters.filter(pm => {
            const normFields = [
                pm.name,
                pm.title,
                pm.honorific,
                pm.customerName,
                pm.customerShortName,
                pm.constructionSuffixName,
                pm.location,
                pm.siteShortName,
            ]
                .filter((v): v is string => !!v)
                .map(normalizeForSearch);
            // 全トークンが「いずれかのフィールドに含まれる」= AND 一致
            return tokens.every(tok => normFields.some(f => f.includes(tok)));
        });
        return { filteredMasters: matched.slice(0, MAX_RESULTS), totalMatches: matched.length };
    }, [projectMasters, debouncedQuery]);

    useEffect(() => {
        if (!debouncedQuery || filteredMasters.length === 0) {
            setResults([]);
            return;
        }
        let cancelled = false;

        const initial: ResultItem[] = filteredMasters.map(pm => {
            const cached = assignmentsCache.get(pm.id);
            return {
                masterId: pm.id,
                title: pm.title,
                name: pm.name,
                honorific: pm.honorific,
                constructionSuffixName: pm.constructionSuffixName,
                customerName: pm.customerName,
                customerShortName: pm.customerShortName,
                assignments: cached ?? [],
                isLoadingAssignments: !cached,
            };
        });
        setResults(initial);

        const toFetch = filteredMasters.filter(pm => !assignmentsCache.has(pm.id));
        if (toFetch.length === 0) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);

        Promise.all(
            toFetch.map(async pm => {
                try {
                    const res = await fetch(`/api/assignments?projectMasterId=${encodeURIComponent(pm.id)}`, {
                        cache: 'no-store',
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    const rows: AssignmentRow[] = (Array.isArray(data) ? data : []).map((a: Record<string, unknown>) => ({
                        id: String(a.id),
                        date: new Date(a.date as string),
                        constructionTypeId: (a.constructionType as string | null) ?? null,
                        assignedEmployeeId: String(a.assignedEmployeeId ?? ''),
                    }));
                    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
                    assignmentsCache.set(pm.id, rows);
                    return { masterId: pm.id, rows };
                } catch (err) {
                    logger.error('Failed to fetch assignments for search:', err);
                    return { masterId: pm.id, rows: [] as AssignmentRow[] };
                }
            })
        ).then(fetched => {
            if (cancelled) return;
            setResults(prev =>
                prev.map(item => {
                    const found = fetched.find(f => f.masterId === item.masterId);
                    if (!found) return item;
                    return { ...item, assignments: found.rows, isLoadingAssignments: false };
                })
            );
            setIsLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [debouncedQuery, filteredMasters]);

    const constructionTypeName = useCallback(
        (id?: string | null) => {
            if (!id) return '';
            return constructionTypes.find(t => t.id === id)?.name ?? '';
        },
        [constructionTypes]
    );

    const foremanName = useCallback(
        (id: string) => allForemen.find(f => f.id === id)?.displayName ?? '未割当',
        [allForemen]
    );

    const renderTitle = (item: ResultItem) => {
        const head = item.name ?? item.title;
        const honor = item.honorific ?? '';
        const suffix = item.constructionSuffixName ? ` ${item.constructionSuffixName}` : '';
        return `${head}${honor}${suffix}`;
    };

    const handleRowClick = (assignment: AssignmentRow) => {
        onJump(assignment.date, assignment.id);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-start lg:pt-20 lg:bg-black/50"
            onClick={onClose}
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white flex flex-col w-full h-full flex-1 lg:flex-none lg:h-auto lg:max-h-[75vh] lg:rounded-2xl lg:shadow-2xl lg:max-w-2xl lg:mx-4 border-0 lg:border lg:border-slate-200 overflow-hidden"
            >
                {/* グラデーションヘッダー */}
                <div className="flex-shrink-0 bg-slate-900 px-4 py-3 lg:rounded-t-2xl flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white">
                        <Search className="w-4 h-4" />
                        <span className="text-sm font-bold tracking-wide">案件を検索</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* 入力 */}
                <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-slate-200 bg-slate-50/50">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="案件名・元請・場所で検索..."
                            className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-400 placeholder-slate-400"
                        />
                        {query && (
                            <button
                                onClick={() => setQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                                aria-label="クリア"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* 結果リスト */}
                <div className="flex-1 overflow-y-auto overscroll-contain bg-white">
                    {!debouncedQuery && (
                        <div className="p-8 text-center text-sm text-slate-400">
                            <Search className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                            案件名・元請・住所などで検索できます
                            <div className="mt-1.5 text-xs text-slate-300">複数語はスペース区切りで絞り込み（例：アレス 中田）</div>
                        </div>
                    )}

                    {debouncedQuery && results.length === 0 && !isLoading && (
                        <div className="p-8 text-center text-sm text-slate-400">該当する案件がありません</div>
                    )}

                    {debouncedQuery && totalMatches > MAX_RESULTS && (
                        <div className="mx-3 mt-3 mb-1 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                            該当 <span className="font-bold">{totalMatches}</span> 件中、更新の新しい上位 {MAX_RESULTS} 件を表示しています。
                            スペース区切りでさらに絞り込めます（例：「アレス 中田」）。
                        </div>
                    )}

                    <div className="px-3 py-2 space-y-2">
                        {results.map((item) => (
                            <div
                                key={item.masterId}
                                className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                            >
                                <div className="px-4 pt-3 pb-2 bg-slate-50 border-b border-slate-100">
                                    <div className="font-bold text-slate-800 text-sm leading-tight">{renderTitle(item)}</div>
                                    {(item.customerName || item.customerShortName) && (
                                        <div className="text-xs text-slate-500 mt-1">
                                            {item.customerShortName ?? item.customerName}
                                        </div>
                                    )}
                                </div>

                                {item.isLoadingAssignments ? (
                                    <div className="px-4 py-3 flex items-center gap-2 text-xs text-slate-400">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        工事内容を読み込み中...
                                    </div>
                                ) : item.assignments.length === 0 ? (
                                    <div className="px-4 py-3 text-xs text-slate-400">配置なし</div>
                                ) : (
                                    <div className="divide-y divide-slate-100">
                                        {item.assignments.map((a) => {
                                            const ctName = constructionTypeName(a.constructionTypeId) || '工事';
                                            return (
                                                <button
                                                    key={a.id}
                                                    onClick={() => handleRowClick(a)}
                                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors group"
                                                >
                                                    <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0 group-hover:text-slate-600 transition-colors" />
                                                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">
                                                            {formatDate(a.date, 'short')}
                                                            <span className="text-xs text-slate-400 ml-0.5">
                                                                ({getDayOfWeekString(a.date, 'short')})
                                                            </span>
                                                        </span>
                                                        <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold whitespace-nowrap">
                                                            {ctName}
                                                        </span>
                                                        <span className="flex items-center gap-1 text-xs text-slate-500 truncate">
                                                            <User className="w-3 h-3 flex-shrink-0" />
                                                            {foremanName(a.assignedEmployeeId)}
                                                        </span>
                                                    </div>
                                                    <ArrowRight className="w-4 h-4 text-slate-300 flex-shrink-0 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
