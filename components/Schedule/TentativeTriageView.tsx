'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useMasterData } from '@/hooks/useMasterData';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';
import { ListChecks, RefreshCw } from 'lucide-react';

/**
 * 仮予定の仕分けビュー（設計書 §5-4）。
 *
 * dateStatus 導入時、既存の配置は全行「確定」で始まる。どれが本当は仮
 * （先方未確定の仮押さえ）かは登録した本人しか知らないため、各管理者が
 * 自分の担当案件の今後の予定を一覧して仮/確定をワンタップで仕分けする。
 * リリース直後の一巡が主用途だが、その後も日常の見直しに使える。
 */

type TriageAssignment = {
    id: string;
    date: string;
    assignedEmployeeId: string;
    memberCount: number;
    constructionType: string | null;
    dateStatus?: string;
    confirmDueDate?: string | null;
    updatedAt: string;
    projectMaster?: {
        id: string;
        title: string;
        name?: string | null;
        honorific?: string | null;
        createdBy?: string | string[] | null;
    } | null;
};

type LiteUser = {
    id: string;
    displayName: string;
    tentativeConfirmLeadDays?: number;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function displayName(a: TriageAssignment): string {
    const pm = a.projectMaster;
    if (!pm) return '不明な案件';
    return pm.name ? `${pm.name}${pm.honorific || ''}` : pm.title;
}

function formatDateLabel(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function toDateInputValue(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export default function TentativeTriageView() {
    const { data: session } = useSession();
    const currentUserId = session?.user?.id;
    const { constructionTypes } = useMasterData();

    const [assignments, setAssignments] = useState<TriageAssignment[]>([]);
    const [users, setUsers] = useState<LiteUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mineOnly, setMineOnly] = useState(true);
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

    const userNameById = useMemo(() => {
        const map = new Map<string, string>();
        users.forEach((u) => map.set(u.id, u.displayName));
        return map;
    }, [users]);

    // 工事種別はUUIDマスタ保存（旧データは名前直入りもある）。id→名前で解決し、どちらでもなければそのまま
    const constructionTypeName = useCallback((raw: string | null): string => {
        if (!raw) return '-';
        return constructionTypes.find((t) => t.id === raw || t.name === raw)?.name || raw;
    }, [constructionTypes]);

    const myLeadDays = useMemo(() => {
        const me = users.find((u) => u.id === currentUserId);
        return typeof me?.tentativeConfirmLeadDays === 'number' ? me.tentativeConfirmLeadDays : 14;
    }, [users, currentUserId]);

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const [aRes, uRes] = await Promise.all([
                fetch(`/api/assignments?startDate=${encodeURIComponent(today.toISOString())}`, { cache: 'no-store' }),
                fetch('/api/users', { cache: 'no-store' }),
            ]);
            if (aRes.ok) setAssignments(await aRes.json());
            if (uRes.ok) setUsers(await uRes.json());
        } catch (e) {
            logger.error('[TentativeTriage] 取得に失敗', e);
            toast.error('予定の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const visible = useMemo(() => {
        const list = mineOnly && currentUserId
            ? assignments.filter((a) => extractAssigneeIds(a.projectMaster?.createdBy ?? undefined).includes(currentUserId))
            : assignments;
        return [...list].sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
    }, [assignments, mineOnly, currentUserId]);

    const tentativeCount = useMemo(
        () => visible.filter((a) => a.dateStatus === 'tentative').length,
        [visible]
    );

    const patchAssignment = useCallback(async (a: TriageAssignment, body: Record<string, unknown>) => {
        setSavingIds((prev) => new Set(prev).add(a.id));
        try {
            const res = await fetch(`/api/assignments/${a.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, expectedUpdatedAt: a.updatedAt }),
            });
            if (res.status === 409) {
                toast.error('他のユーザーが更新しています。最新を読み込みます');
                await fetchAll();
                return;
            }
            if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
            const updated = await res.json();
            setAssignments((prev) =>
                prev.map((x) => (x.id === a.id
                    ? { ...x, dateStatus: updated.dateStatus, confirmDueDate: updated.confirmDueDate, updatedAt: updated.updatedAt }
                    : x))
            );
        } catch (e) {
            logger.error('[TentativeTriage] 更新に失敗', e);
            toast.error('保存に失敗しました');
        } finally {
            setSavingIds((prev) => {
                const next = new Set(prev);
                next.delete(a.id);
                return next;
            });
        }
    }, [fetchAll]);

    const handleStatusChange = (a: TriageAssignment, next: 'confirmed' | 'tentative') => {
        if ((a.dateStatus ?? 'confirmed') === next) return;
        const body: Record<string, unknown> = { dateStatus: next };
        if (next === 'tentative' && !a.confirmDueDate) {
            // 自動提案: 予定日の◯日前（◯=操作ユーザーの設定値）
            const d = new Date(a.date);
            d.setDate(d.getDate() - myLeadDays);
            body.confirmDueDate = d.toISOString();
        }
        if (next === 'confirmed') {
            body.confirmDueDate = null;
        }
        patchAssignment(a, body);
    };

    const handleDueDateChange = (a: TriageAssignment, value: string) => {
        if (!value) {
            patchAssignment(a, { confirmDueDate: null });
            return;
        }
        const [y, m, d] = value.split('-').map(Number);
        if (!y || !m || !d) return;
        patchAssignment(a, { confirmDueDate: new Date(y, m - 1, d).toISOString() });
    };

    return (
        <div className="p-4 md:p-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <ListChecks className="w-6 h-6" />
                        仮予定の仕分け
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        今後の予定を「確定 / 仮（先方未確定の仮押さえ）」に仕分けます。仮にすると確認予定日を自動提案します。
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                        <input
                            type="checkbox"
                            checked={mineOnly}
                            onChange={(e) => setMineOnly(e.target.checked)}
                            className="w-4 h-4 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                        />
                        自分の担当案件のみ
                    </label>
                    <button
                        onClick={fetchAll}
                        className="p-2 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
                        title="再読み込み"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="mb-3 text-sm text-slate-600">
                {visible.length}件の予定（うち仮 {tentativeCount}件）
            </div>

            {isLoading ? (
                <div className="py-16 text-center text-slate-500">読み込み中...</div>
            ) : visible.length === 0 ? (
                <div className="py-16 text-center text-slate-500">
                    {mineOnly ? '自分の担当案件に今後の予定はありません' : '今後の予定はありません'}
                </div>
            ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600 text-xs">
                                <tr>
                                    <th className="px-3 py-2 text-left whitespace-nowrap">日付</th>
                                    <th className="px-3 py-2 text-left">現場名</th>
                                    <th className="px-3 py-2 text-left whitespace-nowrap">種別</th>
                                    <th className="px-3 py-2 text-left whitespace-nowrap">班</th>
                                    <th className="px-3 py-2 text-center whitespace-nowrap">確度</th>
                                    <th className="px-3 py-2 text-left whitespace-nowrap">確認予定日</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {visible.map((a) => {
                                    const isTentative = a.dateStatus === 'tentative';
                                    const saving = savingIds.has(a.id);
                                    return (
                                        <tr key={a.id} className={isTentative ? 'bg-amber-50/60' : ''}>
                                            <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-800">
                                                {formatDateLabel(a.date)}
                                            </td>
                                            <td className="px-3 py-2 text-slate-800">
                                                {displayName(a)}
                                                {(a.memberCount ?? 0) > 0 && (
                                                    <span className="ml-2 text-xs text-slate-500">{a.memberCount}人</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                                {constructionTypeName(a.constructionType)}
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                                {a.assignedEmployeeId === 'unassigned'
                                                    ? '未割当'
                                                    : userNameById.get(a.assignedEmployeeId) || '不明'}
                                            </td>
                                            <td className="px-3 py-2 text-center whitespace-nowrap">
                                                <div className={`inline-flex rounded-md border border-slate-300 overflow-hidden ${saving ? 'opacity-50 pointer-events-none' : ''}`}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStatusChange(a, 'confirmed')}
                                                        className={`px-3 py-1 text-xs font-medium transition-colors ${
                                                            !isTentative ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                                                        }`}
                                                    >
                                                        確定
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStatusChange(a, 'tentative')}
                                                        className={`px-3 py-1 text-xs font-medium border-l border-slate-300 transition-colors ${
                                                            isTentative ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                                                        }`}
                                                    >
                                                        仮
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap">
                                                {isTentative ? (
                                                    <input
                                                        type="date"
                                                        value={toDateInputValue(a.confirmDueDate)}
                                                        onChange={(e) => handleDueDateChange(a, e.target.value)}
                                                        disabled={saving}
                                                        className="px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                    />
                                                ) : (
                                                    <span className="text-xs text-slate-400">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
