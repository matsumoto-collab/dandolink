'use client';

import React, { useEffect } from 'react';

interface BottomSheetProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title?: string;
}

export default function BottomSheet({ open, onClose, children, title }: BottomSheetProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    return (
        <>
            <div
                onClick={onClose}
                className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
                    open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
                aria-hidden
            />
            <div
                role="dialog"
                aria-modal="true"
                className={`fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl border-t border-slate-200 transition-transform duration-200 ease-out ${
                    open ? 'translate-y-0' : 'translate-y-full'
                }`}
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <div className="w-10 h-1.5 rounded-full bg-slate-300" />
                </div>
                {title && (
                    <div className="px-5 pt-1 pb-3">
                        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                    </div>
                )}
                <div className="px-5 pb-3">{children}</div>
            </div>
        </>
    );
}
