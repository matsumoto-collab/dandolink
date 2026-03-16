'use client';

import React from 'react';
import InvoiceForm from './InvoiceForm';
import { InvoiceInput } from '@/types/invoice';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface InvoiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: InvoiceInput) => Promise<void> | void;
    initialData?: Partial<InvoiceInput>;
}

export default function InvoiceModal({ isOpen, onClose, onSubmit, initialData }: InvoiceModalProps) {
    const modalRef = useModalKeyboard(isOpen, onClose);

    if (!isOpen) return null;

    const handleSubmit = async (data: InvoiceInput) => {
        await onSubmit(data);
    };

    return (
        <div className="fixed inset-0 lg:left-64 z-[70] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ */}
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            {/* モーダルコンテンツ */}
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-6xl lg:mx-4 lg:max-h-[90vh]"
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex items-center justify-between lg:rounded-t-lg">
                    <h2 className="text-xl font-semibold text-slate-900">
                        {initialData ? '請求書編集' : '新規請求書作成'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 md:px-6 py-4 safe-area-bottom">
                    <InvoiceForm
                        initialData={initialData}
                        onSubmit={handleSubmit}
                        onCancel={onClose}
                    />
                </div>
            </div>
        </div>
    );
}
