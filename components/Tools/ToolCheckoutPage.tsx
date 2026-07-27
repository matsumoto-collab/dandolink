'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Pencil, Settings as SettingsIcon, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { useNavigation } from '@/contexts/NavigationContext';
import { matchesSearch } from '@/utils/searchNormalize';
import { Button } from '@/components/ui/Button';
import MaterialSearchBar from '@/components/Materials/ui/MaterialSearchBar';
import ToolStatusBadge from './ToolStatusBadge';
import ToolStatusModal from './ToolStatusModal';
import ToolEditModal from './ToolEditModal';
import {
    Tool,
    ToolCategory,
    ToolStatus,
    TOOL_STATUSES,
    TOOL_STATUS_LABELS,
    TOOL_STATUSES_HIDDEN_BY_DEFAULT,
} from '@/types/tool';

// 工具そのものの登録・削除ができるロール
const MANAGE_ROLES = ['admin', 'manager'];
// 持出し・返却ができるロール（協力会社と税理士は閲覧のみ）
const OPERATE_ROLES = ['admin', 'manager', 'foreman1', 'foreman2', 'worker'];

type StatusFilter = ToolStatus | 'all';

const fmtDate = (iso: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 持出日からの経過日数（ローカル日付の差。表示用なので時刻は無視する） */
const daysSince = (iso: string | null): number | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today.getTime() - start.getTime()) / 86400000);
};

const destinationOf = (tool: Tool): string => tool.projectName || tool.destinationNote || '';

/**
 * 持出しリスト（在庫管理メニュー）。
 * 共有工具が「今どこにあるか（誰がどの現場へ持って行ったか）」「修理中か」を全員で共有する台帳。
 * 閲覧は全ロール。持出し/返却は社員のみ、工具の登録・削除は管理者・マネージャーのみ。
 */
