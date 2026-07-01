'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import type { Invoice } from '@/types/invoice';
import type { PaymentSummary } from '@/lib/invoicePayments';
import {
    PAYMENT_METHOD_OPTIONS,
    formatYen as yen,
    todayYmd,
    formatPaidDate as fmtDate,
} from '@/lib/invoicePayments';
import { useInvoicePayments } from '@/hooks/useInvoicePayments';

/** 一覧行のバッジ位置（getBoundingClientRect の値。fixed 配置の基準にする） */
export interface PaymentPopoverAnchor {
    top: number;
    left: number;
    bottom: number;
    right: number;
}

interface InvoicePaymentQuickPopoverProps {
    invoice: Invoice;
    anchor: PaymentPopoverAnchor;
    onClose: () => void;
    /** 入金の登録／取消が確定したら親（一覧）へ通知＝一覧を再取得させる */
    onChanged?: () => void;
}

const PANEL_W = 360;
const MARGIN = 12;

/** 残額（>0）を入金額プリフィル用の文字列にする。旧データ（記録なし支払済み）はプリフィルしない */
function prefillAmount(summary?: PaymentSummary): string {
    if (!summary || summary.legacyPaid || summary.remaining <= 0) return '';
    return String(Math.round(summary.remaining));
}

/**
 * 請求書一覧の「入金状況」バッジから開くクイック入金ポップオーバー。
 * モーダルを開かずにその場で入金の登録（＋履歴の確認・取消）ができる。
 * 入金額には残額をプリフィルするので、全額入金なら開いて「登録」だけで完了する。
 *
 * このアプリは <main> が position:fixed でスタッキングコンテキストを作るため、
 * ポップオーバーは Portal で body 直下に描画する（テーブルの overflow クリップも回避）。
 */
