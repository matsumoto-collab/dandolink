'use client';

import type { PaymentSummary } from '@/lib/invoicePayments';
import { paymentStatusLabel } from '@/lib/invoicePayments';

const STATUS_STYLE: Record<PaymentSummary['paymentStatus'], string> = {
    paid: 'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    unpaid: 'bg-slate-100 text-slate-500',
};

/**
 * 入金状況バッジ（請求書一覧・詳細モーダルで共用）。
 * summary 未取得（旧レスポンス等）のときは「−」を表示。
 * showRemaining=true で残額が残っている場合のみ「残 ¥x」を併記する。
 */
export function PaymentStatusBadge({
    summary,
    showRemaining = false,
    className = '',
}: {
    summary?: PaymentSummary;
    showRemaining?: boolean;
    className?: string;
}) {
    if (!summary) {
        return <span className={`text-slate-400 ${className}`}>−</span>;
    }
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <span
                className={`inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[summary.paymentStatus]}`}
            >
                {paymentStatusLabel(summary.paymentStatus)}
            </span>
            {showRemaining && summary.remaining > 0 && (
                <span className="text-xs text-slate-500 whitespace-nowrap">
                    残 ¥{summary.remaining.toLocaleString()}
                </span>
            )}
        </div>
    );
}
