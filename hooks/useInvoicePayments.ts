'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type { InvoicePaymentRecord, PaymentSummary } from '@/lib/invoicePayments';
import { logger } from '@/lib/logger';

/** 入金登録フォームの入力値（API POST ボディと同形） */
export interface InvoicePaymentFormInput {
    paidDate: string;        // YYYY-MM-DD
    amount: number;
    fee: number;
    method: string | null;
    note: string | null;
}

interface UseInvoicePaymentsOptions {
    invoiceId: string;
    /** 一覧が持っている入金サマリ。取得完了までの初期表示に使う（任意） */
    initialSummary?: PaymentSummary;
    /** サマリが更新されたら親（詳細モーダル等）へ通知 */
    onSummaryChange?: (summary: PaymentSummary) => void;
    /** 入金の登録／取消が確定したら親（一覧）へ通知＝一覧を再取得させる */
    onChanged?: () => void;
}

/**
 * 1 請求書の入金記録の取得・登録・取消をまとめたフック。
 * 詳細モーダルの InvoicePaymentsPanel と一覧のクイック入金ポップオーバーで共用する。
 * サーバー（/api/invoices/[id]/payments）が唯一の真実で、登録／取消のたびに
 * 最新の payments＋summary を受け取って状態を更新する。
 */
export function useInvoicePayments({
    invoiceId,
    initialSummary,
    onSummaryChange,
    onChanged,
}: UseInvoicePaymentsOptions) {
    const [payments, setPayments] = useState<InvoicePaymentRecord[]>([]);
    const [summary, setSummary] = useState<PaymentSummary | undefined>(initialSummary);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // 親コールバックは ref 経由で参照し、取得エフェクトの依存に入れない
    // （毎レンダリング新しい関数が渡っても再取得ループにならないようにする）
    const onSummaryChangeRef = useRef(onSummaryChange);
    const onChangedRef = useRef(onChanged);
    useEffect(() => { onSummaryChangeRef.current = onSummaryChange; }, [onSummaryChange]);
    useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

    const applyResult = useCallback((data: { payments?: InvoicePaymentRecord[]; summary?: PaymentSummary | null }) => {
        setPayments(data.payments ?? []);
        if (data.summary) {
            setSummary(data.summary);
            onSummaryChangeRef.current?.(data.summary);
        }
    }, []);

    // 入金一覧の取得（請求書が変わったときのみ）
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const res = await fetch(`/api/invoices/${invoiceId}/payments`, { cache: 'no-store' });
                if (!res.ok) throw new Error('入金記録の取得に失敗しました');
                const data = await res.json();
                if (cancelled) return;
                setPayments(data.payments ?? []);
                if (data.summary) {
                    setSummary(data.summary);
                    onSummaryChangeRef.current?.(data.summary);
                }
            } catch (e) {
                logger.error('入金記録の取得に失敗:', e);
                if (!cancelled) toast.error('入金記録の取得に失敗しました');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [invoiceId]);

    /**
     * 入金を1件登録する。成功時は登録後の最新サマリを返す（呼び出し側が残額で
     * 「続けて登録するか閉じるか」を分岐できる）。失敗時は null。
     * フォームのリセットは呼び出し側で行う。
     */
    const addPayment = useCallback(async (input: InvoicePaymentFormInput): Promise<PaymentSummary | null> => {
        if (input.amount + input.fee <= 0) {
            toast.error('入金額または手数料を入力してください');
            return null;
        }
        if (!input.paidDate) {
            toast.error('入金日を入力してください');
            return null;
        }
        setSubmitting(true);
        try {
            const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || '入金の登録に失敗しました');
            }
            const data = await res.json();
            applyResult(data);
            toast.success('入金を登録しました');
            onChangedRef.current?.();
            return data.summary ?? null;
        } catch (e) {
            logger.error('入金の登録に失敗:', e);
            toast.error(e instanceof Error ? e.message : '入金の登録に失敗しました');
            return null;
        } finally {
            setSubmitting(false);
        }
    }, [invoiceId, applyResult]);

    /** 入金記録を1件取り消す（確認ダイアログ込み）。成功時 true */
    const deletePayment = useCallback(async (paymentId: string): Promise<boolean> => {
        if (!confirm('この入金記録を取り消しますか？')) return false;
        setDeletingId(paymentId);
        try {
            const res = await fetch(`/api/invoices/${invoiceId}/payments/${paymentId}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || '入金記録の取消に失敗しました');
            }
            applyResult(await res.json());
            toast.success('入金記録を取り消しました');
            onChangedRef.current?.();
            return true;
        } catch (e) {
            logger.error('入金記録の取消に失敗:', e);
            toast.error(e instanceof Error ? e.message : '入金記録の取消に失敗しました');
            return false;
        } finally {
            setDeletingId(null);
        }
    }, [invoiceId, applyResult]);

    return { payments, summary, loading, submitting, deletingId, addPayment, deletePayment };
}
