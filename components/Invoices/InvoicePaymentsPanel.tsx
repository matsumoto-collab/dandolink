'use client';

import { useState } from 'react';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import type { PaymentSummary } from '@/lib/invoicePayments';
import {
    paymentStatusLabel,
    PAYMENT_METHOD_OPTIONS,
    formatYen as yen,
    todayYmd,
    formatPaidDate as fmtDate,
} from '@/lib/invoicePayments';
import { useInvoicePayments } from '@/hooks/useInvoicePayments';

interface InvoicePaymentsPanelProps {
    invoiceId: string;
    invoiceTotal: number;
    /** 一覧が持っている入金サマリ。取得完了までの初期表示に使う（任意） */
    initialSummary?: PaymentSummary;
    /** パネル内でサマリが更新されたら親（詳細モーダル）へ通知 */
    onSummaryChange?: (summary: PaymentSummary) => void;
    /** 入金の登録／取消が確定したら親（一覧）へ通知＝一覧を再取得させる */
    onChanged?: () => void;
}

/**
 * 1 請求書の入金記録を管理するパネル（残額サマリ＋登録フォーム＋履歴）。
 * 取得・登録・取消は useInvoicePayments（一覧のクイック入金ポップオーバーと共用）に委譲する。
 */
export function InvoicePaymentsPanel({
    invoiceId,
    invoiceTotal,
    initialSummary,
    onSummaryChange,
    onChanged,
}: InvoicePaymentsPanelProps) {
    const { payments, summary, loading, submitting, deletingId, addPayment, deletePayment } =
        useInvoicePayments({ invoiceId, initialSummary, onSummaryChange, onChanged });

    // 追加フォーム（入金日は登録後も保持し、金額・手数料・摘要だけリセット）
    const [paidDate, setPaidDate] = useState(todayYmd());
    const [amount, setAmount] = useState('');
    const [fee, setFee] = useState('');
    const [method, setMethod] = useState('振込');
    const [note, setNote] = useState('');

    const handleAdd = async () => {
        const result = await addPayment({
            paidDate,
            amount: Number(amount) || 0,
            fee: Number(fee) || 0,
            method: method || null,
            note: note || null,
        });
        if (result) {
            setAmount('');
            setFee('');
            setNote('');
        }
    };

    const handleDelete = (paymentId: string) => deletePayment(paymentId);

    const remaining = summary?.remaining ?? invoiceTotal;

    return (
        <div className="h-full overflow-auto bg-slate-50 p-4 md:p-6">
            <div className="mx-auto max-w-3xl space-y-5">
                {/* 残額サマリ */}
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                            <div className="text-xs text-slate-500">請求額</div>
                            <div className="text-base font-semibold text-slate-800">{yen(invoiceTotal)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">入金済</div>
                            <div className="text-base font-semibold text-slate-800">{yen(summary?.paidAmount ?? 0)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">手数料(相殺)</div>
                            <div className="text-base font-semibold text-slate-800">{yen(summary?.feeAmount ?? 0)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">残額</div>
                            <div className={`text-base font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                                {yen(remaining)}
                            </div>
                        </div>
                    </div>
                    {summary && (
                        <div className="mt-3 text-sm text-slate-600">
                            状況: <span className="font-medium">{paymentStatusLabel(summary.paymentStatus)}</span>
                            {summary.legacyPaid && (
                                <span className="ml-2 text-xs text-slate-400">（旧データ・入金記録なしで支払済み）</span>
                            )}
                        </div>
                    )}
                </div>

                {/* 入金登録フォーム */}
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm font-semibold text-slate-700 mb-3">入金を登録</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block">
                            <span className="text-xs text-slate-500">入金日</span>
                            <input
                                type="date"
                                value={paidDate}
                                onChange={(e) => setPaidDate(e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs text-slate-500">入金方法</span>
                            <select
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                            >
                                {PAYMENT_METHOD_OPTIONS.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs text-slate-500">入金額</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0"
                                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs text-slate-500">振込手数料（当社負担・相殺）</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                value={fee}
                                onChange={(e) => setFee(e.target.value)}
                                placeholder="0"
                                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </label>
                        <label className="block sm:col-span-2">
                            <span className="text-xs text-slate-500">摘要（任意）</span>
                            <input
                                type="text"
                                value={note}
                                maxLength={500}
                                onChange={(e) => setNote(e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </label>
                    </div>
                    <div className="mt-3 flex justify-end">
                        <button
                            onClick={handleAdd}
                            disabled={submitting}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            登録
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                        ※ 振込手数料が当社負担のときは手数料欄に入れると、その分だけ残額に充当されます
                        （例: 請求 100,000／入金 99,670／手数料 330 → 残額 0）。
                    </p>
                </div>

                {/* 入金履歴 */}
                <div className="bg-white rounded-xl border border-slate-200">
                    <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">
                        入金履歴{payments.length > 0 && `（${payments.length}件）`}
                    </div>
                    {loading ? (
                        <div className="p-6 flex justify-center">
                            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                        </div>
                    ) : payments.length === 0 ? (
                        <div className="p-6 text-center text-sm text-slate-400">入金記録はまだありません</div>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {payments.map((p) => (
                                <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-slate-800">
                                            {fmtDate(p.paidDate)}　{yen(p.amount)}
                                            {p.fee > 0 && (
                                                <span className="ml-2 text-xs text-slate-500">手数料 {yen(p.fee)}</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate">
                                            {p.method || '—'}{p.note ? `／${p.note}` : ''}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(p.id)}
                                        disabled={deletingId === p.id}
                                        className="flex-shrink-0 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors"
                                        title="取り消す"
                                        aria-label="入金記録を取り消す"
                                    >
                                        {deletingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
