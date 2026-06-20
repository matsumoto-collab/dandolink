'use client';

import React from 'react';
import type { StockStatus } from '@/lib/materials/stockStatus';
import { stockRatioPercent } from '@/lib/materials/stockStatus';

interface StockBarProps {
    /** 倉庫在庫 */
    stock: number;
    /** 所有総数（stock + 貸出中） */
    total: number;
    status: StockStatus;
    /** 右側にパーセント表示を出すか */
    showPercent?: boolean;
    className?: string;
}

/**
 * 在庫稼働バー。所有総数を全幅とし、倉庫在庫の割合をティール、
 * 現場へ出ている割合をグレーで表す。'わずか'=amber / '要確認'=赤。
 */
export default function StockBar({ stock, total, status, showPercent = true, className = '' }: StockBarProps) {
    const pct = stockRatioPercent(stock, total);
    const inColor = status === 'shortage' ? 'bg-red-500' : status === 'low' ? 'bg-amber-500' : 'bg-teal-600';

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div className="flex-1 min-w-[90px] h-2.5 rounded-md bg-slate-100 overflow-hidden flex">
                <div className={inColor} style={{ width: `${pct}%` }} />
                <div className="bg-slate-300" style={{ width: `${100 - pct}%` }} />
            </div>
            {showPercent && (
                <span className="text-xs text-slate-500 tabular-nums w-9 text-right">{pct}%</span>
            )}
        </div>
    );
}
