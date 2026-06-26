'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface SearchableSelectOption {
    id: string;
    label: string;
    /** 任意。色サンプル（工事種別など）を選択肢の左に表示したいとき */
    color?: string;
    /** 任意。ラベルに加えて検索対象にしたい語（職長名・別名など）。表示はされず検索のみに使う */
    keywords?: string;
}

interface SearchableSelectProps {
    options: SearchableSelectOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** 「未設定」相当の選択肢を出すか（'' を選んで onChange('') を呼ぶ）。デフォルト true */
    allowEmpty?: boolean;
    emptyLabel?: string;
    /** 検索を強制的に表示／非表示にする。省略時は options.length >= 6 で自動表示 */
    searchable?: boolean;
    /** 'sm' = 縦詰め(各行で使うため)。'md' = 標準。デフォルト 'md' */
    size?: 'sm' | 'md';
    className?: string;
    disabled?: boolean;
    /** ボタン部分の最小幅。デフォルト '0' (親の幅に従う) */
    minWidth?: string;
}

/**
 * 検索付きコンボボックス。選択肢が増えても入力で素早く絞り込める。
 * - 6 件以上で自動的に検索ボックスを表示（searchable で明示制御可）
 * - 矢印キー / Enter / Escape のキーボード操作対応
 * - color プロパティで色サンプル表示（工事種別の識別補助）
 */
export default function SearchableSelect({
    options,
    value,
    onChange,
    placeholder = '選択',
    allowEmpty = true,
    emptyLabel = '未設定',
    searchable,
    size = 'md',
    className = '',
    disabled = false,
    minWidth,
}: SearchableSelectProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const showSearch = searchable ?? options.length >= 6;
    const selected = options.find((o) => o.id === value) ?? null;

    // 外側クリックで閉じる
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // 開いた瞬間に検索 input を focus + クエリ初期化
    useEffect(() => {
        if (open) {
            setQuery('');
            setHighlight(0);
            if (showSearch) {
                // 次の描画フレームで focus（要素出現後）
                requestAnimationFrame(() => searchInputRef.current?.focus());
            }
        }
    }, [open, showSearch]);

    const filtered = useMemo(() => {
        if (!query.trim()) return options;
        const q = query.trim().toLowerCase();
        return options.filter((o) =>
            o.label.toLowerCase().includes(q) ||
            (o.keywords ? o.keywords.toLowerCase().includes(q) : false),
        );
    }, [options, query]);

    // highlight が範囲外にならないようクランプ
    useEffect(() => {
        if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
    }, [filtered.length, highlight]);

    const buttonPadding = size === 'sm' ? 'px-2 py-1.5' : 'px-3 py-2';
    const buttonText = size === 'sm' ? 'text-xs' : 'text-sm';
    const itemPadding = size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2';

    const commit = (id: string) => {
        onChange(id);
        setOpen(false);
    };

    return (
        <div ref={wrapperRef} className={`relative ${className}`} style={minWidth ? { minWidth } : undefined}>
            <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setOpen((o) => !o)}
                className={`w-full flex items-center justify-between gap-2 ${buttonPadding} ${buttonText} bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-slate-100 disabled:cursor-not-allowed ${selected ? 'text-slate-700' : 'text-slate-400'}`}
            >
                <span className="flex items-center gap-1.5 min-w-0">
                    {selected?.color && (
                        <span
                            className="w-3 h-3 rounded-sm border border-slate-300 flex-shrink-0"
                            style={{ backgroundColor: selected.color }}
                        />
                    )}
                    <span className="truncate text-left">{selected?.label ?? placeholder}</span>
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
            {open && (
                <div className="absolute z-30 mt-1 w-full min-w-[180px] bg-white border border-slate-200 rounded-md shadow-lg">
                    {showSearch && (
                        <div className="p-1.5 border-b border-slate-100 sticky top-0 bg-white">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={query}
                                    onChange={(e) => {
                                        setQuery(e.target.value);
                                        setHighlight(0);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'ArrowDown') {
                                            e.preventDefault();
                                            setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                                        } else if (e.key === 'ArrowUp') {
                                            e.preventDefault();
                                            setHighlight((h) => Math.max(0, h - 1));
                                        } else if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const pick = filtered[highlight];
                                            if (pick) commit(pick.id);
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            setOpen(false);
                                        }
                                    }}
                                    placeholder="検索..."
                                    className="w-full pl-7 pr-7 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                                {query && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setQuery('');
                                            setHighlight(0);
                                            searchInputRef.current?.focus();
                                        }}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
                                        tabIndex={-1}
                                        title="クリア"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    <div className="max-h-60 overflow-y-auto">
                        {allowEmpty && !query && (
                            <button
                                type="button"
                                onClick={() => commit('')}
                                className={`w-full flex items-center gap-2 ${itemPadding} text-sm text-left hover:bg-slate-50 ${value === '' ? 'bg-slate-50 font-medium text-slate-700' : 'text-slate-500'}`}
                            >
                                <span className="w-4 h-4 shrink-0">{value === '' && <Check className="w-4 h-4 text-slate-700" />}</span>
                                <span className="truncate flex-1">{emptyLabel}</span>
                            </button>
                        )}
                        {filtered.length === 0 ? (
                            <div className={`${itemPadding} text-sm text-slate-400`}>
                                {query ? '一致する候補がありません' : '候補がありません'}
                            </div>
                        ) : (
                            filtered.map((o, idx) => {
                                const isSelected = o.id === value;
                                const isHighlight = idx === highlight;
                                return (
                                    <button
                                        key={o.id}
                                        type="button"
                                        onClick={() => commit(o.id)}
                                        onMouseEnter={() => setHighlight(idx)}
                                        className={`w-full flex items-center gap-2 ${itemPadding} text-sm text-left ${isHighlight ? 'bg-slate-100' : 'hover:bg-slate-50'} ${isSelected ? 'font-medium text-slate-700' : 'text-slate-700'}`}
                                    >
                                        <span className="w-4 h-4 shrink-0">{isSelected && <Check className="w-4 h-4 text-slate-700" />}</span>
                                        {o.color && (
                                            <span
                                                className="w-3 h-3 rounded-sm border border-slate-300 flex-shrink-0"
                                                style={{ backgroundColor: o.color }}
                                            />
                                        )}
                                        <span className="truncate flex-1">{o.label}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
