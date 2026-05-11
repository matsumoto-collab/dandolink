'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Loader2, Plus, Check, Undo2 } from 'lucide-react';
import type { PartnerWorkVolumeRow } from '@/types/partnerWorkVolume';

interface Props {
    rows: PartnerWorkVolumeRow[];
    readOnly: boolean;
    savingRowKey: string | null;
    onSave: (row: PartnerWorkVolumeRow, patch: Partial<PartnerWorkVolumeRow>) => void;
    onDelete: (row: PartnerWorkVolumeRow) => void;
    /** position: 'above' で row の上に、'below' で row の下に同じ日付の手動行を挿入 */
    onInsert: (row: PartnerWorkVolumeRow, position: 'above' | 'below') => void;
    /** 行ごとの完了/編集トグル */
    onToggleStatus: (row: PartnerWorkVolumeRow) => void;
}

function rowKey(row: PartnerWorkVolumeRow): string {
    return row.id ?? row.sourceAssignmentId ?? `manual:${row.date}:${row.projectTitle}:${row.sortOrder}`;
}

function formatDateLabel(s: string): string {
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    return `${Number(m[1])}/${Number(m[2])}`;
}

function formatYen(n: number): string {
    if (!Number.isFinite(n) || n === 0) return '';
    return n.toLocaleString('ja-JP');
}

const thBase = 'px-2 py-2 text-xs font-semibold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap';
const tdBase = 'px-2 py-1.5 text-sm text-slate-800 border-b border-slate-200 align-middle';

