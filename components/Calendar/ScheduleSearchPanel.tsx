'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, X, Calendar, Loader2, User } from 'lucide-react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useMasterStore, selectConstructionTypes } from '@/stores/masterStore';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { logger } from '@/lib/logger';

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

const MAX_RESULTS = 10;
const DEBOUNCE_MS = 250;

// 案件マスターIDごとの assignments キャッシュ（モジュールローカル、簡易）
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

    // 開いた瞬間は入力フォーカス + 状態リセット
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setDebouncedQuery('');
            setResults([]);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // デバウンス
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [query]);

    // ProjectMasterフィルタ
    const filteredMasters = useMemo(() => {
        if (!debouncedQuery) return [];
        const q = debouncedQuery.toLowerCase();
        return projectMasters
            .filter(pm => {
                const fields = [
                    pm.name,
                    pm.title,
                    pm.honorific,
                    pm.customerName,
                    pm.customerShortName,
                    pm.constructionSuffixName,
                    pm.location,
                    pm.siteShortName,
                ].filter((v): v is string => !!v);
                return fields.some(f => f.toLowerCase().includes(q));
            })
            .slice(0, MAX_RESULTS);
    }, [projectMasters, debouncedQuery]);

    // 各マスターの assignments を取得
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
        <div className="fixed inset-0 z-50 flex flex-col lg:items-center lg:justify-start lg:pt-16 bg-black/40">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:rounded-xl lg:shadow-2xl lg:max-w-2xl lg:max-h-[80vh]"
            >
                {/* 入力ヘッダー */}
                <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-200 pwa-modal-safe">
                    <Search className="w-5 h-5 text-slate-400 flex-shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="案件名・元請・場所で検索..."
                        className="flex-1 outline-none text-base placeholder-slate-400"
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="p-1 text-slate-400 hover:text-slate-600">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="ml-1 px-3 py-1 text-sm text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                    >
                        閉じる
                    </button>
                </div>

                {/* 結果リスト */}
                <div className="flex-1 overflow-y-auto overscroll-contain">
                    {!debouncedQuery && (
                        <div className="p-8 text-center text-sm text-slate-400">
                            案件名・元請・住所などで検索できます
                        </div>
                    )}

                    {debouncedQuery && results.length === 0 && !isLoading && (
                        <div className="p-8 text-center text-sm text-slate-400">該当する案件がありません</div>
                    )}

                    {results.map(item => (
                        <div key={item.masterId} className="border-b border-slate-100 last:border-b-0">
                            <div className="px-4 pt-3 pb-1">
                                <div className="font-bold text-slate-800 text-sm">{renderTitle(item)}</div>
                                {(item.customerName || item.customerShortName) && (
                                    <div className="text-xs text-slate-500 mt-0.5">
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
                                <div className="pb-2">
                                    {item.assignments.map(a => {
                                        const ctName = constructionTypeName(a.constructionTypeId) || '工事';
                                        return (
                                            <button
                                                key={a.id}
                                                onClick={() => handleRowClick(a)}
                                                className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors"
                                            >
                                                <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                                <div className="flex-1 min-w-0 flex items-center gap-3">
                                                    <span className="text-sm font-medium text-slate-700 whitespace-nowrap">
                                                        {formatDate(a.date, 'short')}({getDayOfWeekString(a.date, 'short')})
                                                    </span>
                                                    <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-medium whitespace-nowrap">
                                                        {ctName}
                                                    </span>
                                                    <span className="flex items-center gap-1 text-xs text-slate-500 truncate">
                                                        <User className="w-3 h-3 flex-shrink-0" />
                                                        {foremanName(a.assignedEmployeeId)}
                                                    </span>
                                                </div>
                                                <span className="text-xs text-slate-400">移動 →</span>
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
    );
}
