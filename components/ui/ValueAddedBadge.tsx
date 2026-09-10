'use client';

import React from 'react';
import {
    VALUE_ADDED_JUDGEMENT_LABELS,
    type ValueAddedJudgement,
} from '@/lib/valueAdded';

const JUDGEMENT_STYLES: Record<ValueAddedJudgement, { chip: string; dot: string }> = {
    good: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
    warning: { chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
    bad: { chip: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
    unknown: { chip: 'bg-slate-50 text-slate-500 border-slate-200', dot: 'bg-slate-300' },
};

/** 判定色のドットだけ（案件一覧の列など、幅の狭いところ用） */
export function ValueAddedDot({ judgement }: { judgement: ValueAddedJudgement }) {
    return (
        <span
            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${JUDGEMENT_STYLES[judgement].dot}`}
            title={VALUE_ADDED_JUDGEMENT_LABELS[judgement]}
            aria-label={VALUE_ADDED_JUDGEMENT_LABELS[judgement]}
        />
    );
}

/** 判定バッジ（●良好 / ●注意 / ●要改善） */
export function ValueAddedJudgementBadge({
    judgement,
    size = 'md',
}: {
    judgement: ValueAddedJudgement;
    size?: 'sm' | 'md';
}) {
    if (judgement === 'unknown') return null;
    const style = JUDGEMENT_STYLES[judgement];
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${style.chip} ${
                size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
            }`}
        >
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {VALUE_ADDED_JUDGEMENT_LABELS[judgement]}
        </span>
    );
}

/** 信頼度フラグのバッジ（外注中心 / 請求不足の可能性 / 手動入力 など） */
export function ValueAddedFlagBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warn' }) {
    return (
        <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                tone === 'warn'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
        >
            {label}
        </span>
    );
}
