'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Search } from 'lucide-react';
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
    /** ユーザー候補をこのルームの参加者に限定するためのID */
    roomId?: string;
    onSelect: (token: MentionToken) => void;
    onClose: () => void;
}

/**
 * @ 入力時はユーザータブ + ロールタブを切替可、
 * # 入力時は案件のみ。
 * ポップオーバー内の検索欄で絞り込み、クリック or Enter で選択。
 */
export default function MentionSuggestPopover({
    trigger,
    query,
    roomId,
    onSelect,
    onClose,
}: MentionSuggestPopoverProps) {
    const isHash = trigger === '#';
    const [mode, setMode] = useState<Mode>(isHash ? 'project' : 'user');
    const [items, setItems] = useState<SuggestItem[]>([]);
    const [activeIdx, setActiveIdx] = useState(0);
    // 入力欄に打った文字（query）で初期化し、以降はポップオーバー内の検索欄で絞り込む
    const [search, setSearch] = useState(query);
    const fetchSeqRef = useRef(0);
    const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

    // 入力欄側の文字が変わったら検索欄も追従させる
    useEffect(() => {
        setSearch(query);
    }, [query]);

    useEffect(() => {
        const seq = ++fetchSeqRef.current;
        const run = async () => {
            try {
                const params = new URLSearchParams();
                params.set('type', mode);
                params.set('q', search);
                if (mode === 'user' && roomId) params.set('roomId', roomId);
                const res = await fetch(
                    `/api/chat/mentions/suggest?${params.toString()}`,
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
    }, [mode, search, roomId]);

    const handleSelect = (item: SuggestItem) => {
        onSelect({
            type: mode as MentionTargetType,
            label: item.label,
            targetId: item.id,
        });
    };

    /** キーボードで移動した行を見える位置に保つ */
    const scrollActiveIntoView = (idx: number) => {
        itemRefs.current[idx]?.scrollIntoView({ block: 'nearest' });
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((prev) => {
                const next = Math.min(prev + 1, Math.max(items.length - 1, 0));
                scrollActiveIntoView(next);
                return next;
            });
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((prev) => {
                const next = Math.max(prev - 1, 0);
                scrollActiveIntoView(next);
                return next;
            });
            return;
        }
        if (e.key === 'Enter') {
            if (e.nativeEvent.isComposing) return; // 変換中のEnterは無視
            e.preventDefault();
            const item = items[activeIdx];
            if (item) handleSelect(item);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    /** 検索欄からフォーカスが外へ抜けたら閉じる（ポップオーバー内・送信入力欄への移動なら保持） */
    const handleSearchBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const next = e.relatedTarget as HTMLElement | null;
        if (next && typeof next.closest === 'function' && next.closest('[data-mention-popover]')) return;
        if (next && next.tagName === 'TEXTAREA') return;
        onClose();
    };

    const placeholder = isHash
        ? '現場名・元請名で検索'
        : mode === 'role'
            ? 'ロール名で検索'
            : '名前で検索';

    return (
        <div className="absolute bottom-full left-0 mb-2 w-80 max-w-[calc(100vw-1.5rem)] max-h-80 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col z-30">
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
            {/* 検索欄（autoFocus は付けない＝モバイル/PCで二重マウントされるためフォーカスを奪ってしまう） */}
            <div className="p-2 border-b border-slate-200">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        onBlur={handleSearchBlur}
                        placeholder={placeholder}
                        className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
            </div>
            <div className="flex-1 max-h-56 overflow-y-auto">
                {items.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-400">候補なし</div>
                ) : (
                    <ul>
                        {items.map((it, idx) => (
                            <li
                                key={it.id}
                                ref={(el) => {
                                    itemRefs.current[idx] = el;
                                }}
                            >
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
                ↑↓で移動・Enterで選択 / Escで閉じる
            </div>
        </div>
    );
}
