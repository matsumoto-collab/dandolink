'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Estimate } from '@/types/estimate';

// PDF プレビューは重い（pdfjs）ので、見積書を開いたときだけ読み込む
const LivePdfPreview = dynamic(
    () => import('@/components/ui/LivePdfPreview').then((m) => ({ default: m.LivePdfPreview })),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">プレビューを読み込み中…</div>
        ),
    },
);

const yen = (n: number | null) => (n == null ? '—' : `¥${Math.round(n).toLocaleString()}`);

/** 「請求する」ダイアログの確定結果。 */
export type RequestBillingResult =
    | { kind: 'estimate' } // 見積どおり（明細展開・複数は呼び出し側でピッカー）
    | { kind: 'amount'; amount: number; note: string }; // 金額指定（出来高・残額すべて）

interface RequestBillingDialogProps {
    open: boolean;
    projectTitle: string;
    estimateAmount: number | null;
    invoicedAmount: number;
    remainingAmount: number | null;
    /** 見積の合計（税抜・全見積の subtotal 合算）。未取得/無しは null。 */
    estimateTotal: number | null;
    estimateCount: number;
    /** プレビュー用の見積一覧（空 or renderEstimatePdf 未指定なら「見積書を確認」非表示）。 */
    estimates?: Estimate[];
    /** 見積 1 件を PDF Blob にする（親が案件・自社情報を解決）。 */
    renderEstimatePdf?: (estimate: Estimate) => Promise<Blob | null>;
    submitting?: boolean;
    onClose: () => void;
    onConfirm: (result: RequestBillingResult) => void;
}

type Choice = 'amount' | 'remaining' | 'estimate';
type Unit = 'yen' | 'pct';

const NOTE_PRESETS = ['着手金', '中間金', '完成', '出来高'];

/**
 * 「請求する」時に請求金額を指定するダイアログ（Phase 4）。
 * - 金額・比率で指定（出来高）：¥ または 見積金額×% で金額を決め、摘要（着手金 等）を付ける → 1 行で請求対象。
 * - 残額すべて：見積金額 − 既請求 の残額を 1 行で請求対象。
 * - 見積どおり：見積明細を展開（複数見積は呼び出し側でピッカー）。
 * 残額は発行（請求書化）後に自動で繰り越される（partial 表示）ため、出来高は複数回に分けられる。
 */
