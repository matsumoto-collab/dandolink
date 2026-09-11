'use client';

import React from 'react';
import {
    VALUE_ADDED_JUDGEMENT_LABELS,
    type ValueAddedJudgement,
    type ValueAddedResult,
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

/** 算出できない案件に出す短い理由（一覧の列は幅が狭いので詰めた表記にする） */
function shortReason(data: ValueAddedResult): string {
    if (data.flags.includes('no_sales')) return '未請求';
    if (data.flags.includes('no_cost')) return '原価未入力';
    if (data.flags.includes('no_manday')) return '人工なし';
    return '—';
}

/** 案件一覧の「人工あたり加工高」列 */
export function ValueAddedCell({ data, loading }: { data?: ValueAddedResult; loading?: boolean }) {
    if (!data) {
        return <span className="text-slate-300 text-sm">{loading ? '…' : '—'}</span>;
    }
    if (!data.available) {
        return <span className="text-xs text-slate-400">{shortReason(data)}</span>;
    }
    return (
        <span className="inline-flex items-center justify-end gap-1.5">
            <ValueAddedDot judgement={data.judgement} />
            <span className={`text-sm tabular-nums ${data.tentative ? 'text-slate-400' : 'text-slate-800'}`}>
                {data.perManday !== null ? data.perManday.toLocaleString('ja-JP') : '—'}
            </span>
            {data.outsourcingHeavy && (
                <span
                    className="text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200"
                    title="外注中心（判定は人件費1円あたりの稼ぎで付けています）"
                >
                    外
                </span>
            )}
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
