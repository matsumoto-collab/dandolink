'use client';

import React, { useEffect, useRef, useState } from 'react';
import BottomSheet from '@/components/ui/BottomSheet';
import type { Direction } from '@/stores/siteSurveySlices/types';

const PRESETS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];

const DIRECTION_LABEL: Record<Direction, string> = {
    N: '↑ 上',
    NE: '↗ 右上',
    E: '→ 右',
    SE: '↘ 右下',
    S: '↓ 下',
    SW: '↙ 左下',
    W: '← 左',
    NW: '↖ 左上',
};

interface LengthInputSheetProps {
    open: boolean;
    direction: Direction | null;
    estimatedLengthMm: number;
    closing: boolean;
    onCancel: () => void;
    onConfirm: (lengthMm: number) => void;
}

export default function LengthInputSheet({
    open,
    direction,
    estimatedLengthMm,
    closing,
    onCancel,
    onConfirm,
}: LengthInputSheetProps) {
    const [value, setValue] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setValue('');
        const t = setTimeout(() => inputRef.current?.focus(), 200);
        return () => clearTimeout(t);
    }, [open]);

    const numericValue = Number(value);
    const isValid = !Number.isNaN(numericValue) && numericValue > 0;

    return (
        <BottomSheet open={open} onClose={onCancel}>
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-slate-700">
                    {closing ? '起点に戻って閉じる' : `${DIRECTION_LABEL[direction ?? 'E']} の壁`}
                </div>
                {!closing && estimatedLengthMm > 0 && (
                    <span className="text-xs text-slate-400">
                        推定 {Math.round(estimatedLengthMm)}mm
                    </span>
                )}
            </div>

            <div className="mb-2">
                <input
                    ref={inputRef}
                    type="number"
                    inputMode="numeric"
                    value={value}
                    placeholder="長さ (mm)"
                    onChange={(e) => setValue(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-teal-500 shadow-sm text-sm"
                />
            </div>

            <div className="grid grid-cols-5 gap-1.5 mb-3 mt-2">
                {PRESETS.map((p) => {
                    const active = String(p) === value;
                    return (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setValue(String(p))}
                            className={`py-1.5 rounded-lg text-xs font-medium border transition ${
                                active
                                    ? 'bg-teal-600 text-white border-teal-600'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            {p}
                        </button>
                    );
                })}
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
                >
                    キャンセル
                </button>
                <button
                    type="button"
                    onClick={() => isValid && onConfirm(numericValue)}
                    disabled={!isValid}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-medium shadow-sm disabled:opacity-50"
                >
                    {closing ? '閉じる' : '壁を追加'}
                </button>
            </div>
        </BottomSheet>
    );
}
