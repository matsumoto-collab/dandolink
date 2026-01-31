'use client';

import React from 'react';
import { Customer, CustomerInput } from '@/types/customer';
import { X } from 'lucide-react';
import CustomerForm from './CustomerForm';

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
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 bg-black/50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* ヘッダー */}
                <div className="sticky top-0 bg-slate-800 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-md transition-colors duration-150"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* フォーム */}
                <div className="p-6">
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