export default function InvoicePaymentQuickPopover({
    invoice,
    anchor,
    onClose,
    onChanged,
}: InvoicePaymentQuickPopoverProps) {
    const { payments, summary, loading, submitting, deletingId, addPayment, deletePayment } =
        useInvoicePayments({ invoiceId: invoice.id, initialSummary: invoice.paymentSummary, onChanged });

    // 追加フォーム。入金額は残額をプリフィルし、ユーザーが触るまでは最新サマリに追従する
    const [paidDate, setPaidDate] = useState(todayYmd());
    const [method, setMethod] = useState('振込');
    const [amount, setAmount] = useState(() => prefillAmount(invoice.paymentSummary));
    const [fee, setFee] = useState('');
    const [note, setNote] = useState('');
    const amountDirtyRef = useRef(false);

    useEffect(() => {
        if (loading || amountDirtyRef.current) return;
        setAmount(prefillAmount(summary));
    }, [summary, loading]);

    // Esc で閉じる
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // 配置（マウント時の画面サイズで決定。開いている間は backdrop が背景操作を遮るため追従不要）。
    // md 未満（カードビュー）は null を返して中央寄せの CSS 配置にする。
    const panelStyle = useMemo(() => {
        if (typeof window === 'undefined' || window.innerWidth < 768) return null;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const left = Math.max(MARGIN, Math.min(anchor.left, vw - PANEL_W - MARGIN));
        const spaceBelow = vh - anchor.bottom - MARGIN;
        const spaceAbove = anchor.top - MARGIN;
        if (spaceBelow >= 380 || spaceBelow >= spaceAbove) {
            return { top: anchor.bottom + 6, left, maxHeight: Math.min(spaceBelow, 620) };
        }
        return { bottom: vh - anchor.top + 6, left, maxHeight: Math.min(spaceAbove, 620) };
    }, [anchor]);

    const handleAdd = async () => {
        const ok = await addPayment({
            paidDate,
            amount: Number(amount) || 0,
            fee: Number(fee) || 0,
            method: method || null,
            note: note || null,
        });
        if (ok) onClose(); // 登録できたら閉じて一覧へ戻る（バッジは onChanged の再取得で更新）
    };

    const remaining = summary?.remaining ?? invoice.total;
    const inputClass =
        'mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500';

    return createPortal(
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="入金の登録">
            <div className="absolute inset-0 bg-black/20" onClick={onClose} />
            <div
                className={`absolute flex flex-col overflow-hidden bg-white rounded-xl shadow-2xl border border-slate-200 ${
                    panelStyle
                        ? 'w-[360px] max-w-[calc(100vw-24px)]'
                        : 'inset-x-3 top-[4.5rem] mx-auto max-w-md max-h-[calc(100vh-6rem)]'
                }`}
                style={panelStyle ?? undefined}
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 flex items-start justify-between gap-2 px-4 pt-3 pb-2 border-b border-slate-100">
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800">入金を登録</div>
                        <div className="text-xs text-slate-500 truncate">
                            {invoice.invoiceNumber}　{invoice.title || '(タイトル未設定)'}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="overflow-y-auto">
                    {/* 残額サマリ（コンパクト） */}
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                        <span>請求 <span className="font-semibold text-slate-800">{yen(invoice.total)}</span></span>
                        <span>入金済 <span className="font-semibold text-slate-800">{yen(summary?.paidAmount ?? 0)}</span></span>
                        {(summary?.feeAmount ?? 0) > 0 && (
                            <span>手数料 <span className="font-semibold text-slate-800">{yen(summary?.feeAmount ?? 0)}</span></span>
                        )}
                        <span>残額 <span className={`font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>{yen(remaining)}</span></span>
                        {summary?.legacyPaid && (
                            <span className="text-slate-400">（旧データ・入金記録なしで支払済み）</span>
                        )}
                    </div>

                    {/* 入金登録フォーム */}
                    <div className="p-4 grid grid-cols-2 gap-2.5">
                        <label className="block">
                            <span className="text-xs text-slate-500">入金日</span>
                            <input
                                type="date"
                                value={paidDate}
                                onChange={(e) => setPaidDate(e.target.value)}
                                className={inputClass}
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs text-slate-500">入金方法</span>
                            <select
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                                className={`${inputClass} bg-white`}
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
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => { amountDirtyRef.current = true; setAmount(e.target.value); }}
                                placeholder="0"
                                className={inputClass}
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs text-slate-500">振込手数料（当社負担）</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                value={fee}
                                onChange={(e) => setFee(e.target.value)}
                                placeholder="0"
                                className={inputClass}
                            />
                        </label>
                        <label className="block col-span-2">
                            <span className="text-xs text-slate-500">摘要（任意）</span>
                            <input
                                type="text"
                                value={note}
                                maxLength={500}
                                onChange={(e) => setNote(e.target.value)}
                                className={inputClass}
                            />
                        </label>
                        <div className="col-span-2">
                            <button
                                onClick={handleAdd}
                                disabled={submitting}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors text-sm font-medium"
                            >
                                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                登録
                            </button>
                            <p className="mt-1.5 text-[11px] text-slate-400">
                                ※ 振込手数料が当社負担のときは手数料欄に入れると残額に充当されます
                            </p>
                        </div>
                    </div>

                    {/* 入金履歴 */}
                    <div className="border-t border-slate-100">
                        <div className="px-4 py-2 text-xs font-semibold text-slate-600">
                            入金履歴{payments.length > 0 && `（${payments.length}件）`}
                        </div>
                        {loading ? (
                            <div className="px-4 pb-4 flex justify-center">
                                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                            </div>
                        ) : payments.length === 0 ? (
                            <div className="px-4 pb-4 text-xs text-slate-400">入金記録はまだありません</div>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {payments.map((p) => (
                                    <li key={p.id} className="px-4 py-2 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-xs font-medium text-slate-800">
                                                {fmtDate(p.paidDate)}　{yen(p.amount)}
                                                {p.fee > 0 && (
                                                    <span className="ml-1.5 text-[11px] text-slate-500">手数料 {yen(p.fee)}</span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-slate-500 truncate">
                                                {p.method || '—'}{p.note ? `／${p.note}` : ''}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => deletePayment(p.id)}
                                            disabled={deletingId === p.id}
                                            className="flex-shrink-0 p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors"
                                            title="取り消す"
                                            aria-label="入金記録を取り消す"
                                        >
                                            {deletingId === p.id
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <Trash2 className="w-3.5 h-3.5" />}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
