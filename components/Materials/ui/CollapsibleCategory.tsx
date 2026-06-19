'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

interface CollapsibleCategoryProps {
    name: string;
    /** 見出し右に出す品目数 */
    itemCount?: number;
    /** 見出し右に出す合計（在庫合計など）。閉じている時のみ等で使う */
    totalLabel?: string;
    isExpanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    className?: string;
}

/**
 * 折りたたみカテゴリ見出し（シェブロン＋名称＋品目数・合計）。
 * 100〜150 品目を捌くための共通部品。タップで開閉する。
 */
export default function CollapsibleCategory({
    name,
    itemCount,
    totalLabel,
    isExpanded,
    onToggle,
    children,
    className = '',
}: CollapsibleCategoryProps) {
    return (
        <div className={`border border-slate-200 rounded-xl overflow-hidden ${className}`}>
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors select-none"
            >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    {name}
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-400">
                    {itemCount !== undefined && <span>{itemCount}品目</span>}
                    {totalLabel && <span>・ {totalLabel}</span>}
                </span>
            </button>
            {isExpanded && <div className="divide-y divide-slate-100">{children}</div>}
        </div>
    );
}
