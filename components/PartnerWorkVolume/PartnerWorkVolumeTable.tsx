'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Loader2, Plus, Check, Undo2, RotateCcw } from 'lucide-react';
import type { PartnerWorkVolumeRow, PartnerTaxMode } from '@/types/partnerWorkVolume';
import { PARTNER_TAX_RATE } from '@/types/partnerWorkVolume';

interface Props {
    rows: PartnerWorkVolumeRow[];
    readOnly: boolean;
    savingRowKey: string | null;
    /** 協力会社の請求税区分。'inclusive' のときフッターを 小計/消費税/合計 の3行に拡張 */
    taxMode: PartnerTaxMode;
    onSave: (row: PartnerWorkVolumeRow, patch: Partial<PartnerWorkVolumeRow>) => void;
    onDelete: (row: PartnerWorkVolumeRow) => void;
    /** 削除済み行の復元（onRestore が未指定なら復元 UI を出さない） */
    onRestore?: (row: PartnerWorkVolumeRow) => void;
    /** position: 'above' で row の上に、'below' で row の下に同じ日付の手動行を挿入 */
    onInsert: (row: PartnerWorkVolumeRow, position: 'above' | 'below') => void;
    /** 行ごとの完了/編集トグル */
    onToggleStatus: (row: PartnerWorkVolumeRow) => void;
}

function rowKey(row: PartnerWorkVolumeRow): string {
    // 1 配置に対して作業費の行/運搬費の行の2行が並ぶため、rowType もキーに含める
    if (row.id) return row.id;
    if (row.sourceAssignmentId) return `${row.sourceAssignmentId}:${row.rowType}`;
    return `manual:${row.date}:${row.projectTitle}:${row.sortOrder}`;
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
    taxMode,
    onSave,
    onDelete,
    onRestore,
    onInsert,
    onToggleStatus,
}: Props) {
    // 小計（税抜）は削除済み行を除外。金額セルは常に税抜の保存値を表示する。
    const subtotal = rows
        .filter((r) => !r.deletedAt)
        .reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
    // 税込会社のみ消費税と税込合計を計算。マイナス入力（値引き）も比例配分するため
    // 小計に税率を掛けて四捨五入する（行ごとに計算すると端数で合計が±1ずれることがある）。
    const isInclusive = taxMode === 'inclusive';
    const tax = isInclusive ? Math.round(subtotal * PARTNER_TAX_RATE) : 0;
    const grandTotal = subtotal + tax;
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
                        const isDeleted = !!row.deletedAt;
                        // セル編集可否: ページ全体 readOnly でなく、行が completed でも削除済みでもないとき
                        const cellReadOnly = readOnly || isCompleted || isDeleted;
                        const isTransport = row.rowType === 'transport';
                        const isJoyo = row.rowType === 'joyo';
                        const rowTone = isDeleted
                            ? 'bg-rose-50/30 text-slate-400 line-through'
                            : isCompleted
                                ? 'bg-emerald-50/40'
                                : row.isManual
                                    ? 'bg-amber-50/30'
                                    : isTransport
                                        ? 'bg-sky-50/40'
                                        : isJoyo
                                            ? 'bg-violet-50/40'
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
                                {/* 状態列: 削除済み / completed / draft */}
                                <td className={`${tdBase} text-center`}>
                                    {isDeleted ? (
                                        <span className="inline-flex items-center gap-1 text-rose-500 text-xs font-medium no-underline">
                                            <Trash2 className="w-3.5 h-3.5" />
                                            削除済み
                                        </span>
                                    ) : readOnly ? (
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
                                        {isDeleted ? (
                                            onRestore ? (
                                                <button
                                                    type="button"
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 text-xs font-medium transition no-underline"
                                                    title="復元する"
                                                    onClick={() => onRestore(row)}
                                                >
                                                    <RotateCcw className="w-3.5 h-3.5" />
                                                    復元
                                                </button>
                                            ) : (
                                                <span className="text-slate-300 text-xs">—</span>
                                            )
                                        ) : isCompleted ? (
                                            <span className="text-slate-300 text-xs">—</span>
                                        ) : (
                                            <button
                                                type="button"
                                                className="text-slate-400 hover:text-rose-600 transition-colors"
                                                title={
                                                    row.isManual
                                                        ? '削除'
                                                        : '削除（以降この月で再表示されません）'
                                                }
                                                onClick={() => onDelete(row)}
                                            >
                                                <Trash2 className="w-4 h-4 inline-block" />
                                            </button>
                                        )}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
                {rows.length > 0 && (
                    <tfoot>
                        {isInclusive ? (
                            <>
                                <tr className="bg-slate-50">
                                    <td colSpan={readOnly ? 5 : 6} className={`${tdBase} text-right text-slate-600`}>
                                        小計（税抜）
                                    </td>
                                    <td className={`${tdBase} text-right tabular-nums text-slate-700`}>
                                        ¥{subtotal.toLocaleString()}
                                    </td>
                                    <td className={tdBase} />
                                    <td className={tdBase} />
                                    {!readOnly && <td className={tdBase} />}
                                </tr>
                                <tr className="bg-slate-50">
                                    <td colSpan={readOnly ? 5 : 6} className={`${tdBase} text-right text-slate-600`}>
                                        消費税（10%）
                                    </td>
                                    <td className={`${tdBase} text-right tabular-nums text-slate-700`}>
                                        ¥{tax.toLocaleString()}
                                    </td>
                                    <td className={tdBase} />
                                    <td className={tdBase} />
                                    {!readOnly && <td className={tdBase} />}
                                </tr>
                                <tr className="bg-slate-100 font-semibold">
                                    <td colSpan={readOnly ? 5 : 6} className={`${tdBase} text-right font-bold`}>
                                        合計（税込）
                                    </td>
                                    <td className={`${tdBase} text-right font-bold text-base tabular-nums`}>
                                        ¥{grandTotal.toLocaleString()}
                                    </td>
                                    <td className={tdBase} />
                                    <td className={tdBase} />
                                    {!readOnly && <td className={tdBase} />}
                                </tr>
                            </>
                        ) : (
                            <tr className="bg-slate-100 font-semibold">
                                <td colSpan={readOnly ? 5 : 6} className={`${tdBase} text-right font-bold`}>
                                    合計
                                </td>
                                <td className={`${tdBase} text-right font-bold text-base tabular-nums`}>
                                    ¥{subtotal.toLocaleString()}
                                </td>
                                <td className={tdBase} />
                                <td className={tdBase} />
                                {!readOnly && <td className={tdBase} />}
                            </tr>
                        )}
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
        // マイナス入力（値引き・調整など）も許容するため、0 でクランプしない。
        // Math.trunc で小数を 0 方向に丸める（-1.5 → -1）。
        const next = cleaned === '' ? 0 : Math.trunc(Number(cleaned));
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
                ) : value !== 0 && Number.isFinite(value) ? (
                    <span className={value < 0 ? 'text-rose-600' : ''}>{formatYen(value)}</span>
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
