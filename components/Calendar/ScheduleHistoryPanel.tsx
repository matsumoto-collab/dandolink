'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { X, History, Calendar, Users, RefreshCw, Search, Trash2, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ProjectInfo {
    id: string;
    title: string;
    name: string | null;
    honorific: string | null;
    customerName: string | null;
}

interface BaseEntry {
    id: string;
    changedAt: string;
    changedBy: { id: string; displayName: string };
    project: ProjectInfo | null;
}

interface MoveEntry extends BaseEntry {
    kind: 'move';
    historyId: string;
    assignmentId: string;
    changeType: 'date' | 'foreman' | string;
    previousValue: string;
    newValue: string;
    previousLabel: string | null;
    newLabel: string | null;
}

interface DeleteEntry extends BaseEntry {
    kind: 'delete';
    logId: string;
    changeType: 'delete';
    deletedDate: string | null;
    deletedForemanName: string | null;
    restored: boolean;
    restoredAt: string | null;
    restoredBy: string | null;
}

type HistoryEntry = MoveEntry | DeleteEntry;

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

function projectDisplayName(p: ProjectInfo | null): string {
    if (!p) return '(案件不明)';
    if (p.name) return `${p.name}${p.honorific || ''}`;
    return p.title;
}

export default function ScheduleHistoryPanel({ isOpen, onClose }: ScheduleHistoryPanelProps) {
    const [histories, setHistories] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    // 元に戻す/復元の処理中エントリ（id）。多重押下と他行操作を抑止する。
    const [pendingId, setPendingId] = useState<string | null>(null);

    const fetchHistories = useCallback(async (q: string) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ limit: '100' });
            if (q) params.set('q', q);
            const res = await fetch(`/api/schedule-history?${params.toString()}`, { cache: 'no-store' });
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
        if (isOpen) fetchHistories(searchQuery);
    }, [isOpen, searchQuery, fetchHistories]);

    useEffect(() => {
        if (!isOpen) return;
        const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput, isOpen]);

    // 移動（日付/職長）を元に戻す
    const handleRevertMove = useCallback(async (historyId: string) => {
        if (pendingId) return;
        setPendingId(historyId);
        try {
            const res = await fetch(`/api/schedule-history/${historyId}/revert`, { method: 'POST' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || '元に戻せませんでした');
                return;
            }
            toast.success('移動を元に戻しました');
            await fetchHistories(searchQuery);
        } catch {
            toast.error('元に戻せませんでした');
        } finally {
            setPendingId(null);
        }
    }, [pendingId, fetchHistories, searchQuery]);

    // 削除した配置を復元する
    const handleRestoreDelete = useCallback(async (logId: string) => {
        if (pendingId) return;
        setPendingId(logId);
        try {
            const res = await fetch('/api/assignments/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logId }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || '復元できませんでした');
                return;
            }
            toast.success('削除した配置を復元しました');
            await fetchHistories(searchQuery);
        } catch {
            toast.error('復元できませんでした');
        } finally {
            setPendingId(null);
        }
    }, [pendingId, fetchHistories, searchQuery]);

    if (!isOpen) return null;

    return (
        <>
            {/* オーバーレイ (モバイル/タブレット時はヘッダー下から、safe-area込み + 8px余白) */}
            <div
                className="fixed top-[calc(4rem+env(safe-area-inset-top,0px)+8px)] lg:top-0 left-0 right-0 bottom-0 bg-black/30 z-[80] transition-opacity"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* パネル本体 (モバイル/タブレット時はヘッダー下から、safe-area込み + 8px余白) */}
            <div className="fixed top-[calc(4rem+env(safe-area-inset-top,0px)+8px)] lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white shadow-2xl z-[90] flex flex-col animate-slide-in-right">
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
                            onClick={() => fetchHistories(searchQuery)}
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

                {/* 検索 */}
                <div className="px-5 py-2.5 border-b border-slate-200 bg-white">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="案件名・顧客名で検索"
                            className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                        />
                        {searchInput && (
                            <button
                                onClick={() => setSearchInput('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-100 text-slate-400"
                                aria-label="検索クリア"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-400">
                        移動は［元に戻す］、削除は［復元］で取り消せます。
                    </p>
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
                        <div className="p-8 text-center text-slate-400 text-sm">
                            {searchQuery ? '該当する変更履歴はありません' : '変更履歴はまだありません'}
                        </div>
                    )}

                    <ul className="divide-y divide-slate-100">
                        {histories.map((h) => {
                            if (h.kind === 'delete') {
                                const busy = pendingId === h.logId;
                                return (
                                    <li key={h.id} className="px-5 py-3">
                                        <div className="flex items-start gap-3">
                                            <div className="min-w-0 flex-1">
                                                {/* 1段目: 日時 + 変更者 + 種別 */}
                                                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5 flex-wrap">
                                                    <span className="font-medium text-slate-600">{formatDateTime(h.changedAt)}</span>
                                                    <span className="text-slate-300">|</span>
                                                    <span className="text-slate-700 font-medium">{h.changedBy.displayName}</span>
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">
                                                        <Trash2 className="w-2.5 h-2.5" />
                                                        削除
                                                    </span>
                                                </div>
                                                {/* 2段目: 案件名 */}
                                                <div className="text-sm font-semibold text-slate-800 mb-1 truncate">
                                                    {h.project?.customerName && (
                                                        <span className="text-slate-500 font-normal mr-1.5">{h.project.customerName}</span>
                                                    )}
                                                    {projectDisplayName(h.project)}
                                                </div>
                                                {/* 3段目: 削除された配置の内容 */}
                                                <div className="text-xs text-slate-500">
                                                    {h.deletedDate ? formatDateOnly(h.deletedDate) : '日付不明'}
                                                    {h.deletedForemanName ? ` ・ ${h.deletedForemanName}` : ''}
                                                </div>
                                            </div>
                                            {/* 復元ボタン or 復元済みラベル */}
                                            <div className="flex-shrink-0 pt-0.5">
                                                {h.restored ? (
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-400">
                                                        復元済み
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={() => handleRestoreDelete(h.logId)}
                                                        disabled={busy || !!pendingId}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-teal-300 text-teal-700 text-xs font-medium hover:bg-teal-50 active:bg-teal-100 transition-colors disabled:opacity-40 whitespace-nowrap"
                                                    >
                                                        <Undo2 className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                                                        復元
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                );
                            }

                            // move エントリ
                            const isDate = h.changeType === 'date';
                            const isForeman = h.changeType === 'foreman';
                            const diff = isDate ? dayDiff(h.previousValue, h.newValue) : 0;
                            const busy = pendingId === h.historyId;
                            return (
                                <li key={h.id} className="px-5 py-3">
                                    <div className="flex items-start gap-3">
                                        <div className="min-w-0 flex-1">
                                            {/* 1段目: 日時 + 変更者 + 種別 */}
                                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5 flex-wrap">
                                                <span className="font-medium text-slate-600">{formatDateTime(h.changedAt)}</span>
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
                                                    <span className="text-slate-500 font-normal mr-1.5">{h.project.customerName}</span>
                                                )}
                                                {projectDisplayName(h.project)}
                                            </div>

                                            {/* 3段目: 変更内容(from → to) */}
                                            <div className="flex items-center gap-2 text-sm text-slate-700 flex-wrap">
                                                {isDate ? (
                                                    <>
                                                        <span className="line-through text-slate-400">{formatDateOnly(h.previousValue)}</span>
                                                        <span className="text-slate-400">→</span>
                                                        <span className="font-bold">{formatDateOnly(h.newValue)}</span>
                                                        {diff !== 0 && (
                                                            <span
                                                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                                    diff > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                                                                }`}
                                                            >
                                                                {diff > 0 ? `+${diff}日` : `${diff}日`}
                                                            </span>
                                                        )}
                                                    </>
                                                ) : isForeman ? (
                                                    <>
                                                        <span className="line-through text-slate-400">{h.previousLabel || '(不明)'}</span>
                                                        <span className="text-slate-400">→</span>
                                                        <span className="font-bold">{h.newLabel || '(不明)'}</span>
                                                    </>
                                                ) : (
                                                    <span className="text-slate-500">{h.previousValue} → {h.newValue}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* 元に戻すボタン（日付/職長のみ） */}
                                        {(isDate || isForeman) && (
                                            <div className="flex-shrink-0 pt-0.5">
                                                <button
                                                    onClick={() => handleRevertMove(h.historyId)}
                                                    disabled={busy || !!pendingId}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-40 whitespace-nowrap"
                                                >
                                                    <Undo2 className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                                                    元に戻す
                                                </button>
                                            </div>
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
