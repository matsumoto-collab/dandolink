'use client';

import React from 'react';
import EstimateForm from './EstimateForm';
import { EstimateInput } from '@/types/estimate';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface EstimateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: EstimateInput) => Promise<void> | void;
    initialData?: Partial<EstimateInput>;
}

export default function EstimateModal({ isOpen, onClose, onSubmit, initialData }: EstimateModalProps) {
    const modalRef = useModalKeyboard(isOpen, onClose);

    if (!isOpen) return null;

    const handleSubmit = async (data: EstimateInput) => {
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
                <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 md:px-6 py-4 flex items-center justify-between lg:rounded-t-lg">
                    <h2 className="text-xl font-semibold text-gray-900">
                        {initialData ? '見積書編集' : '新規見積書作成'}
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
                <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 safe-area-bottom">
                    <EstimateForm
                        initialData={initialData}
                        onSubmit={handleSubmit}
                        onCancel={onClose}
                    />
                </div>
            </div>
        </div>
    );
}
