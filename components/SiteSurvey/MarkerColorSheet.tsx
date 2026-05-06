'use client';

import React from 'react';
import BottomSheet from './BottomSheet';
import { MARKER_COLORS } from './DrawingCanvas';
import type { MarkerColor } from '@/stores/siteSurveySlices/types';

const COLORS: MarkerColor[] = ['red', 'blue', 'green', 'yellow'];

interface MarkerColorSheetProps {
    open: boolean;
    currentColor: MarkerColor;
    onCancel: () => void;
    onConfirm: (color: MarkerColor) => void;
}

export default function MarkerColorSheet({
    open,
    currentColor,
    onCancel,
    onConfirm,
}: MarkerColorSheetProps) {
    return (
        <BottomSheet open={open} onClose={onCancel}>
            <div className="mb-3">
                <div className="text-sm font-semibold text-slate-700">色を変更</div>
            </div>

            <div className="flex items-center justify-center gap-4 mb-4">
                {COLORS.map((c) => {
                    const active = c === currentColor;
                    return (
                        <button
                            key={c}
                            type="button"
                            onClick={() => onConfirm(c)}
                            aria-label={`色: ${c}`}
                            className={`w-12 h-12 rounded-full border-2 transition ${
                                active
                                    ? 'ring-2 ring-slate-700 scale-110 border-white'
                                    : 'border-white hover:border-slate-300'
                            }`}
                            style={{ backgroundColor: MARKER_COLORS[c] }}
                        />
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
            </div>
        </BottomSheet>
    );
}
