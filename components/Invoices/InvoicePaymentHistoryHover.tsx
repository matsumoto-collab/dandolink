'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { InvoicePaymentRecord, PaymentSummary } from '@/lib/invoicePayments';
import { formatYen as yen, formatPaidDate as fmtDate } from '@/lib/invoicePayments';

const TOOLTIP_W = 300;
const MARGIN = 8;
const SHOW_DELAY_MS = 200;
/** 履歴の最大表示行数（超過分は「他N件」表記。全件はクリックで開くポップオーバーで確認） */
const MAX_ROWS = 8;

interface InvoicePaymentHistoryHoverProps {
    /** 一覧APIが付与した入金履歴（入金日昇順） */
    payments?: InvoicePaymentRecord[];
    /** 入金サマリ（合計・legacyPaid 判定に使用） */
    summary?: PaymentSummary;
    children: ReactNode;
    className?: string;
}

/**
 * 請求書一覧の「入金状況」バッジをマウスホバーすると入金履歴を表示するラッパー。
 * クリック（クイック入金ポップオーバー）とは独立した閲覧専用の動線。
 * <main> が position:fixed でスタッキングコンテキストを作る＋テーブルの overflow
 * クリップを回避するため、ツールチップは Portal で body 直下に fixed 描画する。
 * 入金記録が無い請求書（未入金）では何も表示しない。
 */
export default function InvoicePaymentHistoryHover({
    payments,
    summary,
    children,
    className = '',
}: InvoicePaymentHistoryHoverProps) {
    const [style, setStyle] = useState<CSSProperties | null>(null);
    const wrapRef = useRef<HTMLSpanElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const records = payments ?? [];
    const hasContent = records.length > 0 || !!summary?.legacyPaid;

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const handleEnter = () => {
        if (!hasContent) return;
        clearTimer();
        timerRef.current = setTimeout(() => {
            const rect = wrapRef.current?.getBoundingClientRect();
            if (!rect) return;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const left = Math.max(MARGIN, Math.min(rect.left, vw - TOOLTIP_W - MARGIN));
            // おおよその高さで上下どちらに出すか決める（行 30px＋ヘッダー/フッター 70px）
            const estHeight = Math.min(records.length, MAX_ROWS) * 30 + 70;
            const spaceBelow = vh - rect.bottom - MARGIN;
            if (spaceBelow >= estHeight || spaceBelow >= rect.top - MARGIN) {
                setStyle({ top: rect.bottom + 6, left });
            } else {
                setStyle({ bottom: vh - rect.top + 6, left });
            }
        }, SHOW_DELAY_MS);
    };

    const handleLeave = () => {
        clearTimer();
        setStyle(null);
    };

    // スクロールでアンカー位置がずれたら閉じる（テーブル内スクロールも capture で拾う）
    useEffect(() => {
        if (!style) return;
        const onScroll = () => setStyle(null);
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        return () => window.removeEventListener('scroll', onScroll, { capture: true });
    }, [style]);

    useEffect(() => clearTimer, []);

    const visible = records.slice(0, MAX_ROWS);
    const overflow = records.length - visible.length;

    return (
        <span
            ref={wrapRef}
            className={`inline-flex ${className}`}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            // クリックはクイック入金ポップオーバーが開くのでツールチップは引っ込める
            onClickCapture={handleLeave}
        >
            {children}
            {style && hasContent && createPortal(
                <div
                    className="fixed z-[60] pointer-events-none bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
                    style={{ ...style, width: TOOLTIP_W }}
                    role="tooltip"
                >
                    <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] font-semibold text-slate-600">
                        入金履歴{records.length > 0 && `（${records.length}件）`}
                    </div>
                    {records.length === 0 ? (
                        // legacyPaid: 入金記録なしで status='paid' の旧データ
                        <div className="px-3 py-2 text-[11px] text-slate-500">
                            旧データ：入金記録なしで支払済み
                        </div>
                    ) : (
                        <>
                            <ul className="divide-y divide-slate-100">
                                {visible.map((p) => (
                                    <li key={p.id} className="px-3 py-1.5 flex items-baseline justify-between gap-2">
                                        <div className="min-w-0">
                                            <span className="text-xs font-medium text-slate-800 whitespace-nowrap">
                                                {fmtDate(p.paidDate)}
                                            </span>
                                            <span className="ml-1.5 text-[11px] text-slate-500">
                                                {p.method || '—'}{p.note ? `／${p.note}` : ''}
                                            </span>
                                        </div>
                                        <div className="flex-shrink-0 text-right">
                                            <span className="text-xs font-semibold text-slate-800">{yen(p.amount)}</span>
                                            {p.fee > 0 && (
                                                <span className="ml-1 text-[10px] text-slate-400 whitespace-nowrap">手数料 {yen(p.fee)}</span>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            {overflow > 0 && (
                                <div className="px-3 py-1 text-[11px] text-slate-400">…他{overflow}件（クリックで全件表示）</div>
                            )}
                            {summary && (
                                <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-600 flex flex-wrap gap-x-3">
                                    <span>入金済 <span className="font-semibold text-slate-800">{yen(summary.paidAmount)}</span></span>
                                    {summary.feeAmount > 0 && (
                                        <span>手数料 <span className="font-semibold text-slate-800">{yen(summary.feeAmount)}</span></span>
                                    )}
                                    <span>残 <span className={`font-bold ${summary.remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>{yen(summary.remaining)}</span></span>
                                </div>
                            )}
                        </>
                    )}
                </div>,
                document.body
            )}
        </span>
    );
}
