// 案件詳細モーダル内の「現場調査」タブ
// 大きいキャンバスは別画面（/site-surveys/[id]）に分離。ここではサマリーリストのみ表示する。
'use client';

import React, { useEffect } from 'react';
import {
    FileSearch,
    Plus,
    ExternalLink,
    Trash2,
    Loader2,
    AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSiteSurveys } from '@/hooks/useSiteSurveys';
import { useSiteSurveyEditor } from '@/stores/siteSurveySlices/editorOpenSlice';

interface SiteSurveyTabProps {
    projectMasterId: string;
}

export default function SiteSurveyTab({ projectMasterId }: SiteSurveyTabProps) {
    const { siteSurveys, isLoading, isInitialized, error, refresh, remove } = useSiteSurveys({
        projectMasterId,
    });
    const openNewEditor = useSiteSurveyEditor((s) => s.openNew);
    const openEditEditor = useSiteSurveyEditor((s) => s.openEdit);
    const closeVersion = useSiteSurveyEditor((s) => s.closeVersion);

    useEffect(() => {
        if (closeVersion > 0) void refresh();
    }, [closeVersion, refresh]);

    const handleNew = () => {
        openNewEditor(projectMasterId);
    };

    const handleOpen = (id: string) => {
        openEditEditor(id);
    };

    const handleDelete = async (id: string, title: string) => {
        if (!confirm(`「${title}」を削除します。よろしいですか？`)) return;
        try {
            await remove(id);
            toast.success('削除しました');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '削除に失敗しました');
        }
    };

    return (
        <div className="py-4">
            <div className="flex items-center gap-3 mb-4">
                <FileSearch className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-semibold text-slate-900">現場調査</h3>
                <button
                    type="button"
                    onClick={handleNew}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm font-medium shadow-sm hover:opacity-90"
                >
                    <Plus className="w-4 h-4" />
                    新規作成
                </button>
            </div>

            {error && (
                <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <AlertCircle className="w-4 h-4 flex-none mt-0.5" />
                    <div>
                        <div className="font-medium">読み込みエラー</div>
                        <div className="text-amber-700">{error}</div>
                        <div className="mt-1 text-amber-600">
                            DB マイグレーションが未実行の場合は、コードの準備は完了しているので migrate 後に再度お試しください。
                        </div>
                    </div>
                </div>
            )}

            {isLoading && !isInitialized ? (
                <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-teal-500" />
                </div>
            ) : siteSurveys.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <FileSearch className="w-10 h-10 mb-2 opacity-40" />
                    <p className="text-sm">この案件にはまだ現場調査がありません</p>
                    <button
                        onClick={handleNew}
                        className="mt-3 text-sm text-teal-600 hover:underline"
                    >
                        新規作成する
                    </button>
                </div>
            ) : (
                <ul className="space-y-2">
                    {siteSurveys.map((s) => (
                        <li
                            key={s.id}
                            onClick={() => handleOpen(s.id)}
                            className="group p-3 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-teal-400 hover:shadow cursor-pointer transition"
                        >
                            <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-slate-900 truncate">
                                        {s.title}
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                                        {s.perimeter != null && (
                                            <span>外周 {s.perimeter.toFixed(2)} m</span>
                                        )}
                                        {s.floorArea != null && (
                                            <span>床 {s.floorArea.toFixed(2)} ㎡</span>
                                        )}
                                        {s.scaffoldArea != null && (
                                            <span>足場 {s.scaffoldArea.toFixed(2)} ㎡</span>
                                        )}
                                        <span>
                                            更新:{' '}
                                            {new Date(s.updatedAt).toLocaleString('ja-JP', {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                    </div>
                                </div>
                                <div
                                    className="flex items-center gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                >
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
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <p className="mt-4 text-xs text-slate-400 text-center">
                ProjectMaster ID: {projectMasterId}
            </p>
        </div>
    );
}
