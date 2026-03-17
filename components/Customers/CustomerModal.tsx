'use client';

import React from 'react';
import { Customer, CustomerInput } from '@/types/customer';
import { X } from 'lucide-react';
import CustomerForm from './CustomerForm';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface CustomerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: CustomerInput) => void;
    initialData?: Partial<Customer>;
    title?: string;
}

export default function CustomerModal({
    isOpen,
    onClose,
    onSubmit,
    initialData,
    title = '顧客登録',
}: CustomerModalProps) {
    const modalRef = useModalKeyboard(isOpen, onClose);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 z-[70] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black/50 hidden lg:block" onClick={onClose} />
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:max-h-[90vh]">
                {/* ヘッダー */}
                <div className="flex-shrink-0 bg-slate-800 text-white px-6 py-4 flex items-center justify-between lg:rounded-t-lg">
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-md transition-colors duration-150"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* フォーム */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                    <CustomerForm
                        initialData={initialData}
                        onSubmit={onSubmit}
                        onCancel={onClose}
                    />
                </div>
            </div>
        </div>
    );
}
