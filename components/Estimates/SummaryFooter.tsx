'use client';

import React, { useState, useMemo } from 'react';

interface SummaryFooterProps {
    subtotal: number;
    tax: number;
    total: number;
    onAdjustSubtotal?: (targetAmount: number) => void;
}

type AdjustMode = 'target' | 'rate';

export default function SummaryFooter({ subtotal, tax, total, onAdjustSubtotal }: SummaryFooterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<AdjustMode>('target');
    const [targetInput, setTargetInput] = useState('');
    const [rateInput, setRateInput] = useState('');

    const { targetAmount, discount } = useMemo(() => {
        if (mode === 'target') {
            const target = parseInt(targetInput.replace(/,/g, ''), 10);
            if (isNaN(target) || target < 0) return { targetAmount: 0, discount: 0 };
            return { targetAmount: target, discount: subtotal - target };
        } else {
            const rate = parseFloat(rateInput);
            if (isNaN(rate) || rate <= 0 || rate > 100) return { targetAmount: 0, discount: 0 };
            const disc = Math.floor(subtotal * rate / 100);
            return { targetAmount: subtotal - disc, discount: disc };
        }
    }, [mode, targetInput, rateInput, subtotal]);

    const isValid = discount > 0 && targetAmount >= 0;

    const handleApply = () => {
        if (!isValid || !onAdjustSubtotal) return;
        onAdjustSubtotal(targetAmount);
        setIsOpen(false);
        setTargetInput('');
        setRateInput('');
    };

    const handleCancel = () => {
        setIsOpen(false);
        setTargetInput('');
        setRateInput('');
    };

    return (
        <div className="bg-white px-4 py-1">
            <div className="grid grid-cols-3 gap-0 divide-x divide-slate-200">
                {/* 小計 */}
                <div className="flex flex-col items-start px-4 first:pl-0">
                    <span className="text-xs text-slate-500 mb-0.5">小計</span>
                    <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-slate-800">¥{subtotal.toLocaleString()}</span>
                        {onAdjustSubtotal && (
                            <button
                                type="button"
                                onClick={() => setIsOpen(!isOpen)}
                                className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl px-2 py-0.5 transition-all duration-150"
                            >
                                金額調整
                            </button>
                        )}
                    </div>
                </div>
                {/* 消費税 */}
                <div className="flex flex-col items-start px-4">
                    <span className="text-xs text-slate-500 mb-0.5">消費税</span>
                    <span className="text-base font-semibold text-slate-800">¥{tax.toLocaleString()}</span>
                </div>
                {/* 合計 */}
                <div className="flex flex-col items-start px-4">
                    <span className="text-xs text-slate-500 mb-0.5">合計</span>
                    <span className="text-base font-bold text-slate-700">¥{total.toLocaleString()}</span>
                </div>
            </div>

            {/* 金額調整パネル */}
            <div
                className={`transition-all duration-150 overflow-hidden ${
                    isOpen ? 'max-h-60 opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
                }`}
            >
                <div className="border border-slate-200 rounded-xl p-4">
                    {/* モード切替 */}
                    <div className="flex gap-2 mb-3">
                        <button
                            type="button"
                            onClick={() => setMode('target')}
                            className={`text-sm px-3 py-1 rounded-xl transition-all duration-150 ${
                                mode === 'target'
                                    ? 'bg-slate-800 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            目標金額
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('rate')}
                            className={`text-sm px-3 py-1 rounded-xl transition-all duration-150 ${
                                mode === 'rate'
                                    ? 'bg-slate-800 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            割引率
                        </button>
                    </div>

                    {/* 入力 */}
                    {mode === 'target' ? (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-500">¥</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={targetInput}
                                onChange={(e) => setTargetInput(e.target.value.replace(/[^0-9,]/g, ''))}
                                placeholder={subtotal.toLocaleString()}
                                className="flex-1 text-base py-2.5 px-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm outline-none"
                            />
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                inputMode="decimal"
                                value={rateInput}
                                onChange={(e) => setRateInput(e.target.value.replace(/[^0-9.]/g, ''))}
                                placeholder="5"
                                className="flex-1 text-base py-2.5 px-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm outline-none"
                            />
                            <span className="text-sm text-slate-500">%</span>
                        </div>
                    )}

                    {/* プレビュー */}
                    {isValid && (
                        <p className="text-sm text-red-600 mt-2">
                            値引き: -¥{discount.toLocaleString()}
                        </p>
                    )}

                    {/* ボタン */}
                    <div className="flex items-center justify-end gap-3 mt-3">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="text-sm text-slate-500 hover:text-slate-700 transition-all duration-150"
                        >
                            閉じる
                        </button>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={!isValid}
                            className="text-sm px-4 py-1.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                        >
                            適用
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
