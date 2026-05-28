'use client';

import React, { useEffect, useState } from 'react';
import BottomSheet from '@/components/ui/BottomSheet';

const WIDTH_PRESETS = [800, 1800, 2400, 3600, 5400];

interface OpeningInputSheetProps {
    open: boolean;
    mode: 'new' | 'edit';
    wallLengthMm: number;
    initialDistanceFromStart: number;
    initialWidth: number;
    onCancel: () => void;
    onConfirm: (distanceFromStart: number, width: number) => void;
    onDelete?: () => void;
}

export default function OpeningInputSheet({
    open,
    mode,
    wallLengthMm,
    initialDistanceFromStart,
    initialWidth,
    onCancel,
    onConfirm,
    onDelete,
}: OpeningInputSheetProps) {
    const [distance, setDistance] = useState<string>('');
    const [width, setWidth] = useState<string>('');

    useEffect(() => {
        if (open) {
            setDistance(String(Math.round(initialDistanceFromStart)));
            setWidth(String(Math.round(initialWidth)));
        }
    }, [open, initialDistanceFromStart, initialWidth]);

    const distanceNum = Number(distance);
    const widthNum = Number(width);
    const distanceValid = !Number.isNaN(distanceNum) && distanceNum >= 0;
    const widthValid = !Number.isNaN(widthNum) && widthNum > 0;
    const fitsInWall = distanceValid && widthValid && distanceNum + widthNum <= wallLengthMm;
    const isValid = distanceValid && widthValid && fitsInWall;

    const errorMessage = (() => {
        if (!distanceValid) return '距離は 0 以上を入力してください';
        if (!widthValid) return '幅は 0 より大きい値を入力してください';
        if (!fitsInWall) return `距離 + 幅が壁の長さ ${Math.round(wallLengthMm)} mm を超えています`;
        return null;
    })();

    const handleDelete = () => {
        if (!onDelete) return;
        if (!confirm('この開口を削除しますか？')) return;
        onDelete();
    };

    return (
        <BottomSheet open={open} onClose={onCancel}>
            <div className="mb-2">
                <div className="text-sm font-semibold text-slate-700">
                    {mode === 'edit' ? '開口を編集' : '開口を追加'}
                </div>
                <div className="text-xs text-slate-400">
                    対象壁の長さ: {Math.round(wallLengthMm)} mm
                </div>
            </div>

            <div className="mb-2">
                <label className="block text-xs text-slate-500 mb-1">壁端からの距離 (mm)</label>
                <input
                    type="number"
                    inputMode="numeric"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-red-500 shadow-sm text-sm"
                />
            </div>

            <div className="mb-2">
                <label className="block text-xs text-slate-500 mb-1">開口幅 (mm)</label>
                <input
                    type="number"
                    inputMode="numeric"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-red-500 shadow-sm text-sm"
                />
                <div className="grid grid-cols-5 gap-1.5 mt-2">
                    {WIDTH_PRESETS.map((p) => {
                        const active = String(p) === width;
                        return (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setWidth(String(p))}
                                className={`py-1.5 rounded-lg text-xs font-medium border transition ${
                                    active
                                        ? 'bg-red-600 text-white border-red-600'
                                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                }`}
                            >
                                {p}
                            </button>
                        );
                    })}
                </div>
            </div>

            {errorMessage && (
                <div className="mb-2 text-xs text-red-600">{errorMessage}</div>
            )}

            <div className="flex gap-2">
                {mode === 'edit' && onDelete && (
                    <button
                        type="button"
                        onClick={handleDelete}
                        className="px-4 py-2 rounded-xl border border-red-200 text-red-600 font-medium hover:bg-red-50"
                    >
                        削除
                    </button>
                )}
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
                >
                    キャンセル
                </button>
                <button
                    type="button"
                    onClick={() => isValid && onConfirm(distanceNum, widthNum)}
                    disabled={!isValid}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-medium shadow-sm disabled:opacity-50"
                >
                    保存
                </button>
            </div>
        </BottomSheet>
    );
}
