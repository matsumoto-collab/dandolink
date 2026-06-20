'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import type { StockStatus } from '@/lib/materials/stockStatus';
import { stockStatusLabel } from '@/lib/materials/stockStatus';

const STYLE: Record<StockStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
    ok: { cls: 'bg-teal-50 text-teal-700', Icon: CheckCircle2 },
    low: { cls: 'bg-amber-50 text-amber-700', Icon: AlertTriangle },
    shortage: { cls: 'bg-red-50 text-red-700', Icon: AlertCircle },
};

interface StockStatusBadgeProps {
    status: StockStatus;
    className?: string;
}

/**
 * 在庫状態バッジ（十分=ティール / わずか=amber / 要確認=赤）。
 * 在庫一覧の状態列・スマホカードで共通利用する。
 * 出庫伝票の status バッジ（StatusBadge）とは別概念。
 */
export default function StockStatusBadge({ status, className = '' }: StockStatusBadgeProps) {
    const { cls, Icon } = STYLE[status];
    return (
        <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls} ${className}`}
        >
            <Icon className="w-3.5 h-3.5" />
            {stockStatusLabel(status)}
        </span>
    );
}
