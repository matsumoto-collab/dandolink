'use client';

import React from 'react';
import { Minus, Plus } from 'lucide-react';

interface QtyStepperProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    /** スマホで指で押せる 44px 基準（タッチ前提）。false で従来の 28px */
    large?: boolean;
    className?: string;
}

/**
 * 数量入力の標準部品（− ／ ＋ ステッパー）。
 * 横並びの極小入力欄の代替。材料管理の各画面で共通利用する。
 */
export default function QtyStepper({
    value,
    onChange,
    min = 0,
    max,
    step = 1,
    large = false,
    className = '',
}: QtyStepperProps) {
    const clamp = (v: number) => {
        let next = v;
        if (next < min) next = min;
        if (max !== undefined && next > max) next = max;
        return next;
    };
    const btn = large ? 'w-10 h-10' : 'w-7 h-7';
    const input = large ? 'w-16 h-10 text-base' : 'w-14 py-1 text-sm';

    return (
        <div className={`flex items-center gap-1.5 ${className}`}>
            <button
                type="button"
                onClick={() => onChange(clamp(value - step))}
                className={`${btn} flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200`}
                aria-label="減らす"
            >
                <Minus className="w-3.5 h-3.5" />
            </button>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(clamp(parseInt(e.target.value) || 0))}
                className={`${input} text-center border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 shadow-sm`}
            />
            <button
                type="button"
                onClick={() => onChange(clamp(value + step))}
                className={`${btn} flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200`}
                aria-label="増やす"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}