export default function ToolCheckoutPage() {
    const { data: session } = useSession();
    const { setActivePage } = useNavigation();
    const role = (session?.user?.role || '').toLowerCase();
    const canManage = MANAGE_ROLES.includes(role);
    const canOperate = OPERATE_ROLES.includes(role);

    const [tools, setTools] = useState<Tool[]>([]);
    const [categories, setCategories] = useState<ToolCategory[]>([]);
    const [workers, setWorkers] = useState<{ id: string; displayName: string }[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [categoryFilter, setCategoryFilter] = useState('all');

    const [statusModalTool, setStatusModalTool] = useState<Tool | null>(null);
    const [editModalTool, setEditModalTool] = useState<Tool | null>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const fetchAll = useCallback(async () => {
        try {
            const [toolsRes, categoriesRes] = await Promise.all([
                fetch('/api/tools'),
                fetch('/api/master-data/tool-categories'),
            ]);
            if (toolsRes.ok) setTools(await toolsRes.json());
            if (categoriesRes.ok) setCategories(await categoriesRes.json());
        } catch (error) {
            logger.error('Failed to fetch tools:', error);
            toast.error('工具の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // 持出者の選択肢。閲覧専用ロールでは使わないので取りに行かない
    useEffect(() => {
        if (!canOperate) return;
        fetch('/api/dispatch/workers')
            .then((res) => (res.ok ? res.json() : []))
            .then((data) => setWorkers(Array.isArray(data) ? data : []))
            .catch((error) => logger.error('Failed to fetch workers:', error));
    }, [canOperate]);

    const counts = useMemo(() => {
        const result: Record<string, number> = { all: 0 };
        TOOL_STATUSES.forEach((s) => { result[s] = 0; });
        tools.forEach((tool) => {
            result[tool.status] = (result[tool.status] ?? 0) + 1;
            if (!TOOL_STATUSES_HIDDEN_BY_DEFAULT.includes(tool.status)) result.all += 1;
        });
        return result;
    }, [tools]);

    const visibleTools = useMemo(() => {
        const q = query.trim();
        return tools.filter((tool) => {
            // 「すべて」は廃棄を含めない（絞り込みで廃棄を選んだときだけ出す）
            if (statusFilter === 'all') {
                if (TOOL_STATUSES_HIDDEN_BY_DEFAULT.includes(tool.status)) return false;
            } else if (tool.status !== statusFilter) {
                return false;
            }
            if (categoryFilter !== 'all' && tool.categoryId !== categoryFilter) return false;
            if (q) {
                const haystack = [tool.name, tool.categoryName, tool.projectName, tool.destinationNote, tool.holderName, tool.note];
                if (!haystack.some((value) => value && matchesSearch(value, q))) return false;
            }
            return true;
        });
    }, [tools, statusFilter, categoryFilter, query]);

    const handleSaved = (updated: Tool) => {
        setTools((prev) => prev.map((tool) => (tool.id === updated.id ? updated : tool)));
        setStatusModalTool(null);
    };

    const openEditModal = (tool: Tool | null) => {
        setEditModalTool(tool);
        setIsEditModalOpen(true);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
            </div>
        );
    }

    const statusChips: { key: StatusFilter; label: string }[] = [
        { key: 'all', label: 'すべて' },
        ...TOOL_STATUSES.map((s) => ({ key: s as StatusFilter, label: TOOL_STATUS_LABELS[s] })),
    ];

    return (
        <div className="min-w-0">
            {/* ヘッダー */}
            <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold text-slate-900">持出しリスト</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        共有工具が今どこにあるか（誰がどの現場へ持って行ったか）を共有します
                    </p>
                </div>
                {canManage && (
                    <Button
                        leftIcon={<Plus className="w-4 h-4" />}
                        onClick={() => openEditModal(null)}
                        disabled={categories.length === 0}
                        className="shrink-0"
                    >
                        <span className="hidden sm:inline">工具を登録</span>
                        <span className="sm:hidden">登録</span>
                    </Button>
                )}
            </div>

            {/* 種類が未登録のときの導線 */}
            {categories.length === 0 && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-start gap-2 text-sm text-amber-900">
                        <Info className="w-4 h-4 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                            <p className="font-medium">工具の種類がまだ登録されていません</p>
                            <p className="text-amber-800 mt-0.5">
                                {canManage
                                    ? '「設定 > 工具の種類」で種類（例: インパクトドライバー、発電機）を追加すると、工具を登録できるようになります。'
                                    : '管理者が「設定 > 工具の種類」で種類を追加すると使えるようになります。'}
                            </p>
                            {canManage && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    leftIcon={<SettingsIcon className="w-4 h-4" />}
                                    onClick={() => setActivePage('settings')}
                                    className="mt-2 bg-white"
                                >
                                    設定を開く
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 状態フィルタ（件数つき） */}
            <div className="flex flex-wrap gap-1.5 mb-3">
                {statusChips.map((chip) => (
                    <button
                        key={chip.key}
                        onClick={() => setStatusFilter(chip.key)}
                        className={`px-3 py-1.5 text-sm rounded-xl border transition-colors ${
                            statusFilter === chip.key
                                ? 'bg-slate-800 text-white border-slate-800 font-medium'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        {chip.label}
                        <span className={`ml-1.5 tabular-nums ${statusFilter === chip.key ? 'text-slate-300' : 'text-slate-400'}`}>
                            {counts[chip.key] ?? 0}
                        </span>
                    </button>
                ))}
            </div>

            {/* 種類の絞り込みと検索 */}
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full sm:w-56 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white text-sm"
                >
                    <option value="all">すべての種類</option>
                    {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                </select>
                <div className="w-full sm:w-72 sm:ml-auto">
                    <MaterialSearchBar value={query} onChange={setQuery} placeholder="工具名・現場・持出者で絞り込み" />
                </div>
            </div>

            {/* Desktop: テーブル */}
            <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500">
                            <th className="text-left font-medium px-4 py-3">工具</th>
                            <th className="text-left font-medium px-4 py-3 w-28">状態</th>
                            <th className="text-left font-medium px-4 py-3">持出し先</th>
                            <th className="text-left font-medium px-4 py-3 w-32">持出者</th>
                            <th className="text-left font-medium px-4 py-3 w-28">持出日</th>
                            <th className="text-left font-medium px-4 py-3">メモ</th>
                            {canManage && <th className="w-12"></th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {visibleTools.map((tool) => {
                            const elapsed = tool.status === 'checked_out' ? daysSince(tool.checkedOutAt) : null;
                            return (
                                <tr
                                    key={tool.id}
                                    onClick={() => setStatusModalTool(tool)}
                                    className="cursor-pointer hover:bg-slate-50"
                                >
                                    <td className="px-4 py-3">
                                        <span className="font-medium text-slate-800">{tool.categoryName}</span>
                                        <span className="text-slate-600 ml-1.5">{tool.name}</span>
                                    </td>
                                    <td className="px-4 py-3"><ToolStatusBadge status={tool.status} /></td>
                                    <td className="px-4 py-3 text-sm text-slate-700">{destinationOf(tool) || <span className="text-slate-300">—</span>}</td>
                                    <td className="px-4 py-3 text-sm text-slate-700">{tool.holderName || <span className="text-slate-300">—</span>}</td>
                                    <td className="px-4 py-3 text-sm text-slate-500 tabular-nums">
                                        {tool.status === 'checked_out' && tool.checkedOutAt ? (
                                            <>
                                                {fmtDate(tool.checkedOutAt)}
                                                {elapsed !== null && elapsed > 0 && (
                                                    <span className="text-xs text-slate-400 ml-1">（{elapsed}日）</span>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-slate-300">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-500 truncate max-w-[16rem]">{tool.note || ''}</td>
                                    {canManage && (
                                        <td className="px-2 py-3">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); openEditModal(tool); }}
                                                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                                                title="工具を編集"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        {visibleTools.length === 0 && (
                            <tr>
                                <td colSpan={canManage ? 7 : 6} className="px-4 py-10 text-center text-sm text-slate-400">
                                    {tools.length === 0 ? '工具が登録されていません' : '該当する工具がありません'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile: カード */}
            <div className="md:hidden space-y-2.5">
                {visibleTools.map((tool) => {
                    const elapsed = tool.status === 'checked_out' ? daysSince(tool.checkedOutAt) : null;
                    const destination = destinationOf(tool);
                    return (
                        <div key={tool.id} className="bg-white border border-slate-200 rounded-xl">
                            <button
                                onClick={() => setStatusModalTool(tool)}
                                className="w-full text-left p-3.5"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="font-semibold text-slate-800">
                                            {tool.categoryName}
                                            <span className="font-normal text-slate-600 ml-1.5">{tool.name}</span>
                                        </div>
                                        {destination && (
                                            <div className="text-sm text-slate-600 mt-1 truncate">→ {destination}</div>
                                        )}
                                        {(tool.holderName || elapsed !== null) && (
                                            <div className="text-xs text-slate-400 mt-0.5">
                                                {tool.holderName}
                                                {tool.status === 'checked_out' && tool.checkedOutAt && (
                                                    <span className="ml-1.5 tabular-nums">
                                                        {fmtDate(tool.checkedOutAt)}
                                                        {elapsed !== null && elapsed > 0 && `（${elapsed}日）`}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {tool.note && <div className="text-xs text-slate-400 mt-0.5 truncate">{tool.note}</div>}
                                    </div>
                                    <div className="shrink-0 flex items-center gap-1">
                                        <ToolStatusBadge status={tool.status} />
                                    </div>
                                </div>
                            </button>
                            {canManage && (
                                <div className="px-3.5 pb-2.5 -mt-1 flex justify-end">
                                    <button
                                        onClick={() => openEditModal(tool)}
                                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-md hover:bg-slate-50"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                        編集
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
                {visibleTools.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-10">
                        {tools.length === 0 ? '工具が登録されていません' : '該当する工具がありません'}
                    </p>
                )}
            </div>

            {!canOperate && tools.length > 0 && (
                <p className="mt-4 text-xs text-slate-400 flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    閲覧のみです。持出し・返却の登録は自社の担当者が行います。
                </p>
            )}

            {statusModalTool && (
                <ToolStatusModal
                    tool={statusModalTool}
                    workers={workers}
                    readOnly={!canOperate}
                    onClose={() => setStatusModalTool(null)}
                    onSaved={handleSaved}
                />
            )}

            {isEditModalOpen && (
                <ToolEditModal
                    tool={editModalTool}
                    categories={categories}
                    onClose={() => setIsEditModalOpen(false)}
                    onSaved={fetchAll}
                />
            )}
        </div>
    );
}
