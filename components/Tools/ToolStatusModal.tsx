'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { X, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { matchesSearch } from '@/utils/searchNormalize';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import ToolStatusBadge from './ToolStatusBadge';
import {
    Tool,
    ToolStatus,
    ToolCheckoutLog,
    ToolLogAction,
    TOOL_STATUSES,
    TOOL_STATUS_LABELS,
} from '@/types/tool';

const ACTION_LABELS: Record<ToolLogAction, string> = {
    checkout: '持出し',
    return: '返却',
    status_change: '状態変更',
};

const CANDIDATE_LIMIT = 8;

const fmtDateTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface ProjectPickerProps {
    projectMasterId: string | null;
    projectLabel: string;
    onSelect: (id: string, label: string) => void;
    onClear: () => void;
}

/**
 * 案件のインクリメンタル検索。
 * 案件マスタの取得はここで初めて走るので、閲覧専用で開いたときは読み込まれない。
 */
function ProjectPicker({ projectMasterId, projectLabel, onSelect, onClear }: ProjectPickerProps) {
    const { projectMasters } = useProjectMasters();
    const [query, setQuery] = useState('');

    const candidates = useMemo(() => {
        const q = query.trim();
        if (!q) return [];
        return projectMasters
            .filter((pm) => pm.status !== 'cancelled')
            .filter(
                (pm) =>
                    matchesSearch(pm.title ?? '', q) ||
                    matchesSearch(pm.name ?? '', q) ||
                    matchesSearch(pm.customerName ?? '', q)
            )
            .slice(0, CANDIDATE_LIMIT);
    }, [projectMasters, query]);

    if (projectMasterId) {
        return (
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50">
                <span className="truncate text-slate-800">{projectLabel || '選択済みの案件'}</span>
                <button
                    onClick={() => { onClear(); setQuery(''); }}
                    className="text-xs text-slate-500 hover:text-slate-800 shrink-0 px-2 py-1 rounded-md hover:bg-slate-200"
                >
                    変更
                </button>
            </div>
        );
    }

    return (
        <>
            <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="現場名・顧客名で検索"
            />
            {candidates.length > 0 && (
                <div className="mt-1.5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {candidates.map((pm) => (
                        <button
                            key={pm.id}
                            onClick={() => { onSelect(pm.id, pm.name || pm.title); setQuery(''); }}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50"
                        >
                            <div className="text-sm text-slate-800 truncate">{pm.name || pm.title}</div>
                            {pm.customerName && <div className="text-xs text-slate-400 truncate">{pm.customerName}</div>}
                        </button>
                    ))}
                </div>
            )}
            {query.trim() && candidates.length === 0 && (
                <p className="mt-1.5 text-xs text-slate-400">該当する案件がありません。「その他」に切り替えて入力できます</p>
            )}
        </>
    );
}

interface ToolStatusModalProps {
    tool: Tool;
    workers: { id: string; displayName: string }[];
    /** 協力会社・税理士など、閲覧だけのロール */
    readOnly: boolean;
    onClose: () => void;
    onSaved: (updated: Tool) => void;
}

/**
 * 工具の持出し・返却・状態変更と、その履歴。
 * 「持出中」は持出し先と持出者が無いと台帳として成立しないので保存前に弾く（API 側でも同じ検証をする）。
 */
