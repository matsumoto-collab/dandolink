'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter, DragEndEvent, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff, Save, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import Loading from '@/components/ui/Loading';
import { logger } from '@/lib/logger';

interface DispatchOrderUser {
    id: string;
    displayName: string;
    role: string;
    dispatchSortOrder: number | null;
    hideByDefaultInDispatch: boolean;
}

const ROLE_LABELS: Record<string, string> = {
    worker: '職方',
    foreman1: '職長1',
    foreman2: '職長2',
    support: 'サポート',
    manager: 'マネージャー',
    admin: '管理者',
};

function roleLabel(role: string): string {
    return ROLE_LABELS[role.toLowerCase()] ?? role;
}

function roleBadgeClass(role: string): string {
    const r = role.toLowerCase();
    if (r === 'worker') return 'bg-sky-100 text-sky-700';
    if (r === 'foreman1' || r === 'foreman2') return 'bg-emerald-100 text-emerald-700';
    if (r === 'admin') return 'bg-rose-100 text-rose-700';
    if (r === 'manager') return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-600';
}

function SortableRow({ user, onToggleHide }: { user: DispatchOrderUser; onToggleHide: (id: string) => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: user.id });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-3 p-3 bg-white rounded-xl border ${user.hideByDefaultInDispatch ? 'border-slate-200 opacity-75' : 'border-slate-300'} hover:shadow-sm transition-shadow`}
        >
            <button
                type="button"
                {...attributes}
                {...listeners}
                className="touch-none p-1.5 text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing"
                aria-label="並べ替え"
            >
                <GripVertical className="w-5 h-5" />
            </button>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 truncate">{user.displayName}</span>
                    <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${roleBadgeClass(user.role)}`}>
                        {roleLabel(user.role)}
                    </span>
                </div>
                {user.hideByDefaultInDispatch && (
                    <p className="text-xs text-slate-500 mt-0.5">「もっと見る」で表示</p>
                )}
            </div>

            <button
                type="button"
                onClick={() => onToggleHide(user.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${user.hideByDefaultInDispatch
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                title={user.hideByDefaultInDispatch ? 'クリックで常時表示に切り替え' : 'クリックで「もっと見る」送りに切り替え'}
            >
                {user.hideByDefaultInDispatch ? (
                    <>
                        <EyeOff className="w-3.5 h-3.5" />
                        隠す
                    </>
                ) : (
                    <>
                        <Eye className="w-3.5 h-3.5" />
                        常時表示
                    </>
                )}
            </button>
        </div>
    );
}

export default function DispatchOrderSettings() {
    const [users, setUsers] = useState<DispatchOrderUser[]>([]);
    const [originalUsers, setOriginalUsers] = useState<DispatchOrderUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            try {
                const res = await fetch('/api/users/dispatch-order', { cache: 'no-store' });
                if (!res.ok) throw new Error('fetch failed');
                const data: DispatchOrderUser[] = await res.json();
                setUsers(data);
                setOriginalUsers(data.map(u => ({ ...u })));
            } catch (error) {
                logger.error('Failed to load dispatch order:', error);
                toast.error('並び順の取得に失敗しました');
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);

    const isDirty = useMemo(() => {
        if (users.length !== originalUsers.length) return true;
        return users.some((u, idx) => {
            const orig = originalUsers.find(o => o.id === u.id);
            if (!orig) return true;
            if (u.hideByDefaultInDispatch !== orig.hideByDefaultInDispatch) return true;
            if (originalUsers[idx]?.id !== u.id) return true;
            return false;
        });
    }, [users, originalUsers]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        setUsers(prev => {
            const oldIdx = prev.findIndex(u => u.id === active.id);
            const newIdx = prev.findIndex(u => u.id === over.id);
            if (oldIdx < 0 || newIdx < 0) return prev;
            return arrayMove(prev, oldIdx, newIdx);
        });
    };

    const handleToggleHide = (id: string) => {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, hideByDefaultInDispatch: !u.hideByDefaultInDispatch } : u));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const items = users.map((u, idx) => ({
                id: u.id,
                dispatchSortOrder: idx,
                hideByDefaultInDispatch: u.hideByDefaultInDispatch,
            }));
            const res = await fetch('/api/users/dispatch-order', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });
            if (!res.ok) throw new Error('save failed');
            const updated = users.map((u, idx) => ({ ...u, dispatchSortOrder: idx }));
            setUsers(updated);
            setOriginalUsers(updated.map(u => ({ ...u })));
            toast.success('並び順を保存しました');
        } catch (error) {
            logger.error('Failed to save dispatch order:', error);
            toast.error('保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setUsers(originalUsers.map(u => ({ ...u })));
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loading text="並び順を読み込み中..." />
            </div>
        );
    }

    return (
        <div className="max-w-2xl">
            <div className="mb-4">
                <h3 className="text-lg font-semibold text-slate-900">手配確定の並び順</h3>
                <p className="text-sm text-slate-500 mt-1">
                    手配確定モーダルで職方が表示される順序を並び替えできます。「隠す」を押すと「もっと見る」配下に移動します。
                </p>
            </div>

            {/* 保存バー */}
            <div className={`sticky top-0 z-10 flex items-center justify-between mb-4 p-3 rounded-xl transition-colors ${isDirty ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50 border border-slate-200'}`}>
                <span className="text-sm text-slate-700">
                    {isDirty ? '未保存の変更があります' : '変更はありません'}
                </span>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={handleReset}
                        disabled={!isDirty || isSaving}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        戻す
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!isDirty || isSaving}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Save className="w-3.5 h-3.5" />
                        {isSaving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>

            {users.length === 0 ? (
                <p className="text-center text-slate-500 py-12 border border-slate-200 rounded-xl">
                    対象ユーザーがいません
                </p>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={users.map(u => u.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                            {users.map(u => (
                                <SortableRow key={u.id} user={u} onToggleHide={handleToggleHide} />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </div>
    );
}
