'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';

const yen = (n: number | null) => (n == null ? '—' : `¥${Math.round(n).toLocaleString()}`);

/** 「請求する」ダイアログの確定結果。 */
export type RequestBillingResult =
    | { kind: 'estimate' } // 見積どおり（明細展開・複数は呼び出し側でピッカー）
    | { kind: 'amount'; amount: number; note: string }; // 金額指定（出来高・残額すべて）

interface RequestBillingDialogProps {
    open: boolean;
    projectTitle: string;
    contractAmount: number | null;
    invoicedAmount: number;
    remainingAmount: number | null;
    /** 見積の合計（税抜・全見積の subtotal 合算）。未取得/無しは null。 */
    estimateTotal: number | null;
    estimateCount: number;
    submitting?: boolean;
    onClose: () => void;
    onConfirm: (result: RequestBillingResult) => void;
}

type Choice = 'amount' | 'remaining' | 'estimate';
type Unit = 'yen' | 'pct';

const NOTE_PRESETS = ['着手金', '中間金', '完成', '出来高'];

/**
 * 「請求する」時に請求金額を指定するダイアログ（Phase 4）。
 * - 金額・比率で指定（出来高）：¥ または 契約×% で金額を決め、摘要（着手金 等）を付ける → 1 行で請求予定。
 * - 残額すべて：契約 − 既請求 の残額を 1 行で請求予定。
 * - 見積どおり：見積明細を展開（複数見積は呼び出し側でピッカー）。
 * 残額は発行（請求書化）後に自動で繰り越される（partial 表示）ため、出来高は複数回に分けられる。
 */
export default function RequestBillingDialog({
    open,
    projectTitle,
    contractAmount,
    invoicedAmount,
    remainingAmount,
    estimateTotal,
    estimateCount,
    submitting,
    onClose,
    onConfirm,
}: RequestBillingDialogProps) {
    const hasEstimates = estimateCount > 0;
    const hasContract = contractAmount != null;
    const remaining = remainingAmount ?? contractAmount ?? 0;

    const [choice, setChoice] = useState<Choice>('amount');
    const [unit, setUnit] = useState<Unit>('yen');
    const [yenInput, setYenInput] = useState<string>('');
    const [pctInput, setPctInput] = useState<string>('');
    const [note, setNote] = useState<string>('');

    // 開くたびに初期化（既定＝残額を金額に prefill）
    useEffect(() => {
        if (!open) return;
        setChoice('amount');
        setUnit('yen');
        setYenInput(remaining > 0 ? String(Math.round(remaining)) : '');
        setPctInput('');
        setNote('');
        // remaining は props 由来。open 立ち上がり時のみ初期化したいので open のみ依存。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // 比率→金額（契約×%）
    const amountFromInputs = useMemo(() => {
        if (unit === 'pct') {
            const pct = Number(pctInput);
            if (!hasContract || !Number.isFinite(pct) || pct <= 0) return 0;
            return Math.round((contractAmount as number) * (pct / 100));
        }
        const v = Number(yenInput);
        return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    }, [unit, pctInput, yenInput, hasContract, contractAmount]);

    if (!open) return null;

    const resolvedAmount =
        choice === 'remaining' ? Math.max(0, Math.round(remaining)) : choice === 'amount' ? amountFromInputs : 0;
    const canConfirm = choice === 'estimate' ? hasEstimates : resolvedAmount > 0;
    const afterRemaining = hasContract ? (remainingAmount ?? 0) - resolvedAmount : null;

    const handleConfirm = () => {
        if (choice === 'estimate') {
            onConfirm({ kind: 'estimate' });
            return;
        }
        if (resolvedAmount <= 0) return;
        onConfirm({ kind: 'amount', amount: resolvedAmount, note: choice === 'amount' ? note.trim() : '' });
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-base font-bold text-slate-900">請求金額を指定</h3>
                <p className="mt-0.5 truncate text-sm text-slate-500">{projectTitle}</p>

                {/* 金額サマリ */}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span>
                        契約 <span className="font-semibold text-slate-800">{yen(contractAmount)}</span>
                    </span>
                    <span>
                        既請求 <span className="font-semibold text-slate-800">{yen(invoicedAmount)}</span>
                    </span>
                    <span>
                        残 <span className="font-semibold text-slate-900">{yen(remainingAmount)}</span>
                    </span>
                </div>

                <div className="mt-4 space-y-3">
                    {/* 金額・比率で指定 */}
                    <label className="flex cursor-pointer items-start gap-2">
                        <input
                            type="radio"
                            checked={choice === 'amount'}
                            onChange={() => setChoice('amount')}
                            className="mt-1"
                        />
                        <div className="flex-1">
                            <div className="text-sm font-medium text-slate-800">金額・比率で指定（出来高）</div>
                            <div className={`mt-2 space-y-2 ${choice === 'amount' ? '' : 'pointer-events-none opacity-50'}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setUnit('yen')}
                                            className={`rounded px-2 py-0.5 text-xs ${unit === 'yen' ? 'bg-teal-600 text-white' : 'text-slate-600'}`}
                                        >
                                            金額
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setUnit('pct')}
                                            disabled={!hasContract}
                                            className={`rounded px-2 py-0.5 text-xs disabled:opacity-40 ${unit === 'pct' ? 'bg-teal-600 text-white' : 'text-slate-600'}`}
                                            title={hasContract ? '' : '契約金額が未設定のため比率は使えません'}
                                        >
                                            比率
                                        </button>
                                    </div>
                                    {unit === 'yen' ? (
                                        <div className="flex items-center gap-1">
                                            <span className="text-slate-400">¥</span>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                value={yenInput}
                                                onChange={(e) => setYenInput(e.target.value)}
                                                placeholder="300000"
                                                className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                value={pctInput}
                                                onChange={(e) => setPctInput(e.target.value)}
                                                placeholder="30"
                                                className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            />
                                            <span className="text-slate-400">%</span>
                                            <span className="text-xs text-slate-500">→ {yen(amountFromInputs)}</span>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <input
                                        type="text"
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="摘要（例: 着手金）"
                                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    />
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {NOTE_PRESETS.map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setNote(p)}
                                                className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </label>

                    {/* 残額すべて */}
                    {hasContract && (
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="radio"
                                checked={choice === 'remaining'}
                                onChange={() => setChoice('remaining')}
                            />
                            <span className="text-sm text-slate-800">残額すべて（{yen(remainingAmount)}）</span>
                        </label>
                    )}

                    {/* 見積どおり */}
                    {hasEstimates && (
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="radio"
                                checked={choice === 'estimate'}
                                onChange={() => setChoice('estimate')}
                            />
                            <span className="text-sm text-slate-800">
                                見積どおり（{estimateTotal != null ? yen(estimateTotal) : '見積から'}
                                {estimateCount > 1 ? `・${estimateCount}件` : ''}）
                            </span>
                        </label>
                    )}
                </div>

                {/* 持ち越しプレビュー */}
                {choice !== 'estimate' && afterRemaining != null && (
                    <p className="mt-3 text-xs text-slate-500">
                        今回 {yen(resolvedAmount)} を請求予定に追加。
                        {afterRemaining > 0
                            ? `残 ${yen(afterRemaining)} は次回へ持ち越し。`
                            : afterRemaining === 0
                              ? '残額すべてを請求します。'
                              : `契約額を ${yen(-afterRemaining)} 超過します。`}
                    </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                        キャンセル
                    </Button>
                    <Button type="button" variant="primary" onClick={handleConfirm} disabled={!canConfirm || submitting}>
                        {submitting ? '追加中…' : '請求予定に追加'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
