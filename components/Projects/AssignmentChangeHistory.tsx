'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
    ASSIGNMENT_CHANGE_LABELS,
    DATE_STATUS_VALUE_LABELS,
    STANDALONE_CHANGE_TYPES,
} from '@/lib/assignmentHistory';
import { logger } from '@/lib/logger';

/**
 * 配置の変更履歴（誰が・いつ・何を変えたか）の一覧表示。
 * 案件詳細モーダル（ProjectDetailView）の下部に置く。
 * kei要望 2026-07-18: 登録した人・車両を変更した人などが日時付きで分かるように。
 */

interface HistoryItem {
    id: string;
    changedAt: string;
    changedByName: string;
    changeType: string;
    previousValue: string;
    newValue: string;
    previousLabel: string | null;
    newLabel: string | null;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const INITIAL_SHOWN = 5;

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${hh}:${mm}`;
}

/** date（ISO保存）を M/D(曜) に。パース不能はそのまま */
function formatDateValue(v: string): string {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** 保存値を表示用に整形（date=ISO / dateStatus=生値 以外は記録時に整形済み） */
function displayValue(h: HistoryItem, which: 'prev' | 'next'): string {
    const raw = which === 'prev' ? h.previousValue : h.newValue;
    if (h.changeType === 'foreman') {
        return (which === 'prev' ? h.previousLabel : h.newLabel) ?? raw;
    }
    if (h.changeType === 'date') return formatDateValue(raw);
    if (h.changeType === 'dateStatus') return DATE_STATUS_VALUE_LABELS[raw] ?? raw;
    return raw;
}

export default function AssignmentChangeHistory({ assignmentId }: { assignmentId: string }) {
    const [items, setItems] = useState<HistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const fetchHistory = async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/assignments/${assignmentId}/history`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled) setItems(Array.isArray(data.histories) ? data.histories : []);
                }
            } catch (e) {
                logger.error('[AssignmentChangeHistory] 履歴の取得に失敗', e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchHistory();
        return () => {
            cancelled = true;
        };
    }, [assignmentId]);

    if (isLoading) {
        return <div className="text-xs text-slate-400 py-2">変更履歴を読み込み中...</div>;
    }
    if (items.length === 0) {
        return <div className="text-xs text-slate-400 py-2">変更履歴はまだありません（履歴機能の導入前に登録された予定です）</div>;
    }

    const shown = showAll ? items : items.slice(0, INITIAL_SHOWN);

    return (
        <div className="border border-slate-200 rounded-md divide-y divide-slate-100 bg-white">
            {shown.map((h) => {
                const label = ASSIGNMENT_CHANGE_LABELS[h.changeType] ?? h.changeType;
                const standalone = STANDALONE_CHANGE_TYPES.has(h.changeType);
                return (
                    <div key={h.id} className="px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                            <span className="font-medium text-slate-600 whitespace-nowrap">{formatDateTime(h.changedAt)}</span>
                            <span className="text-slate-300">|</span>
                            <span className="whitespace-nowrap">{h.changedByName}</span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium whitespace-nowrap">
                                {label}
                            </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-700 break-words">
                            {standalone ? (
                                <span className="font-medium">{h.newValue || label}</span>
                            ) : (
                                <>
                                    <span className="line-through text-slate-400">{displayValue(h, 'prev')}</span>
                                    <span className="mx-1.5 text-slate-400">→</span>
                                    <span className="font-medium">{displayValue(h, 'next')}</span>
                                </>
                            )}
                        </div>
                    </div>
                );
            })}
            {items.length > INITIAL_SHOWN && !showAll && (
                <button
                    onClick={() => setShowAll(true)}
                    className="w-full px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1"
                >
                    <ChevronDown className="w-3.5 h-3.5" />
                    すべて表示（あと{items.length - INITIAL_SHOWN}件）
                </button>
            )}
        </div>
    );
}
