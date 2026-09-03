'use client';

import React, { useState } from 'react';
import { MoreVertical, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { OrderBacklogReportSummary } from '@/types/orderBacklog';

interface ReportListPanelProps {
    reports: OrderBacklogReportSummary[];
    isLoading: boolean;
    activeId: string | null;
    onCreate: () => void;
    onOpen: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
}

const yen = (n: number) => `¥${n.toLocaleString()}`;

/** ISO → 'M/D HH:mm'（更新日時の表示）。 */
function updatedLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 保存済みの受注明細書一覧（左ペイン）。 */
export default function ReportListPanel({
    reports,
    isLoading,
    activeId,
    onCreate,
    onOpen,
    onDuplicate,
    onDelete,
}: ReportListPanelProps) {
    const [menuId, setMenuId] = useState<string | null>(null);

    return (
        <div className="flex flex-col h-full border border-slate-200 rounded-lg bg-white">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
                <span className="text-sm font-bold text-slate-800">保存済み</span>
                <Button size="sm" variant="primary" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={onCreate}>
                    新規作成
                </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
                {isLoading ? (
                    <div className="px-3 py-6 text-center text-sm text-slate-400">読み込み中…</div>
                ) : reports.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-slate-400">
                        まだ保存された受注明細書はありません
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {reports.map((r) => (
                            <li
                                key={r.id}
                                className={`relative px-3 py-2 cursor-pointer hover:bg-slate-50 ${
                                    activeId === r.id ? 'bg-teal-50' : ''
                                }`}
                                onClick={() => onOpen(r.id)}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-slate-800">{r.asOfDate} 現在</div>
                                        <div className="text-xs text-slate-600 truncate">{r.title || '（無題）'}</div>
                                        <div className="text-[11px] text-slate-400 mt-0.5">
                                            {r.lineCount}件 ・ {yen(r.contractTotal)} ・ 更新 {updatedLabel(r.updatedAt)}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="操作メニュー"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setMenuId(menuId === r.id ? null : r.id);
                                        }}
                                        className="p-1 rounded text-slate-400 hover:bg-slate-200"
                                    >
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </div>
                                {menuId === r.id && (
                                    <>
                                        {/* メニュー外クリックで閉じる（行の onClick に流さない） */}
                                        <div
                                            className="fixed inset-0 z-10"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setMenuId(null);
                                            }}
                                        />
                                        <div
                                            className="absolute right-2 top-9 z-20 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button
                                                type="button"
                                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                                onClick={() => {
                                                    setMenuId(null);
                                                    onOpen(r.id);
                                                }}
                                            >
                                                開く
                                            </button>
                                            <button
                                                type="button"
                                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                                onClick={() => {
                                                    setMenuId(null);
                                                    onDuplicate(r.id);
                                                }}
                                            >
                                                複製して新しい基準日で
                                            </button>
                                            <button
                                                type="button"
                                                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                                onClick={() => {
                                                    setMenuId(null);
                                                    onDelete(r.id);
                                                }}
                                            >
                                                削除
                                            </button>
                                        </div>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
