'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { X, History, Calendar, Users, RefreshCw } from 'lucide-react';

interface HistoryEntry {
    id: string;
    assignmentId: string;
    changedAt: string;
    changeType: 'date' | 'foreman' | string;
    previousValue: string;
    newValue: string;
    changedBy: { id: string; displayName: string };
    previousLabel: string | null;
    newLabel: string | null;
    project: {
        id: string;
        title: string;
        name: string | null;
        honorific: string | null;
        customerName: string | null;
    } | null;
}

interface ScheduleHistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatDateOnly(iso: string): string {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function dayDiff(prevIso: string, newIso: string): number {
    const a = new Date(prevIso);
    const b = new Date(newIso);
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function projectDisplayName(p: HistoryEntry['project']): string {
    if (!p) return '(案件不明)';
    if (p.name) return `${p.name}${p.honorific || ''}`;
    return p.title;
}

export default function ScheduleHistoryPanel({ isOpen, onClose }: ScheduleHistoryPanelProps) {
    const [histories, setHistories] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchHistories = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/schedule-history?limit=100', { cache: 'no-store' });
            if (!res.ok) {
                const msg = res.status === 403 ? '閲覧権限がありません' : '履歴の取得に失敗しました';
                setError(msg);
                setHistories([]);
                return;
            }
            const data = await res.json();
            setHistories(data.histories || []);
        } catch {
            setError('履歴の取得に失敗しました');
            setHistories([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) fetchHistories();
    }, [isOpen, fetchHistories]);

    if (!isOpen) return null;

    return (
        <>
            {/* オーバーレイ */}
            <div
                className="fixed inset-0 bg-black/30 z-[80] transition-opacity"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* パネル本体 */}
            <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white shadow-2xl z-[90] flex flex-col animate-slide-in-right">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-slate-600" />
                        <h2 className="font-bold text-slate-800">スケジュール変更履歴</h2>
                        {!loading && (
                            <span className="text-xs text-slate-400">{histories.length}件</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={fetchHistories}
                            disabled={loading}
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors disabled:opacity-50"
                            aria-label="再読み込み"
                            title="再読み込み"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
                            aria-label="閉じる"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 本文 */}
                <div className="flex-1 overflow-y-auto">
                    {error && (
                        <div className="m-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
                            {error}
                        </div>
                    )}

                    {!error && loading && histories.length === 0 && (
                        <div className="p-8 text-center text-slate-400 text-sm">読み込み中…</div>
                    )}

                    {!error && !loading && histories.length === 0 && (
                        <div className="p-8 text-center text-slate-400 text-sm">変更履歴はまだありません</div>
                    )}

                    <ul className="divide-y divide-slate-100">
                        {histories.map((h) => {
                            const isDate = h.changeType === 'date';
                            const isForeman = h.changeType === 'foreman';
                            const diff = isDate ? dayDiff(h.previousValue, h.newValue) : 0;
                            return (
                                <li key={h.id} className="px-5 py-3">
                                    {/* 1段目: 日時 + 変更者 + 種別 */}
                                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5 flex-wrap">
                                        <span className="font-medium text-slate-600">
                                            {formatDateTime(h.changedAt)}
                                        </span>
                                        <span className="text-slate-300">|</span>
                                        <span className="text-slate-700 font-medium">{h.changedBy.displayName}</span>
                                        <span
                                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                isDate
                                                    ? 'bg-sky-100 text-sky-700'
                                                    : isForeman
                                                      ? 'bg-violet-100 text-violet-700'
                                                      : 'bg-slate-100 text-slate-600'
                                            }`}
                                        >
                                            {isDate && <Calendar className="w-2.5 h-2.5" />}
                                            {isForeman && <Users className="w-2.5 h-2.5" />}
                                            {isDate ? '日付' : isForeman ? '職長' : h.changeType}
                                        </span>
                                    </div>

                                    {/* 2段目: 案件名 */}
                                    <div className="text-sm font-semibold text-slate-800 mb-1 truncate">
                                        {h.project?.customerName && (
                                            <span className="text-slate-500 font-normal mr-1.5">
                                                {h.project.customerName}
                                            </span>
                                        )}
                                        {projectDisplayName(h.project)}
                                    </div>

                                    {/* 3段目: 変更内容(from → to) */}
                                    <div className="flex items-center gap-2 text-sm text-slate-700 flex-wrap">
                                        {isDate ? (
                                            <>
                                                <span className="line-through text-slate-400">
                                                    {formatDateOnly(h.previousValue)}
                                                </span>
                                                <span className="text-slate-400">→</span>
                                                <span className="font-bold">{formatDateOnly(h.newValue)}</span>
                                                {diff !== 0 && (
                                                    <span
                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                            diff > 0
                                                                ? 'bg-rose-100 text-rose-700'
                                                                : 'bg-emerald-100 text-emerald-700'
                                                        }`}
                                                    >
                                                        {diff > 0 ? `+${diff}日` : `${diff}日`}
                                                    </span>
                                                )}
                                            </>
                                        ) : isForeman ? (
                                            <>
                                                <span className="line-through text-slate-400">
                                                    {h.previousLabel || '(不明)'}
                                                </span>
                                                <span className="text-slate-400">→</span>
                                                <span className="font-bold">{h.newLabel || '(不明)'}</span>
                                            </>
                                        ) : (
                                            <span className="text-slate-500">{h.previousValue} → {h.newValue}</span>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </>
    );
}
