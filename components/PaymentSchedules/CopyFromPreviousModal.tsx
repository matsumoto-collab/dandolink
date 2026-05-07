'use client';

import React, { useEffect, useState } from 'react';
import { X, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface CopyFromPreviousModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** コピー先の年 */
    toYear: number;
    /** コピー先の月 */
    toMonth: number;
    /** コピー成功後に呼ばれる */
    onSuccess: () => void;
}

interface DryRunSummary {
    sourceTotal: number;
    eligibleTotal: number;
    tenth: number;
    eom: number;
    other: number;
    transfer: number;
    paymentSlip: number;
    existingTargetCount: number;
}

// コピー元月の選択肢を生成（コピー先の前月、前々月、前年同月など）
function buildSourceOptions(toYear: number, toMonth: number) {
    const options: Array<{ year: number; month: number; label: string }> = [];
    // 1ヶ月前
    let y = toYear;
    let m = toMonth - 1;
    if (m === 0) {
        m = 12;
        y = y - 1;
    }
    options.push({ year: y, month: m, label: `${y}年${m}月（前月）` });

    // 2ヶ月前
    let y2 = y;
    let m2 = m - 1;
    if (m2 === 0) {
        m2 = 12;
        y2 = y2 - 1;
    }
    options.push({ year: y2, month: m2, label: `${y2}年${m2}月（前々月）` });

    // 前年同月
    options.push({
        year: toYear - 1,
        month: toMonth,
        label: `${toYear - 1}年${toMonth}月（前年同月）`,
    });

    return options;
}

