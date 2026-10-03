'use client';

/**
 * 「評価ポイント」の画面のモーダルの入れ物（明細・確認待ち・記録を足す で共通）。
 * スマホでは全画面、PC ではサイドバーの右に中央寄せ（EstimateDetailModal と同じ置き方）。
 */
import React from 'react';
import { X } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    /** PC での幅（Tailwind の max-w-*） */
    widthClass?: string;
    children: React.ReactNode;
}

export default function EvaluationPointModal({ isOpen, onClose, title, subtitle, widthClass = 'lg:max-w-4xl', children }: Props) {
    const modalRef = useModalKeyboard(isOpen, onClose);
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                className={`relative bg-white flex flex-col w-full h-full lg:h-auto lg:max-h-[90vh] lg:rounded-lg lg:shadow-xl lg:mx-4 focus:outline-none ${widthClass}`}
            >
                <div className="flex-shrink-0 border-b border-slate-200 px-4 md:px-6 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-slate-800 break-words">{title}</h2>
                        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        title="閉じる"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto px-4 md:px-6 py-4">{children}</div>
            </div>
        </div>
    );
}
