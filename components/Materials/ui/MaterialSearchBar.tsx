'use client';

import React from 'react';
import { Search } from 'lucide-react';

interface MaterialSearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

/**
 * 材料管理リスト上部に常設する検索バー（アイコン＋入力, 高さ約 40px）。
 * 品目・現場を素早く絞り込むための共通部品。
 */
export default function MaterialSearchBar({
    value,
    onChange,
    placeholder = '品目を検索…',
    className = '',
}: MaterialSearchBarProps) {
    return (
        <div className={`relative ${className}`}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full h-10 pl-9 pr-3 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 shadow-sm bg-white"
            />
        </div>
    );
}
