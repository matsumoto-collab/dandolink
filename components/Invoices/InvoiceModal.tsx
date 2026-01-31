'use client';

import React from 'react';
import InvoiceForm from './InvoiceForm';
import { InvoiceInput } from '@/types/invoice';

interface InvoiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: InvoiceInput) => void;
    initialData?: Partial<InvoiceInput>;
}

export default function InvoiceModal({ isOpen, onClose, onSubmit, initialData }: InvoiceModalProps) {
    if (!isOpen) return null;

    const handleSubmit = (data: InvoiceInput) => {
        onSubmit(data);
        onClose();
    };

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex items-center justify-center">
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50"
                onClick={onClose}
            />

            {/* モーダルコンテンツ */}
            <div className="relative bg-white rounded-lg shadow-lg max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                {/* ヘッダー */}
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10 rounded-t-lg">
                    <h2 className="text-xl font-semibold text-gray-900">
                        {initialData ? '請求書編集' : '新規請求書作成'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="px-6 py-4">
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
