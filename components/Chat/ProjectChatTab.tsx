'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Users } from 'lucide-react';
import ChatRoomView from './ChatRoomView';
import { logger } from '@/lib/logger';

interface ProjectChatTabProps {
    projectId: string;
}

interface MemberInfo {
    userId: string;
    displayName: string;
    role: string | null;
}

interface UserOption {
    id: string;
    displayName: string;
    role: string;
}

/**
 * 案件詳細モーダルのチャットタブ。
 *  - 既存ルームがあればそのまま開く
 *  - 無ければセットアップ画面: デフォルトメンバー（managers + 確定メンバー
 *    + admin + 自分）にチェックを付けた状態で表示。任意で除外・追加してから
 *    「作成」を押すと ensure-room (POST) でルーム生成
 */
export default function ProjectChatTab({ projectId }: ProjectChatTabProps) {
    const { data: session } = useSession();
    const [roomId, setRoomId] = useState<string | null>(null);
    const [setupMembers, setSetupMembers] = useState<MemberInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isCreating, setIsCreating] = useState(false);
    const [showAddPicker, setShowAddPicker] = useState(false);
    const [allUsers, setAllUsers] = useState<UserOption[]>([]);
    const [pickerSearch, setPickerSearch] = useState('');

    useEffect(() => {
        let cancelled = false;
        setRoomId(null);
        setSetupMembers(null);
        setError(null);
        (async () => {
            try {
                const res = await fetch(`/api/chat/projects/${projectId}/room`, { cache: 'no-store' });
                if (!res.ok) throw new Error('room status failed');
                const data = await res.json();
                if (cancelled) return;
                if (data.roomId) {
                    setRoomId(data.roomId);
                } else {
                    const members: MemberInfo[] = data.members ?? [];
                    setSetupMembers(members);
                    setSelectedIds(new Set(data.suggestedMemberIds ?? members.map((m: MemberInfo) => m.userId)));
                }
            } catch (e) {
                logger.error('[ProjectChatTab] room status', e);
                if (!cancelled) setError('チャット情報を取得できませんでした');
            }
        })();
        return () => { cancelled = true; };
    }, [projectId]);

    useEffect(() => {
        if (!showAddPicker || allUsers.length > 0) return;
        fetch('/api/chat/users')
            .then((r) => r.json())
            .then((d) => setAllUsers(d.users ?? []))
            .catch(() => { /* noop */ });
    }, [showAddPicker, allUsers.length]);

    const candidatesForAdd = useMemo(() => {
        const existing = new Set((setupMembers ?? []).map((m) => m.userId));
        const filtered = allUsers.filter((u) => !existing.has(u.id));
        if (!pickerSearch.trim()) return filtered;
        const q = pickerSearch.toLowerCase();
        return filtered.filter((u) => u.displayName.toLowerCase().includes(q));
    }, [allUsers, setupMembers, pickerSearch]);

    const toggle = (uid: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    };

    const addCandidate = (u: UserOption) => {
        setSetupMembers((prev) => prev ? [...prev, { userId: u.id, displayName: u.displayName, role: u.role }] : prev);
        setSelectedIds((prev) => new Set(prev).add(u.id));
        setShowAddPicker(false);
        setPickerSearch('');
    };

    const onCreate = async () => {
        if (selectedIds.size === 0) return;
        setIsCreating(true);
        try {
            const res = await fetch(`/api/chat/projects/${projectId}/ensure-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memberIds: Array.from(selectedIds) }),
            });
            if (!res.ok) throw new Error('ensure-room failed');
            const data = await res.json();
            setRoomId(data.roomId);
        } catch (e) {
            logger.error('[ProjectChatTab] create', e);
            alert('チャットルーム作成に失敗しました');
        } finally {
            setIsCreating(false);
        }
    };

    if (error) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-rose-600">
                {error}
            </div>
        );
    }

    if (roomId) {
        return (
            <div className="h-[60vh] min-h-[400px] border border-slate-200 rounded-xl overflow-hidden">
                <ChatRoomView roomId={roomId} myUserId={session?.user?.id} />
            </div>
        );
    }

    if (setupMembers === null) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto py-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-3">
                <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-slate-600" />
                    <h3 className="text-sm font-semibold text-slate-900">参加メンバーを確認</h3>
                </div>
                <p className="text-xs text-slate-500">
                    案件マスタの管理者・手配確定メンバー・管理者を初期メンバーとして提案しています。
                    必要に応じてチェックを外したり、メンバーを追加してから作成してください。
                </p>
            </div>

            <div className="border border-slate-200 rounded-xl bg-white">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center">
                    <span className="text-xs font-semibold text-slate-700 flex-1">
                        {selectedIds.size} / {setupMembers.length} 名が選択中
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowAddPicker(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium bg-gradient-to-r from-teal-500 to-teal-700 text-white hover:opacity-90 shadow-sm"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        追加
                    </button>
                </div>
                <ul className="divide-y divide-slate-200 max-h-96 overflow-y-auto">
                    {setupMembers.map((m) => (
                        <li key={m.userId}>
                            <label className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(m.userId)}
                                    onChange={() => toggle(m.userId)}
                                    className="w-4 h-4"
                                />
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                                    {m.displayName.charAt(0)}
                                </div>
                                <span className="text-sm text-slate-900 flex-1">{m.displayName}</span>
                                {m.role && (
                                    <span className="text-[11px] text-slate-500">{roleLabel(m.role)}</span>
                                )}
                            </label>
                        </li>
                    ))}
                </ul>
            </div>

            <div className="mt-4 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={selectedIds.size === 0 || isCreating}
                    className="px-5 py-2.5 text-sm font-medium rounded-xl bg-gradient-to-r from-teal-500 to-teal-700 text-white hover:opacity-90 disabled:opacity-40 shadow-sm"
                >
                    {isCreating ? '作成中...' : 'チャットを作成'}
                </button>
            </div>

            {showAddPicker && (
                <div
                    className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
                    onClick={() => setShowAddPicker(false)}
                >
                    <div
                        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 border-b border-slate-200">
                            <h3 className="text-base font-bold text-slate-900">メンバーを追加</h3>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto min-h-0">
                            <input
                                value={pickerSearch}
                                onChange={(e) => setPickerSearch(e.target.value)}
                                placeholder="名前で検索"
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm mb-2"
                            />
                            <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl max-h-80 overflow-y-auto">
                                {candidatesForAdd.map((u) => (
                                    <li key={u.id}>
                                        <button
                                            type="button"
                                            onClick={() => addCandidate(u)}
                                            className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50"
                                        >
                                            <span className="text-sm text-slate-900 flex-1">{u.displayName}</span>
                                            <span className="text-[11px] text-slate-500">{roleLabel(u.role)}</span>
                                        </button>
                                    </li>
                                ))}
                                {candidatesForAdd.length === 0 && (
                                    <li className="px-3 py-6 text-center text-xs text-slate-400">該当なし</li>
                                )}
                            </ul>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-200 flex justify-end">
                            <button
                                onClick={() => setShowAddPicker(false)}
                                className="px-4 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50"
                            >
                                閉じる
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
