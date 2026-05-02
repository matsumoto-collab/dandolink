'use client';

import React, { useEffect, useState, useRef } from 'react';
import { logger } from '@/lib/logger';
import type { MentionToken, MentionTargetType } from '@/lib/chat/mentionParser';

interface SuggestItem {
    id: string;
    label: string;
    sub?: string;
}

type Mode = 'user' | 'project' | 'role';

interface MentionSuggestPopoverProps {
    /** トリガ '@' / '#' */
    trigger: '@' | '#';
    /** 検索クエリ（カーソル直前の文字列） */
    query: string;
    onSelect: (token: MentionToken) => void;
    onClose: () => void;
}

/**
 * @ 入力時はユーザータブ + ロールタブを切替可、
 * # 入力時は案件のみ。
 * 候補をリスト表示し、クリック or Enter で選択。
 */
export default function MentionSuggestPopover({
    trigger,
    query,
    onSelect,
    onClose,
}: MentionSuggestPopoverProps) {
    const isHash = trigger === '#';
    const [mode, setMode] = useState<Mode>(isHash ? 'project' : 'user');
    const [items, setItems] = useState<SuggestItem[]>([]);
    const [activeIdx, setActiveIdx] = useState(0);
    const fetchSeqRef = useRef(0);

    useEffect(() => {
        const seq = ++fetchSeqRef.current;
        const run = async () => {
            try {
                const res = await fetch(
                    `/api/chat/mentions/suggest?type=${mode}&q=${encodeURIComponent(query)}`,
                    { cache: 'no-store' }
                );
                if (!res.ok) return;
                const data = await res.json();
                if (seq !== fetchSeqRef.current) return; // 古いフェッチを破棄
                setItems(data.items ?? []);
                setActiveIdx(0);
            } catch (e) {
                logger.error('[chat] suggest fetch', e);
            }
        };
        const t = setTimeout(run, 120);
        return () => clearTimeout(t);
    }, [mode, query]);

    // キー操作はComposer側でハンドリング想定だが、
    // 単独利用時のクリック選択はサポート

    const handleSelect = (item: SuggestItem) => {
        onSelect({
            type: mode as MentionTargetType,
            label: item.label,
            targetId: item.id,
        });
    };

    return (
        <div className="absolute bottom-full left-0 mb-2 w-72 max-h-72 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col z-30">
            {!isHash && (
                <div className="flex border-b border-slate-200">
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setMode('user');
                        }}
                        className={`flex-1 px-3 py-2 text-xs font-semibold ${mode === 'user' ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        ユーザー
                    </button>
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setMode('role');
                        }}
                        className={`flex-1 px-3 py-2 text-xs font-semibold ${mode === 'role' ? 'bg-amber-50 text-amber-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        ロール
                    </button>
                </div>
            )}
            <div className="flex-1 overflow-y-auto">
                {items.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-400">候補なし</div>
                ) : (
                    <ul>
                        {items.map((it, idx) => (
                            <li key={it.id}>
                                <button
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelect(it);
                                    }}
                                    onMouseEnter={() => setActiveIdx(idx)}
                                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${idx === activeIdx ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                >
                                    <span className="text-slate-900 flex-1 truncate">{it.label}</span>
                                    {it.sub && (
                                        <span className="text-[11px] text-slate-500 truncate">{it.sub}</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-200 bg-slate-50">
                クリックで選択 / Esc でキャンセル
            </div>
            <button onClick={onClose} className="hidden" aria-hidden />
        </div>
    );
}
