'use client';

/**
 * グラフの部品（枠・凡例・吹き出し）。利益ダッシュボード・自社班の出来高・利益サマリーで共通。
 * 文字は色を持たせない（slate の文字色）。色は横に置く四角や線で示す。
 */
import React from 'react';

export function ChartCard({
    title,
    description,
    action,
    children,
    className = '',
}: {
    title: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-w-0 ${className}`}>
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
                    {description && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

export interface ChartLegendItem {
    key: string;
    label: string;
    color: string;
    /** 棒・面は四角、線グラフは線 */
    shape?: 'square' | 'line';
}

export function ChartLegend({ items, className = '' }: { items: ChartLegendItem[]; className?: string }) {
    return (
        <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 ${className}`}>
            {items.map((item) => (
                <li key={item.key} className="inline-flex items-center gap-1.5">
                    {item.shape === 'line' ? (
                        <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ backgroundColor: item.color }} />
                    ) : (
                        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                    )}
                    {item.label}
                </li>
            ))}
        </ul>
    );
}

export interface ChartTooltipRow {
    key: string;
    label: string;
    value: string;
    /** 系列の色（線で示す）。合計などには付けない */
    color?: string;
    tone?: 'default' | 'negative' | 'muted';
}

/** 吹き出しの中身。数字を太く、名前を控えめに */
export function ChartTooltipBox({ title, rows, note }: { title: string; rows: ChartTooltipRow[]; note?: string }) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[180px] max-w-[300px]">
            <p className="font-medium text-slate-700 mb-1 break-words">{title}</p>
            {rows.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-4 py-0.5">
                    <span className="inline-flex items-center gap-1.5 text-slate-500 whitespace-nowrap">
                        {row.color && (
                            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: row.color }} />
                        )}
                        {row.label}
                    </span>
                    <span
                        className={`font-semibold tabular-nums whitespace-nowrap ${
                            row.tone === 'negative' ? 'text-red-600' : row.tone === 'muted' ? 'text-slate-400' : 'text-slate-800'
                        }`}
                    >
                        {row.value}
                    </span>
                </div>
            ))}
            {note && <p className="mt-1 text-[11px] text-slate-400 leading-snug">{note}</p>}
        </div>
    );
}
