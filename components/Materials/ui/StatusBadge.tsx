'use client';

import React from 'react';

/** 材料管理で扱う状態（出庫伝票の status ＋ 未回収） */
export type MaterialStatus = 'draft' | 'confirmed' | 'loaded' | 'unreturned' | string;

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    draft: { label: '下書き', cls: 'bg-slate-100 text-slate-600' },
    confirmed: { label: '確定', cls: 'bg-blue-100 text-blue-700' },
    loaded: { label: '積込完了', cls: 'bg-green-100 text-green-700' },
    unreturned: { label: '未回収', cls: 'bg-amber-100 text-amber-700' },
};

interface StatusBadgeProps {
    status: MaterialStatus;
    /** 明示ラベル上書き（任意） */
    label?: string;
    className?: string;
}

/**
 * 状態バッジ（色＋文字）。
 * 下書き=灰 / 確定=青 / 積込完了=緑 / 未回収=橙。材料管理の各画面で共通利用する。
 */
export default function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
    const info = STATUS_MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600' };
    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${info.cls} ${className}`}>
            {label ?? info.label}
        </span>
    );
}
