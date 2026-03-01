'use client';

import React from 'react';

interface SummaryFooterProps {
    subtotal: number;
    tax: number;
    total: number;
}

export default function SummaryFooter({ subtotal, tax, total }: SummaryFooterProps) {
    return (
        <div className="bg-white px-4 py-1">
            <div className="grid grid-cols-3 gap-0 divide-x divide-gray-200">
                {/* 小計 */}
                <div className="flex flex-col items-start px-4 first:pl-0">
                    <span className="text-xs text-gray-500 mb-0.5">小計</span>
                    <span className="text-base font-semibold text-gray-800">¥{subtotal.toLocaleString()}</span>
                </div>
                {/* 消費税 */}
                <div className="flex flex-col items-start px-4">
                    <span className="text-xs text-gray-500 mb-0.5">消費税</span>
                    <span className="text-base font-semibold text-gray-800">¥{tax.toLocaleString()}</span>
                </div>
                {/* 合計 */}
                <div className="flex flex-col items-start px-4">
                    <span className="text-xs text-gray-500 mb-0.5">合計</span>
                    <span className="text-base font-bold text-slate-700">¥{total.toLocaleString()}</span>
                </div>
            </div>
        </div>
    );
}