export default function CopyFromPreviousModal({
    isOpen,
    onClose,
    toYear,
    toMonth,
    onSuccess,
}: CopyFromPreviousModalProps) {
    const sourceOptions = buildSourceOptions(toYear, toMonth);
    const [sourceIdx, setSourceIdx] = useState(0);
    const [includeTransfer, setIncludeTransfer] = useState(true);
    const [includePaymentSlip, setIncludePaymentSlip] = useState(true);
    const [includeTenth, setIncludeTenth] = useState(true);
    const [includeEom, setIncludeEom] = useState(true);
    const [includeOther, setIncludeOther] = useState(false);
    const [summary, setSummary] = useState<DryRunSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const source = sourceOptions[sourceIdx];

    const buildBody = (dryRun: boolean) => {
        const paymentTypes: string[] = [];
        if (includeTransfer) paymentTypes.push('transfer');
        if (includePaymentSlip) paymentTypes.push('payment_slip');

        const dateTypes: string[] = [];
        if (includeTenth) dateTypes.push('tenth');
        if (includeEom) dateTypes.push('eom');
        if (includeOther) dateTypes.push('other');

        return {
            fromYear: source.year,
            fromMonth: source.month,
            toYear,
            toMonth,
            paymentTypes: paymentTypes.length > 0 ? paymentTypes : undefined,
            dateTypes: dateTypes.length > 0 ? dateTypes : undefined,
            dryRun,
        };
    };

    // ドライラン（条件変更時に件数を再計算）
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const run = async () => {
            try {
                setLoading(true);
                const res = await fetch('/api/payment-schedules/copy-from', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildBody(true)),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || '件数取得に失敗しました');
                }
                const data = await res.json();
                if (!cancelled) setSummary(data.summary);
            } catch (e) {
                logger.error('Failed dry run', e);
                if (!cancelled) setSummary(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        run();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, sourceIdx, includeTransfer, includePaymentSlip, includeTenth, includeEom, includeOther]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!summary || summary.eligibleTotal === 0) {
            toast.error('コピー対象がありません');
            return;
        }

        // 既に対象月にデータがある場合は確認
        if (summary.existingTargetCount > 0) {
            const ok = confirm(
                `${toYear}年${toMonth}月にはすでに${summary.existingTargetCount}件の支払予定があります。\n` +
                `重複する可能性がありますが、${summary.eligibleTotal}件をコピーしますか？`
            );
            if (!ok) return;
        }

        try {
            setSubmitting(true);
            const res = await fetch('/api/payment-schedules/copy-from', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBody(false)),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'コピーに失敗しました');
            }
            const data = await res.json();
            toast.success(`${data.created}件をコピーしました`);
            onSuccess();
            onClose();
        } catch (e) {
            logger.error('Failed to copy', e);
            toast.error(e instanceof Error ? e.message : 'コピーに失敗しました');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <h2 className="text-lg font-semibold">前月からコピー</h2>
                    <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5 p-6">
                    {/* コピー元月の選択 */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">コピー元の月</label>
                        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <select
                                value={sourceIdx}
                                onChange={(e) => setSourceIdx(Number(e.target.value))}
                                className="rounded-lg border border-slate-300 px-3 py-2 bg-white"
                            >
                                {sourceOptions.map((opt, i) => (
                                    <option key={i} value={i}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            <ArrowRight className="w-5 h-5 text-slate-500" />
                            <div className="rounded-lg bg-slate-800 px-3 py-2 text-white text-sm font-semibold">
                                {toYear}年{toMonth}月
                            </div>
                        </div>
                    </div>

                    {/* フィルタ: 支払種別 */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">支払種別</label>
                        <div className="flex gap-2 flex-wrap">
                            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                                <input
                                    type="checkbox"
                                    checked={includeTransfer}
                                    onChange={(e) => setIncludeTransfer(e.target.checked)}
                                />
                                <span className="text-sm">銀行振込</span>
                            </label>
                            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                                <input
                                    type="checkbox"
                                    checked={includePaymentSlip}
                                    onChange={(e) => setIncludePaymentSlip(e.target.checked)}
                                />
                                <span className="text-sm">払込用紙</span>
                            </label>
                        </div>
                    </div>

                    {/* フィルタ: 日付タイプ */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">支払日タイプ</label>
                        <div className="flex gap-2 flex-wrap">
                            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                                <input
                                    type="checkbox"
                                    checked={includeTenth}
                                    onChange={(e) => setIncludeTenth(e.target.checked)}
                                />
                                <span className="text-sm">10日</span>
                            </label>
                            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                                <input
                                    type="checkbox"
                                    checked={includeEom}
                                    onChange={(e) => setIncludeEom(e.target.checked)}
                                />
                                <span className="text-sm">末日</span>
                            </label>
                            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                                <input
                                    type="checkbox"
                                    checked={includeOther}
                                    onChange={(e) => setIncludeOther(e.target.checked)}
                                />
                                <span className="text-sm">その他の日</span>
                            </label>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                            「その他の日」は緊急支払いなど。月のルーチン支払いだけコピーしたい場合は除外できます
                        </p>
                    </div>

                    {/* プレビュー */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 text-sm font-medium text-slate-700">コピー対象</div>
                        {loading ? (
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                計算中...
                            </div>
                        ) : !summary ? (
                            <div className="text-sm text-slate-500">データを取得できませんでした</div>
                        ) : (
                            <div className="space-y-1.5 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-600">
                                        {source.year}年{source.month}月の合計
                                    </span>
                                    <span className="font-medium">{summary.sourceTotal}件</span>
                                </div>
                                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                                    <span className="text-slate-700 font-medium">
                                        コピーする件数
                                    </span>
                                    <span className="font-bold text-slate-900">
                                        {summary.eligibleTotal}件
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
                                    <div className="rounded bg-white px-2 py-1 text-center">
                                        <div className="text-slate-500">10日</div>
                                        <div className="font-semibold">{summary.tenth}件</div>
                                    </div>
                                    <div className="rounded bg-white px-2 py-1 text-center">
                                        <div className="text-slate-500">末日</div>
                                        <div className="font-semibold">{summary.eom}件</div>
                                    </div>
                                    <div className="rounded bg-white px-2 py-1 text-center">
                                        <div className="text-slate-500">その他</div>
                                        <div className="font-semibold">{summary.other}件</div>
                                    </div>
                                </div>
                                {summary.existingTargetCount > 0 && (
                                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        ⚠ {toYear}年{toMonth}月にはすでに
                                        <strong>{summary.existingTargetCount}件</strong>の支払予定があります。
                                        コピー後に重複する可能性があるのでご注意ください。
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 注意事項 */}
                    <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                        💡 コピーされた支払予定はすべて<strong>「未払」</strong>状態になります。<br />
                        支払日は自動調整されます: 「10日」→ 同月10日 / 「末日」→ 同月最終日
                    </div>
                </div>

                <div className="flex justify-end gap-2 border-t px-6 py-4">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        キャンセル
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        isLoading={submitting}
                        disabled={!summary || summary.eligibleTotal === 0}
                        onClick={handleSubmit}
                    >
                        {summary && summary.eligibleTotal > 0
                            ? `${summary.eligibleTotal}件をコピー`
                            : 'コピー'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