export default function ToolStatusModal({ tool, workers, readOnly, onClose, onSaved }: ToolStatusModalProps) {
    const modalRef = useModalKeyboard(true, onClose);
    const { data: session } = useSession();

    const [status, setStatus] = useState<ToolStatus>(tool.status);
    const [destinationMode, setDestinationMode] = useState<'project' | 'free'>(
        tool.destinationNote && !tool.projectMasterId ? 'free' : 'project'
    );
    const [projectMasterId, setProjectMasterId] = useState<string | null>(tool.projectMasterId);
    const [projectLabel, setProjectLabel] = useState(tool.projectName || '');
    const [destinationNote, setDestinationNote] = useState(tool.destinationNote || '');
    const [holderId, setHolderId] = useState(tool.holderId || session?.user?.id || '');
    const [note, setNote] = useState(tool.note || '');
    const [isSaving, setIsSaving] = useState(false);

    const [logs, setLogs] = useState<ToolCheckoutLog[]>([]);
    const [isLogsLoading, setIsLogsLoading] = useState(true);

    const fetchLogs = useCallback(async () => {
        try {
            const res = await fetch(`/api/tools/${tool.id}/logs`);
            if (res.ok) setLogs(await res.json());
        } catch (error) {
            logger.error('Failed to fetch tool logs:', error);
        } finally {
            setIsLogsLoading(false);
        }
    }, [tool.id]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const isCheckedOut = status === 'checked_out';

    const handleSave = async () => {
        if (isCheckedOut) {
            if (destinationMode === 'project' && !projectMasterId) {
                toast.error('持出し先の案件を選択してください');
                return;
            }
            if (destinationMode === 'free' && !destinationNote.trim()) {
                toast.error('持出し先を入力してください');
                return;
            }
            if (!holderId) {
                toast.error('持出者を選択してください');
                return;
            }
        }

        setIsSaving(true);
        try {
            const res = await fetch(`/api/tools/${tool.id}/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status,
                    projectMasterId: isCheckedOut && destinationMode === 'project' ? projectMasterId : null,
                    destinationNote: isCheckedOut && destinationMode === 'free' ? destinationNote.trim() : null,
                    holderId: isCheckedOut ? holderId : null,
                    note: note.trim(),
                }),
            });
            if (res.ok) {
                const updated: Tool = await res.json();
                toast.success(
                    status === 'checked_out' ? '持出しを記録しました'
                        : tool.status === 'checked_out' && status === 'in_stock' ? '返却を記録しました'
                            : '状態を更新しました'
                );
                onSaved(updated);
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || '更新に失敗しました');
            }
        } catch {
            toast.error('更新に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0">
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
            <div
                ref={modalRef}
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto lg:max-h-[90vh] lg:max-w-lg lg:mx-4 lg:rounded-xl lg:shadow-xl overflow-hidden outline-none"
            >
                <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-slate-200 shrink-0">
                    <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                            {tool.categoryName}
                            <span className="font-normal text-slate-600 ml-1.5">{tool.name}</span>
                        </div>
                        <div className="mt-0.5">
                            <ToolStatusBadge status={tool.status} />
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl shrink-0"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
                    {!readOnly && (
                        <>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">状態</label>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {TOOL_STATUSES.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setStatus(s)}
                                            className={`px-2 py-2.5 text-sm rounded-xl border transition-colors ${
                                                status === s
                                                    ? 'bg-slate-800 text-white border-slate-800 font-medium'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            {TOOL_STATUS_LABELS[s]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {isCheckedOut && (
                                <>
                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <label className="block text-xs font-semibold text-slate-600">持出し先</label>
                                            <div className="flex items-center gap-1 text-xs">
                                                <button
                                                    onClick={() => setDestinationMode('project')}
                                                    className={`px-2 py-1 rounded-md ${destinationMode === 'project' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                                                >
                                                    案件
                                                </button>
                                                <button
                                                    onClick={() => setDestinationMode('free')}
                                                    className={`px-2 py-1 rounded-md ${destinationMode === 'free' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                                                >
                                                    その他
                                                </button>
                                            </div>
                                        </div>
                                        {destinationMode === 'project' ? (
                                            <ProjectPicker
                                                projectMasterId={projectMasterId}
                                                projectLabel={projectLabel}
                                                onSelect={(id, label) => { setProjectMasterId(id); setProjectLabel(label); }}
                                                onClear={() => { setProjectMasterId(null); setProjectLabel(''); }}
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                value={destinationNote}
                                                onChange={(e) => setDestinationNote(e.target.value)}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                placeholder="例: 事務所、〇〇工機"
                                            />
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">持出者</label>
                                        <select
                                            value={holderId}
                                            onChange={(e) => setHolderId(e.target.value)}
                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                        >
                                            <option value="">選択してください</option>
                                            {workers.map((w) => (
                                                <option key={w.id} value={w.id}>{w.displayName}</option>
                                            ))}
                                        </select>
                                    </div>
                                </>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">メモ（任意）</label>
                                <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={2}
                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
                                    placeholder={status === 'repairing' ? '例: 〇〇工機へ 7/20入庫' : '例: 戻し忘れ注意'}
                                />
                            </div>
                        </>
                    )}

                    {readOnly && (
                        <div className="space-y-2 text-sm">
                            <div className="flex gap-2">
                                <span className="text-slate-500 w-20 shrink-0">持出し先</span>
                                <span className="text-slate-800">{tool.projectName || tool.destinationNote || '—'}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="text-slate-500 w-20 shrink-0">持出者</span>
                                <span className="text-slate-800">{tool.holderName || '—'}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="text-slate-500 w-20 shrink-0">メモ</span>
                                <span className="text-slate-800 whitespace-pre-wrap">{tool.note || '—'}</span>
                            </div>
                        </div>
                    )}

                    {/* 履歴 */}
                    <div className="pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-2">
                            <History className="w-3.5 h-3.5" />
                            履歴
                        </div>
                        {isLogsLoading ? (
                            <p className="text-xs text-slate-400 py-2">読み込み中...</p>
                        ) : logs.length === 0 ? (
                            <p className="text-xs text-slate-400 py-2">まだ履歴がありません</p>
                        ) : (
                            <ul className="space-y-1.5">
                                {logs.map((log) => (
                                    <li key={log.id} className="text-xs text-slate-600 flex gap-2">
                                        <span className="text-slate-400 tabular-nums shrink-0">{fmtDateTime(log.createdAt)}</span>
                                        <span className="min-w-0">
                                            <span className="font-medium text-slate-700">{ACTION_LABELS[log.action] ?? log.action}</span>
                                            {log.status !== 'in_stock' && log.status !== 'checked_out' && (
                                                <span className="text-slate-500">（{TOOL_STATUS_LABELS[log.status]}）</span>
                                            )}
                                            {log.holderName && <span className="ml-1">{log.holderName}</span>}
                                            {(log.projectName || log.destinationNote) && (
                                                <span className="ml-1 text-slate-500">→ {log.projectName || log.destinationNote}</span>
                                            )}
                                            {log.createdByName && <span className="ml-1 text-slate-400">/ 記録: {log.createdByName}</span>}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {!readOnly && (
                    <div className="flex items-center justify-end gap-2 px-4 md:px-6 py-3 border-t border-slate-200 shrink-0">
                        <Button variant="outline" onClick={onClose}>キャンセル</Button>
                        <Button onClick={handleSave} isLoading={isSaving}>保存</Button>
                    </div>
                )}
            </div>
        </div>
    );
}
