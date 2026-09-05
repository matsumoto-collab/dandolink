'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';

interface UserOption {
    id: string;
    displayName: string;
    role: string;
}

interface NewRoomModalProps {
    onClose: () => void;
    onCreated: (roomId: string) => void;
}

/**
 * 新規チャット（DM／グループ）の作成モーダル。
 * チャット画面（スマホ）とチャットウインドウ（PC・iPad）で共用。
 */
export default function NewRoomModal({ onClose, onCreated }: NewRoomModalProps) {
    const createDM = useChatStore((s) => s.createDM);
    const createGroup = useChatStore((s) => s.createGroup);
    const [users, setUsers] = useState<UserOption[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [groupName, setGroupName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetch('/api/chat/users')
            .then((r) => r.json())
            .then((d) => setUsers(d.users ?? []))
            .catch(() => { /* noop */ });
    }, []);

    const filtered = useMemo(() => {
        if (!search.trim()) return users;
        const q = search.toLowerCase();
        return users.filter((u) => u.displayName.toLowerCase().includes(q));
    }, [users, search]);

    const toggle = (uid: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    };

    const onCreate = async () => {
        if (selected.size === 0) return;
        setIsLoading(true);
        const ids = Array.from(selected);
        const roomId = ids.length === 1
            ? await createDM(ids[0])
            : await createGroup(ids, groupName.trim() || 'グループ');
        setIsLoading(false);
        if (roomId) onCreated(roomId);
    };

    const isGroup = selected.size > 1;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center px-4 py-3 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-900 flex-1">新規チャット</h3>
                    <button onClick={onClose} className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center">
                        <X className="w-5 h-5 text-slate-600" />
                    </button>
                </div>

                <div className="p-4 space-y-3 flex-1 overflow-y-auto min-h-0">
                    {isGroup && (
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">グループ名</label>
                            <input
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                placeholder="例: 現場連絡"
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                            メンバーを選択（{selected.size}名）
                        </label>
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="名前で検索"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm mb-2"
                        />
                        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl max-h-72 overflow-y-auto">
                            {filtered.map((u) => (
                                <li key={u.id}>
                                    <label className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selected.has(u.id)}
                                            onChange={() => toggle(u.id)}
                                            className="w-4 h-4"
                                        />
                                        <span className="text-sm text-slate-900 flex-1">{u.displayName}</span>
                                        <span className="text-[11px] text-slate-500">{roleLabel(u.role)}</span>
                                    </label>
                                </li>
                            ))}
                            {filtered.length === 0 && (
                                <li className="px-3 py-6 text-center text-xs text-slate-400">該当なし</li>
                            )}
                        </ul>
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-slate-200 flex gap-2 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={onCreate}
                        disabled={selected.size === 0 || isLoading}
                        className="px-4 py-2 text-sm rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 hover:opacity-90"
                    >
                        {isLoading ? '作成中...' : selected.size <= 1 ? 'DM開始' : 'グループ作成'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function roleLabel(role: string): string {
    switch (role) {
        case 'admin': return '管理者';
        case 'manager': return 'マネージャー';
        case 'foreman1': return '職長1';
        case 'foreman2': return '職長2';
        case 'worker': return '職方';
        case 'partner': return '協力業者';
        default: return role;
    }
}
