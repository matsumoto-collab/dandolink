'use client';

import React from 'react';
import { daysUntil, expiryStatus } from '@/lib/equipment';
import { fmtDate } from './types';

const STYLES: Record<string, string> = {
    expired: 'bg-red-50 text-red-700 border-red-200',
    danger: 'bg-orange-50 text-orange-700 border-orange-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    ok: 'bg-slate-50 text-slate-600 border-slate-200',
    none: 'bg-slate-50 text-slate-400 border-slate-200',
};

/**
 * 車検・保険などの満了日を、残り日数で色分けして表示する。
 * 通知は出さず画面の色分けだけで気づける形にする（kei決定 2026-09-01）。
 */
export function ExpiryBadge({ date, label }: { date: string | null | undefined; label?: string }) {
    const status = expiryStatus(date);
    const days = daysUntil(date);
    const note =
        status === 'none'
            ? '未登録'
            : status === 'expired'
              ? `期限切れ（${Math.abs(days ?? 0)}日経過）`
              : days === 0
                ? '本日まで'
                : `あと${days}日`;

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${STYLES[status]}`}>
            {label && <span className="font-medium">{label}</span>}
            <span>{fmtDate(date)}</span>
            <span className="opacity-80">{note}</span>
        </span>
    );
}
