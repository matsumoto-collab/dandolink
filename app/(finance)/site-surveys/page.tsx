'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, FileSearch, Trash2, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useSiteSurveys } from '@/hooks/useSiteSurveys';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useDebounce } from '@/hooks/useDebounce';
import { useSiteSurveyEditor } from '@/stores/siteSurveySlices/editorOpenSlice';
import { Button } from '@/components/ui/Button';

export default function SiteSurveyListPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    useEffect(() => {
        if (status !== 'authenticated') return;
        const role = session?.user?.role;
        if (role !== 'admin' && role !== 'manager') {
            router.replace('/');
        }
    }, [status, session, router]);

    const { siteSurveys, isLoading, isInitialized, refresh, remove } = useSiteSurveys();
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const openNewEditor = useSiteSurveyEditor((s) => s.openNew);
    const openEditEditor = useSiteSurveyEditor((s) => s.openEdit);
    const closeVersion = useSiteSurveyEditor((s) => s.closeVersion);

    useEffect(() => {
        if (closeVersion > 0) void refresh();
    }, [closeVersion, refresh]);

    const [searchTerm, setSearchTerm] = useState('');
    const debounced = useDebounce(searchTerm, 300);
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    useEffect(() => {
        fetchProjectMasters();
    }, [fetchProjectMasters]);

    const projectName = (projectMasterId: string | null | undefined) => {
        if (!projectMasterId) return '—';
        const pm = projectMasters.find((p) => p.id === projectMasterId);
        return pm?.title ?? '（不明な案件）';
    };

    const filtered = useMemo(() => {
        const q = debounced.trim().toLowerCase();
        if (!q) return siteSurveys;
        return siteSurveys.filter((s) => {
            const pm = projectName(s.projectMasterId).toLowerCase();
            return (
                s.title.toLowerCase().includes(q) ||
                (s.customerName ?? '').toLowerCase().includes(q) ||
                pm.includes(q)
            );
        });
    }, [siteSurveys, debounced, projectMasters]);

    useEffect(() => {
        setCurrentPage(1);
    }, [debounced]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    const paginated = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filtered.slice(start, start + ITEMS_PER_PAGE);
    }, [filtered, currentPage]);

    const handleNew = () => openNewEditor();
    const handleOpen = (id: string) => openEditEditor(id);

    const handleDelete = async (id: string, title: string) => {
        if (!confirm(`「${title}」を削除します。よろしいですか？`)) return;
        try {
            await remove(id);
            toast.success('削除しました');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '削除に失敗しました');
        }
    };

    if (status === 'authenticated') {
        const role = session?.user?.role;
        if (role !== 'admin' && role !== 'manager') {
            return null;
        }
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
                <FileSearch className="w-6 h-6 text-teal-600" />
                <div>
                    <h1 className="text-xl font-bold text-slate-900">図面（現場調査）</h1>
                    <p className="text-xs text-slate-500">
                        {isInitialized ? `${filtered.length}件` : '読み込み中...'}
                    </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void refresh()}
                        disabled={isLoading}
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                        title="再読み込み"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <Button onClick={handleNew} className="gap-1.5">
                        <Plus className="w-4 h-4" />
                        新規作成
                    </Button>
                </div>
            </div>

            <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="タイトル・案件名・顧客名で検索..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none"
                    />
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto bg-white border border-slate-200 rounded-xl shadow-sm">
                {isLoading && !isInitialized ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                    </div>
                ) : paginated.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <FileSearch className="w-12 h-12 mb-3 opacity-40" />
                        <p className="text-sm">
                            {siteSurveys.length === 0
                                ? '現場調査がまだ登録されていません'
                                : '条件に一致する図面がありません'}
                        </p>
                        {siteSurveys.length === 0 && (
                            <button
                                onClick={handleNew}
                                className="mt-4 text-sm text-teal-600 hover:underline"
                            >
                                新規作成する
                            </button>
                        )}
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                            <tr>
                                <th className="text-left px-4 py-2 font-medium text-slate-600">
                                    タイトル
                                </th>
                                <th className="text-left px-4 py-2 font-medium text-slate-600">
                                    紐付く案件
                                </th>
                                <th className="text-left px-4 py-2 font-medium text-slate-600">
                                    顧客
                                </th>
                                <th className="text-right px-4 py-2 font-medium text-slate-600 whitespace-nowrap">
                                    外周(m)
                                </th>
                                <th className="text-right px-4 py-2 font-medium text-slate-600 whitespace-nowrap">
                                    床面積(㎡)
                                </th>
                                <th className="text-right px-4 py-2 font-medium text-slate-600 whitespace-nowrap">
                                    足場(㎡)
                                </th>
                                <th className="text-left px-4 py-2 font-medium text-slate-600 whitespace-nowrap">
                                    更新日
                                </th>
                                <th className="text-center px-4 py-2 font-medium text-slate-600">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginated.map((s) => (
                                <tr
                                    key={s.id}
                                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                                    onClick={() => handleOpen(s.id)}
                                >
                                    <td className="px-4 py-2.5 font-medium text-slate-900">
                                        {s.title}
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-600">
                                        {projectName(s.projectMasterId)}
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-600">
                                        {s.customerName ?? '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                                        {s.perimeter != null ? s.perimeter.toFixed(2) : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                                        {s.floorArea != null ? s.floorArea.toFixed(2) : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                                        {s.scaffoldArea != null ? s.scaffoldArea.toFixed(2) : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                                        {new Date(s.updatedAt).toLocaleString('ja-JP', {
                                            year: 'numeric',
                                            month: '2-digit',
                                            day: '2-digit',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </td>
                                    <td
                                        className="px-4 py-2.5 text-center"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                onClick={() => handleOpen(s.id)}
                                                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-teal-600"
                                                title="開く"
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(s.id, s.title)}
                                                className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-2 text-sm">
                    <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
                    >
                        前へ
                    </button>
                    <span className="text-slate-500">
                        {currentPage} / {totalPages}
                    </span>
                    <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
                    >
                        次へ
                    </button>
                </div>
            )}
        </div>
    );
}
