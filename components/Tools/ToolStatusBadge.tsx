'use client';

import { ToolStatus, TOOL_STATUS_LABELS } from '@/types/tool';

// 状態の色（保存=ティール/削除=赤 のセマンティックとは別軸で、工具の所在を表す）
const STATUS_STYLES: Record<ToolStatus, string> = {
    in_stock: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    checked_out: 'bg-blue-50 text-blue-700 border-blue-200',
    repairing: 'bg-amber-50 text-amber-700 border-amber-200',
    lost: 'bg-red-50 text-red-700 border-red-200',
    disposed: 'bg-slate-100 text-slate-400 border-slate-200',
};

interface ToolStatusBadgeProps {
    status: ToolStatus;
    className?: string;
}

export default function ToolStatusBadge({ status, className = '' }: ToolStatusBadgeProps) {
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border whitespace-nowrap ${STATUS_STYLES[status]} ${className}`}
        >
            {TOOL_STATUS_LABELS[status]}
        </span>
    );
}
