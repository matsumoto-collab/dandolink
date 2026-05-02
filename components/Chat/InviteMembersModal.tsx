'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';

interface UserOption {
    id: string;
    displayName: string;
    role: string;
}

interface InviteMembersModalProps {
    roomId: string;
    /** 既存メンバーID（候補から除外） */
    existingMemberIds: string[];
    onClose: () => void;
    onInvited?: () => void;
}

export default function InviteMembersModal({
    roomId,
    existingMemberIds,
    onClose,
    onInvited,
}: InviteMembersModalProps) {
    const fetchRooms = useChatStore((s) => s.fetchRooms);
    const [users, setUsers] = useState<UserOption[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        fetch('/api/chat/users')
            .then((r) => r.json())
            .then((d) => setUsers(d.users ?? []))
            .catch(() => { /* noop */ });
    }, []);

    const filtered = useMemo(() => {
        const ex = new Set(existingMemberIds);
        const candidates = users.filter((u) => !ex.has(u.id));
        if (!search.trim()) return candidates;
        const q = search.toLowerCase();
        return candidates.filter((u) => u.displayName.toLowerCase().includes(q));
    }, [users, search, existingMemberIds]);

    const toggle = (uid: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    };

    const onSubmit = async () => {
        if (selected.size === 0) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/chat/rooms/${roomId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addMemberIds: Array.from(selected) }),
            });
            if (!res.ok) throw new Error('invite failed');
            await fetchRooms();
            onInvited?.();
            onClose();
        } catch (e) {
            logger.error('[chat] invite', e);
            toast.error('メンバー追加に失敗しました', { position: 'bottom-center' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center px-4 py-3 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-900 flex-1">メンバーを追加</h3>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
                    >
                        <X className="w-5 h-5 text-slate-600" />
                    </button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto min-h-0">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="名前で検索"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm mb-2"
                    />
                    <p className="text-xs text-slate-500 mb-2">{selected.size}名を選択中</p>
                    <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl max-h-80 overflow-y-auto">
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
                            <li className="px-3 py-6 text-center text-xs text-slate-400">
                                追加できるユーザーがいません
                            </li>
                        )}
                    </ul>
                </div>

                <div className="px-4 py-3 border-t border-slate-200 flex gap-2 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={onSubmit}
                        disabled={selected.size === 0 || isSubmitting}
                        className="px-4 py-2 text-sm rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 hover:opacity-90"
                    >
                        {isSubmitting ? '追加中...' : `追加（${selected.size}）`}
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