export default function PartnerWorkVolumeTable({
    rows,
    readOnly,
    savingRowKey,
    onSave,
    onDelete,
    onInsert,
    onToggleStatus,
}: Props) {
    const total = rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
    // 列数: 読み取り = 8 (status含む), 編集 = 10 (挿入/status/削除含む)
    const totalCols = readOnly ? 8 : 10;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr>
                        {!readOnly && <th className={`${thBase} text-center w-12`}>挿入</th>}
                        <th className={`${thBase} text-center w-24`}>日付</th>
                        <th className={`${thBase} text-left w-40`}>元請会社</th>
                        <th className={`${thBase} text-left`}>現場名</th>
                        <th className={`${thBase} text-center w-24`}>担当者</th>
                        <th className={`${thBase} text-center w-28`}>作業内容</th>
                        <th className={`${thBase} text-right w-32`}>金額</th>
                        <th className={`${thBase} text-left w-40`}>備考</th>
                        <th className={`${thBase} text-center w-24`}>状態</th>
                        {!readOnly && <th className={`${thBase} text-center w-10`}>削除</th>}
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && (
                        <tr>
                            <td
                                colSpan={totalCols}
                                className="px-4 py-12 text-center text-slate-400 text-sm"
                            >
                                この月の出来高はありません
                            </td>
                        </tr>
                    )}
                    {rows.map((row, idx) => {
                        const key = rowKey(row);
                        const isSaving = savingRowKey === key;
                        const isCompleted = row.status === 'completed';
                        // セル編集可否: ページ全体 readOnly でなく、行が completed でもなく
                        const cellReadOnly = readOnly || isCompleted;
                        const rowTone = isCompleted
                            ? 'bg-emerald-50/40'
                            : row.isManual
                                ? 'bg-amber-50/30'
                                : row.id == null
                                    ? 'bg-slate-50/40'
                                    : '';
                        // 上端: 最初の行 or 前行と日付が変わるとき
                        const showAbove = !readOnly && (idx === 0 || rows[idx - 1].date !== row.date);
                        // 下端: 最後の行 or 次行と日付が変わるとき
                        const showBelow = !readOnly && (idx === rows.length - 1 || rows[idx + 1].date !== row.date);
                        return (
                            <tr key={key} className={`group ${rowTone} hover:bg-slate-50/80`}>
                                {!readOnly && (
                                    <td className={`${tdBase} text-center align-middle`}>
                                        <div className="flex flex-col items-center gap-0.5">
                                            <button
                                                type="button"
                                                className={`w-5 h-5 inline-flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-300 text-slate-500 hover:text-slate-700 transition ${showAbove ? '' : 'opacity-40 hover:opacity-100'}`}
                                                title={`${formatDateLabel(row.date)}の上に追加`}
                                                onClick={() => onInsert(row, 'above')}
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                            <button
                                                type="button"
                                                className={`w-5 h-5 inline-flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-300 text-slate-500 hover:text-slate-700 transition ${showBelow ? '' : 'opacity-40 hover:opacity-100'}`}
                                                title={`${formatDateLabel(row.date)}の下に追加`}
                                                onClick={() => onInsert(row, 'below')}
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </td>
                                )}
                                <DateCell
                                    value={row.date}
                                    readOnly={cellReadOnly}
                                    saving={isSaving}
                                    onCommit={(v) => onSave(row, { date: v })}
                                />
                                <TextCell
                                    value={row.customerName ?? ''}
                                    readOnly={cellReadOnly}
                                    saving={isSaving}
                                    align="left"
                                    onCommit={(v) => onSave(row, { customerName: v || null })}
                                />
                                <TextCell
                                    value={row.projectTitle}
                                    readOnly={cellReadOnly}
                                    saving={isSaving}
                                    align="left"
                                    required
                                    onCommit={(v) => onSave(row, { projectTitle: v })}
                                />
                                <TextCell
                                    value={row.managerName ?? ''}
                                    readOnly={cellReadOnly}
                                    saving={isSaving}
                                    align="center"
                                    onCommit={(v) => onSave(row, { managerName: v || null })}
                                />
                                <TextCell
                                    value={row.constructionContent ?? ''}
                                    readOnly={cellReadOnly}
                                    saving={isSaving}
                                    align="center"
                                    onCommit={(v) => onSave(row, { constructionContent: v || null })}
                                />
                                <AmountCell
                                    value={row.amount}
                                    readOnly={cellReadOnly}
                                    saving={isSaving}
                                    onCommit={(v) => onSave(row, { amount: v })}
                                />
                                <TextCell
                                    value={row.notes ?? ''}
                                    readOnly={cellReadOnly}
                                    saving={isSaving}
                                    align="left"
                                    onCommit={(v) => onSave(row, { notes: v || null })}
                                />
                                {/* 状態列: completed/draft トグル */}
                                <td className={`${tdBase} text-center`}>
                                    {readOnly ? (
                                        isCompleted ? (
                                            <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                                                <Check className="w-3.5 h-3.5" />
                                                完了
                                            </span>
                                        ) : (
                                            <span className="text-slate-400 text-xs">未完了</span>
                                        )
                                    ) : isCompleted ? (
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-xs font-medium transition"
                                            title="編集に戻す"
                                            onClick={() => onToggleStatus(row)}
                                        >
                                            <Check className="w-3.5 h-3.5" />
                                            完了
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 text-xs font-medium transition"
                                            title="この行を完了にする"
                                            onClick={() => onToggleStatus(row)}
                                        >
                                            <Undo2 className="w-3.5 h-3.5 rotate-180" />
                                            完了する
                                        </button>
                                    )}
                                </td>
                                {!readOnly && (
                                    <td className={`${tdBase} text-center`}>
                                        {row.id != null && !isCompleted ? (
                                            <button
                                                type="button"
                                                className="text-slate-400 hover:text-rose-600 transition-colors"
                                                title={row.isManual ? '削除' : '入力値をクリア（自動行として残ります）'}
                                                onClick={() => onDelete(row)}
                                            >
                                                <Trash2 className="w-4 h-4 inline-block" />
                                            </button>
                                        ) : (
                                            <span className="text-slate-300 text-xs">—</span>
                                        )}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
                {rows.length > 0 && (
                    <tfoot>
                        <tr className="bg-slate-100 font-semibold">
                            <td colSpan={readOnly ? 5 : 6} className={`${tdBase} text-right font-bold`}>
                                合計
                            </td>
                            <td className={`${tdBase} text-right font-bold text-base tabular-nums`}>
                                ¥{total.toLocaleString()}
                            </td>
                            <td className={tdBase} />
                            <td className={tdBase} />
                            {!readOnly && <td className={tdBase} />}
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
    );
}

interface CellProps {
    readOnly: boolean;
    saving: boolean;
}

function DateCell({
    value,
    readOnly,
    saving,
    onCommit,
}: CellProps & { value: string; onCommit: (next: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    const commit = () => {
        setEditing(false);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
            setDraft(value);
            return;
        }
        if (draft === value) return;
        onCommit(draft);
    };

    if (readOnly || !editing) {
        return (
            <td
                className={`${tdBase} text-center tabular-nums ${readOnly ? '' : 'cursor-text hover:bg-slate-50'}`}
                onClick={() => {
                    if (readOnly) return;
                    setEditing(true);
                    setTimeout(() => inputRef.current?.focus(), 0);
                }}
            >
                {saving ? <Loader2 className="w-3 h-3 animate-spin text-slate-400 inline-block" /> : formatDateLabel(value)}
            </td>
        );
    }

    return (
        <td className={`${tdBase} p-0`}>
            <input
                ref={inputRef}
                type="date"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        setDraft(value);
                        setEditing(false);
                    }
                }}
                autoFocus
                className="w-full px-2 py-1 text-center tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
        </td>
    );
}

function TextCell({
    value,
    readOnly,
    saving,
    align,
    required,
    onCommit,
}: CellProps & {
    value: string;
    align: 'left' | 'center' | 'right';
    required?: boolean;
    onCommit: (next: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    const commit = () => {
        setEditing(false);
        const next = draft.trim();
        if (required && next === '') {
            setDraft(value);
            return;
        }
        if (next === value) return;
        onCommit(next);
    };

    const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
    if (readOnly || !editing) {
        return (
            <td
                className={`${tdBase} ${alignCls} ${readOnly ? '' : 'cursor-text hover:bg-slate-50'}`}
                onClick={() => {
                    if (readOnly) return;
                    setEditing(true);
                    setTimeout(() => inputRef.current?.select(), 0);
                }}
            >
                {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400 inline-block" />
                ) : value ? (
                    <span className="text-slate-800">{value}</span>
                ) : readOnly ? (
                    ''
                ) : (
                    <span className="text-slate-300">—</span>
                )}
            </td>
        );
    }

    return (
        <td className={`${tdBase} p-0`}>
            <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        setDraft(value);
                        setEditing(false);
                    }
                }}
                autoFocus
                className={`w-full px-2 py-1 ${alignCls} bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-400`}
            />
        </td>
    );
}

function AmountCell({
    value,
    readOnly,
    saving,
    onCommit,
}: CellProps & { value: number; onCommit: (next: number) => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value === 0 ? '' : String(value));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(value === 0 ? '' : String(value));
    }, [value, editing]);

    const commit = () => {
        setEditing(false);
        const cleaned = draft.replace(/[^0-9-]/g, '');
        const next = cleaned === '' ? 0 : Math.max(0, Math.floor(Number(cleaned)));
        if (!Number.isFinite(next)) {
            setDraft(value === 0 ? '' : String(value));
            return;
        }
        if (next === value) return;
        onCommit(next);
    };

    if (readOnly || !editing) {
        return (
            <td
                className={`${tdBase} text-right tabular-nums ${readOnly ? '' : 'cursor-text hover:bg-slate-50'}`}
                onClick={() => {
                    if (readOnly) return;
                    setEditing(true);
                    setTimeout(() => inputRef.current?.select(), 0);
                }}
            >
                {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400 inline-block" />
                ) : value > 0 ? (
                    <span>{formatYen(value)}</span>
                ) : readOnly ? (
                    ''
                ) : (
                    <span className="text-slate-300">—</span>
                )}
            </td>
        );
    }

    return (
        <td className={`${tdBase} p-0`}>
            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        setDraft(value === 0 ? '' : String(value));
                        setEditing(false);
                    }
                }}
                autoFocus
                className="w-full px-2 py-1 text-right tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
        </td>
    );
}
