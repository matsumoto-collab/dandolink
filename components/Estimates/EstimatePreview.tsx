'use client';

import React from 'react';
import { EstimateItem } from '@/types/estimate';

interface EstimatePreviewProps {
    title: string;
    customerName?: string;
    siteName?: string;
    items: EstimateItem[];
    subtotal: number;
    tax: number;
    total: number;
    notes?: string;
    estimateNumber?: string;
}

export default function EstimatePreview({
    customerName, siteName, items, subtotal, tax, total,
}: EstimatePreviewProps) {
    // Build visible items considering groups and lump sum
    const getVisibleItems = () => {
        const result: { item: EstimateItem; indent: boolean; groupAmount?: number }[] = [];
        for (const item of items) {
            if (item.isGroup) {
                const children = items.filter(i => i.groupId === item.id);
                const groupAmount = children.reduce((sum, c) => sum + c.amount, 0);
                result.push({ item, indent: false, groupAmount });
                if (!item.showAsLumpSum) {
                    for (const child of children) {
                        result.push({ item: child, indent: true });
                    }
                }
            } else if (!item.groupId) {
                result.push({ item, indent: false });
            }
        }
        return result;
    };

    const visibleItems = getVisibleItems();
    const maxRows = 20;

    // Adjustment amount (negative items)
    const adjustmentAmount = items.filter(i => i.amount < 0).reduce((sum, i) => sum + i.amount, 0);

    return (
        <div className="bg-white print:shadow-none" id="estimate-preview">
            {/* Cover Page */}
            <div className="border border-gray-300 p-8 mb-4" style={{ aspectRatio: '297/210', maxWidth: '100%' }}>
                {/* Header */}
                <div className="text-center mb-6">
                    <div className="inline-block border border-black px-8 py-2">
                        <span className="text-2xl tracking-[12px]">御 見 積 書</span>
                    </div>
                </div>

                {/* Customer */}
                <div className="text-center mb-6">
                    <div className="inline-block min-w-[300px]">
                        <p className="text-xl pb-1 border-b border-black">
                            {customerName || '御中'} 様
                        </p>
                        <p className="text-xs text-left mt-1">下記のとおり御見積申し上げます。</p>
                    </div>
                </div>

                {/* Amount */}
                <div className="flex justify-center mb-6">
                    <div className="w-[350px]">
                        <div className="flex border border-black mb-2">
                            <div className="border-r border-black px-4 py-2">
                                <span className="text-sm">御見積金額</span>
                            </div>
                            <div className="flex-1 px-4 py-2 text-right">
                                <span className="text-2xl font-bold">¥{total.toLocaleString()} −</span>
                            </div>
                        </div>
                        <div className="text-right text-xs space-y-0.5">
                            <div className="flex justify-end gap-4">
                                <span>税抜金額</span>
                                <span className="w-28 text-right">¥{subtotal.toLocaleString()} −</span>
                            </div>
                            <div className="flex justify-end gap-4">
                                <span>消費税</span>
                                <span className="w-28 text-right">¥{tax.toLocaleString()} −</span>
                            </div>
                            {adjustmentAmount !== 0 && (
                                <div className="flex justify-end gap-4">
                                    <span>調整額</span>
                                    <span className="w-28 text-right">¥{Math.abs(adjustmentAmount).toLocaleString()} −</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Site info */}
                <div className="text-xs space-y-1 max-w-[45%]">
                    {siteName && (
                        <div className="flex border-b border-gray-300 pb-1">
                            <span className="w-16 shrink-0">現場名称：</span>
                            <span>{siteName}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Details Page */}
            <div className="border border-gray-300 p-6">
                <h3 className="text-center text-lg tracking-[8px] mb-1">内 訳 書</h3>
                <div className="w-24 border-b border-black mx-auto mb-4" />

                <table className="w-full border border-black text-xs">
                    <thead>
                        <tr className="border-b border-black">
                            <th className="border-r border-black px-1 py-1 w-6 text-center"></th>
                            <th className="border-r border-black px-1 py-1 text-center">工事名称</th>
                            <th className="border-r border-black px-1 py-1 w-12 text-center">数量</th>
                            <th className="border-r border-black px-1 py-1 w-8 text-center">単位</th>
                            <th className="border-r border-black px-1 py-1 w-14 text-center">単価</th>
                            <th className="border-r border-black px-1 py-1 w-16 text-center">金額</th>
                            <th className="px-1 py-1 text-center">備考</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: maxRows }, (_, idx) => {
                            const vi = visibleItems[idx];
                            const isGroup = vi?.item.isGroup;
                            const isLumpSum = isGroup && vi?.item.showAsLumpSum;
                            const amount = isGroup ? (vi.groupAmount ?? 0) : (vi?.item.amount ?? null);

                            return (
                                <tr key={idx} className="border-b border-black/50" style={{ minHeight: 18 }}>
                                    <td className="border-r border-black/50 px-1 py-0.5 text-center">{idx + 1}</td>
                                    <td className={`border-r border-black/50 px-1 py-0.5 ${vi?.indent ? 'pl-5' : ''} ${isGroup ? 'font-bold bg-gray-50' : ''} ${vi?.item.amount != null && vi.item.amount < 0 ? 'text-red-600' : ''}`}>
                                        {vi?.item.description || ''}
                                        {isLumpSum && <span className="ml-2 text-gray-500">（一式）</span>}
                                    </td>
                                    <td className="border-r border-black/50 px-1 py-0.5 text-right">
                                        {vi && !vi.item.isGroup && vi.item.quantity > 0 ? vi.item.quantity.toLocaleString() : ''}
                                        {isLumpSum ? '1' : ''}
                                    </td>
                                    <td className="border-r border-black/50 px-1 py-0.5 text-center">
                                        {vi && !vi.item.isGroup ? (vi.item.unit || '') : ''}
                                        {isLumpSum ? '式' : ''}
                                    </td>
                                    <td className="border-r border-black/50 px-1 py-0.5 text-right">
                                        {vi && !vi.item.isGroup && vi.item.unitPrice !== 0 ? vi.item.unitPrice.toLocaleString() : ''}
                                        {isLumpSum && amount !== null ? amount.toLocaleString() : ''}
                                    </td>
                                    <td className={`border-r border-black/50 px-1 py-0.5 text-right ${vi?.item.amount != null && vi.item.amount < 0 ? 'text-red-600' : ''}`}>
                                        {vi && amount !== null ? (
                                            amount < 0 ? `(${Math.abs(amount).toLocaleString()})` : amount.toLocaleString()
                                        ) : ''}
                                    </td>
                                    <td className="px-1 py-0.5">{vi?.item.notes || ''}</td>
                                </tr>
                            );
                        })}
                        {/* Totals */}
                        <tr className="border-b border-black/50">
                            <td colSpan={5} className="border-r border-black/50 px-1 py-0.5 text-right"></td>
                            <td className="border-r border-black/50 px-1 py-0.5 text-right font-medium">{subtotal.toLocaleString()}</td>
                            <td></td>
                        </tr>
                        <tr className="border-b border-black/50">
                            <td colSpan={5} className="border-r border-black/50 px-1 py-0.5 text-right">消費税</td>
                            <td className="border-r border-black/50 px-1 py-0.5 text-right font-medium">{tax.toLocaleString()}</td>
                            <td></td>
                        </tr>
                        <tr>
                            <td colSpan={5} className="border-r border-black/50 px-1 py-0.5 text-right font-bold">合計</td>
                            <td className="border-r border-black/50 px-1 py-0.5 text-right font-bold">{total.toLocaleString()}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
}