export default function RequestBillingDialog({
    open,
    projectTitle,
    estimateAmount,
    invoicedAmount,
    remainingAmount,
    estimateTotal,
    estimateCount,
    estimates = [],
    renderEstimatePdf,
    submitting,
    onClose,
    onConfirm,
}: RequestBillingDialogProps) {
    const hasEstimates = estimateCount > 0;
    const hasEstimate = estimateAmount != null;
    const remaining = remainingAmount ?? estimateAmount ?? 0;

    const [choice, setChoice] = useState<Choice>('amount');
    const [unit, setUnit] = useState<Unit>('yen');
    const [yenInput, setYenInput] = useState<string>('');
    const [pctInput, setPctInput] = useState<string>('');
    const [note, setNote] = useState<string>('');
    const [showPreview, setShowPreview] = useState(false);
    const [selectedEstimateId, setSelectedEstimateId] = useState<string>('');
    const canPreview = !!renderEstimatePdf && estimates.length > 0;

    // 開くたびに初期化（既定＝残額を金額に prefill）
    useEffect(() => {
        if (!open) return;
        setChoice('amount');
        setUnit('yen');
        setYenInput(remaining > 0 ? String(Math.round(remaining)) : '');
        setPctInput('');
        setNote('');
        setShowPreview(false);
        const approved = estimates.find((e) => e.status === 'approved');
        setSelectedEstimateId(approved?.id ?? estimates[0]?.id ?? '');
        // remaining/estimates は props 由来。open 立ち上がり時のみ初期化したいので open のみ依存。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // 比率→金額（契約×%）
    const amountFromInputs = useMemo(() => {
        if (unit === 'pct') {
            const pct = Number(pctInput);
            if (!hasEstimate || !Number.isFinite(pct) || pct <= 0) return 0;
            return Math.round((estimateAmount as number) * (pct / 100));
        }
        const v = Number(yenInput);
        return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    }, [unit, pctInput, yenInput, hasEstimate, estimateAmount]);

    if (!open) return null;

    const selectedEstimate = estimates.find((e) => e.id === selectedEstimateId) ?? null;
    const resolvedAmount =
        choice === 'remaining' ? Math.max(0, Math.round(remaining)) : choice === 'amount' ? amountFromInputs : 0;
    const canConfirm = choice === 'estimate' ? hasEstimates : resolvedAmount > 0;
    const afterRemaining = hasEstimate ? (remainingAmount ?? 0) - resolvedAmount : null;

    const handleConfirm = () => {
        if (choice === 'estimate') {
            onConfirm({ kind: 'estimate' });
            return;
        }
        if (resolvedAmount <= 0) return;
        onConfirm({ kind: 'amount', amount: resolvedAmount, note: choice === 'amount' ? note.trim() : '' });
    };

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 lg:left-48"
            onClick={onClose}
        >
            <div
                className={`flex gap-3 ${showPreview ? 'h-[88vh] w-full max-w-6xl' : 'w-full max-w-md'}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className={`flex flex-col rounded-xl bg-white p-5 shadow-xl ${
                        showPreview ? 'w-full max-w-md shrink-0 overflow-y-auto lg:w-[400px]' : 'w-full'
                    }`}
                >
                <h3 className="text-base font-bold text-slate-900">請求金額を指定</h3>
                <p className="mt-0.5 truncate text-sm text-slate-500">{projectTitle}</p>

                {/* 金額サマリ */}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span>
                        見積金額 <span className="font-semibold text-slate-800">{yen(estimateAmount)}</span>
                    </span>
                    <span>
                        既請求 <span className="font-semibold text-slate-800">{yen(invoicedAmount)}</span>
                    </span>
                    <span>
                        残 <span className="font-semibold text-slate-900">{yen(remainingAmount)}</span>
                    </span>
                </div>

                {canPreview && (
                    <button
                        type="button"
                        onClick={() => setShowPreview((v) => !v)}
                        className="mt-3 hidden w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:inline-flex"
                    >
                        <FileText className="h-4 w-4" />
                        {showPreview ? '見積書を隠す' : '見積書を確認'}
                    </button>
                )}

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
                                            disabled={!hasEstimate}
                                            className={`rounded px-2 py-0.5 text-xs disabled:opacity-40 ${unit === 'pct' ? 'bg-teal-600 text-white' : 'text-slate-600'}`}
                                            title={hasEstimate ? '' : '見積金額が未設定のため比率は使えません'}
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
                    {hasEstimate && (
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
                        今回 {yen(resolvedAmount)} を請求対象に追加。
                        {afterRemaining > 0
                            ? `残 ${yen(afterRemaining)} は次回へ持ち越し。`
                            : afterRemaining === 0
                              ? '残額すべてを請求します。'
                              : `見積金額を ${yen(-afterRemaining)} 超過します。`}
                    </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                        キャンセル
                    </Button>
                    <Button type="button" variant="primary" onClick={handleConfirm} disabled={!canConfirm || submitting}>
                        {submitting ? '追加中…' : '請求対象に追加'}
                    </Button>
                </div>
                </div>

                {showPreview && (
                    <div className="hidden min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-xl lg:flex">
                        {estimates.length > 1 && (
                            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 p-2">
                                <span className="px-1 text-xs text-slate-500">見積:</span>
                                {estimates.map((e) => (
                                    <button
                                        key={e.id}
                                        type="button"
                                        onClick={() => setSelectedEstimateId(e.id)}
                                        title={e.title || e.estimateNumber}
                                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                            selectedEstimateId === e.id
                                                ? 'bg-teal-600 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                    >
                                        {e.estimateNumber}
                                        {e.status === 'approved' ? ' ✓' : ''}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="min-h-0 flex-1">
                            {selectedEstimate && renderEstimatePdf ? (
                                <LivePdfPreview
                                    seed={selectedEstimate.id}
                                    renderPdf={() => renderEstimatePdf(selectedEstimate)}
                                    debounceMs={250}
                                    initialDelayMs={0}
                                />
                            ) : (
                                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                                    見積書がありません
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
