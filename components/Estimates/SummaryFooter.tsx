'use client';

import React from 'react';

interface SummaryFooterProps {
    subtotal: number;
    tax: number;
    total: number;
}

export default function SummaryFooter({ subtotal, tax, total }: SummaryFooterProps) {
    return (
        <div className="bg-gray-50 rounded-lg p-4 space-y-2 md:static sticky bottom-0 z-10 border border-gray-200 md:border-0 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] md:shadow-none">
            <div className="flex justify-between text-sm">
                <span className="text-gray-700">小計:</span>
                <span className="font-semibold">¥{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
                <span className="text-gray-700">消費税(10%):</span>
                <span className="font-semibold">¥{tax.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-lg border-t border-gray-300 pt-2">
                <span className="font-bold text-gray-900">合計:</span>
                <span className="font-bold text-slate-600">¥{total.toLocaleString()}</span>
            </div>
        </div>
    );
}
