'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * この案件の請求が今回で終わりか（請求書の発行後に ProjectMaster.billingStatusOverride へ書き込む値）。
 * 'full' = 請求完了（請求済みにする） / 'partial' = まだ続く（一部請求にする）。
 */
export type BillingCompletion = 'full' | 'partial';

/** 確認ダイアログに並べる案件（請求書に含まれる案件）。 */
export interface BillingCompletionTarget {
    id: string;
    /** 表示名（正式名称 or 現場名）。 */
    title: string;
}

interface BillingCompletionDialogProps {
    open: boolean;
    projects: BillingCompletionTarget[];
    /** 既存請求書への追記か（見出しの文言だけ変える）。 */
    isAppend?: boolean;
    submitting?: boolean;
    onCancel: () => void;
    onConfirm: (completions: Record<string, BillingCompletion>) => void;
}

const OPTIONS: Array<{ value: BillingCompletion; label: string; hint: string }> = [
    { value: 'full', label: '請求完了', hint: '請求済みにする' },
    { value: 'partial', label: 'まだ続く', hint: '一部請求にする' },
];

/**
 * 請求書を発行する直前に、含まれる案件ごとに「請求完了／まだ続く」を必ず選ばせる確認ダイアログ。
 * 既定は常に未選択（過去の手動設定はプレフィルしない）。全案件を選ぶまで確定できない。
 */
export default function BillingCompletionDialog({
    open,
    projects,
    isAppend,
    submitting,
    onCancel,
    onConfirm,
}: BillingCompletionDialogProps) {
    const [choices, setChoices] = useState<Record<string, BillingCompletion>>({});

    // 開くたびに未選択へ戻す（前回の選択やDBの手動設定は引き継がない）
    useEffect(() => {
        if (open) setChoices({});
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onCancel]);

    if (!open) return null;

    const remaining = projects.filter((p) => !choices[p.id]).length;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900">
                            {isAppend ? '当月の請求書に追記します' : '請求書を作成します'}
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                            案件ごとに、今回で請求が終わりかどうかを選んでください（案件の請求バッジに反映します）。
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        aria-label="閉じる"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    {projects.map((p) => (
                        <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="truncate text-sm font-medium text-slate-800">{p.title}</div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {OPTIONS.map((o) => (
                                    <label
                                        key={o.value}
                                        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                                            choices[p.id] === o.value
                                                ? 'border-teal-500 bg-teal-50'
                                                : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name={`billing-completion-${p.id}`}
                                            className="mt-0.5"
                                            checked={choices[p.id] === o.value}
                                            onChange={() => setChoices((prev) => ({ ...prev, [p.id]: o.value }))}
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-sm font-medium text-slate-800">{o.label}</span>
                                            <span className="block text-[11px] text-slate-500">{o.hint}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
                    <span className="text-xs text-slate-500">
                        {remaining > 0 ? `未選択 ${remaining}件` : `${projects.length}件すべて選択済み`}
                    </span>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                            キャンセル
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            onClick={() => onConfirm(choices)}
                            disabled={submitting || remaining > 0 || projects.length === 0}
                            isLoading={submitting}
                        >
                            {isAppend ? '追記へ進む' : '請求書へ進む'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
