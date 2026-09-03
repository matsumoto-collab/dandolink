'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { matchesSearch } from '@/utils/searchNormalize';

interface ProjectPickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** すでに明細に入っている案件（選べないようにする） */
    excludeIds: string[];
    onAdd: (projectMasterIds: string[]) => void;
    isAdding: boolean;
}

/**
 * 「案件を追加」用の案件検索（複数選択）。
 * 候補の抽出条件（請求済み・6か月より前）で落ちた案件も手で足せるように、
 * ここでは中止案件だけを除いた全件から選ばせる。
 */
export default function ProjectPickerModal({
    isOpen,
    onClose,
    excludeIds,
    onAdd,
    isAdding,
}: ProjectPickerModalProps) {
    const { projectMasters, isLoading, fetchProjectMasters } = useProjectMasters();
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const modalRef = useModalKeyboard(isOpen, onClose);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelected([]);
            fetchProjectMasters();
        }
    }, [isOpen, fetchProjectMasters]);

    const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

    const results = useMemo(() => {
        const list = projectMasters.filter((pm) => pm.status !== 'cancelled' && !excluded.has(pm.id));
        const filtered = query.trim()
            ? list.filter(
                  (pm) =>
                      matchesSearch(pm.title, query) ||
                      matchesSearch(pm.customerName, query) ||
                      matchesSearch(pm.location, query),
              )
            : list;
        return filtered
            .slice()
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 200);
    }, [projectMasters, query, excluded]);

    if (!isOpen) return null;

    const toggle = (id: string) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="absolute inset-0" onClick={onClose} />
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
            >
                <div className="px-5 py-3 border-b border-slate-200">
                    <h2 className="text-lg font-bold text-slate-800">案件を追加</h2>
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="現場名、顧客名、場所で検索..."
                        className="mt-3 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
                    {isLoading ? (
                        <div className="py-10 text-center">
                            <Loading text="読み込み中..." />
                        </div>
                    ) : results.length === 0 ? (
                        <div className="py-10 text-center text-slate-500 text-sm">該当する案件がありません</div>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {results.map((pm) => (
                                <li key={pm.id}>
                                    <label className="flex items-start gap-3 py-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(pm.id)}
                                            onChange={() => toggle(pm.id)}
                                            className="mt-1 w-4 h-4 accent-teal-600"
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-sm font-semibold text-slate-800">{pm.title}</span>
                                            <span className="block text-xs text-slate-500">
                                                {pm.customerName || '顧客未設定'}
                                                {pm.location ? ` ・ ${pm.location}` : ''}
                                            </span>
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                    <span className="text-sm text-slate-600">{selected.length}件選択中</span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} disabled={isAdding}>
                            キャンセル
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => onAdd(selected)}
                            disabled={selected.length === 0 || isAdding}
                            isLoading={isAdding}
                        >
                            追加
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
