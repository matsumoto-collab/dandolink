'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** ピッカーに渡す見積の最小情報（明細本体は親が保持し、確定時に選択 ID から解決する）。 */
export interface EstimateChoice {
    id: string;
    estimateNumber: string;
    title: string;
    status: string;
    subtotal: number;
}

interface EstimatePickerDialogProps {
    open: boolean;
    /** 見出し用の案件名（正式名称）。 */
    projectTitle: string;
    estimates: EstimateChoice[];
    submitting?: boolean;
    onClose: () => void;
    onConfirm: (selectedIds: string[]) => void;
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const STATUS_LABEL: Record<string, string> = {
    draft: '下書き',
    sent: '送付済み',
    approved: '承認済み',
    rejected: '却下',
};

/**
 * 1 案件に見積が複数あるとき「どの見積から請求予定を作るか」を選ぶダイアログ。
 * 見積が 1 件（または承認済みが 1 件）のときは親側で自動採用し、本ダイアログは開かない。
 * 既定では承認済みの見積にチェックを入れる（無ければ全件）。
 */
export default function EstimatePickerDialog({
    open,
    projectTitle,
    estimates,
    submitting,
    onClose,
    onConfirm,
}: EstimatePickerDialogProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!open) return;
        const approved = estimates.filter((e) => e.status === 'approved').map((e) => e.id);
        setSelected(new Set(approved.length > 0 ? approved : estimates.map((e) => e.id)));
    }, [open, estimates]);

    const total = useMemo(
        () => estimates.filter((e) => selected.has(e.id)).reduce((s, e) => s + e.subtotal, 0),
        [estimates, selected],
    );

    if (!open) return null;

    const toggle = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900">
                            どの見積から請求予定を作成しますか？
                        </h2>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{projectTitle}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        aria-label="閉じる"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="max-h-[50vh] space-y-2 overflow-y-auto p-4">
                    {estimates.length === 0 ? (
                        <p className="py-6 text-center text-sm text-slate-500">見積書がありません</p>
                    ) : (
                        estimates.map((e) => {
                            const checked = selected.has(e.id);
                            return (
                                <label
                                    key={e.id}
                                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                                        checked ? 'border-teal-300 bg-teal-50/50' : 'border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(e.id)}
                                        className="mt-1"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium text-slate-800">
                                                {e.title || e.estimateNumber}
                                            </span>
                                            {e.status === 'approved' && (
                                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                                    承認済み
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-500">
                                            {e.estimateNumber}・{STATUS_LABEL[e.status] ?? e.status}
                                        </div>
                                    </div>
                                    <span className="whitespace-nowrap text-sm font-semibold text-slate-800">
                                        {yen(e.subtotal)}
                                    </span>
                                </label>
                            );
                        })
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
                    <span className="text-sm text-slate-600">
                        選択 {selected.size} 件 / 合計{' '}
                        <span className="font-semibold text-slate-900">{yen(total)}</span>（税抜）
                    </span>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                            キャンセル
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            onClick={() => onConfirm(Array.from(selected))}
                            disabled={submitting || selected.size === 0}
                            isLoading={submitting}
                        >
                            この見積で作成
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
