'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useProjects } from '@/hooks/useProjects';
import { Project } from '@/types/calendar';
import { EstimateInput } from '@/types/estimate';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Edit, Trash2, Search, Loader2 } from 'lucide-react';
import { useCalendarStore } from '@/stores/calendarStore';
import toast from 'react-hot-toast';

// モーダルを遅延読み込み
const ProjectModal = dynamic(
    () => import('@/components/Projects/ProjectModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);
const EstimateModal = dynamic(
    () => import('@/components/Estimates/EstimateModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

export default function ProjectListPage() {
    const { projects, addProject, updateProject, deleteProject, refreshProjects, isLoading } = useProjects();
    const getForemanName = useCalendarStore((state) => state.getForemanName);
    const fetchForemen = useCalendarStore((state) => state.fetchForemen);
    const foremanInitialized = useCalendarStore((state) => state.foremanSettingsInitialized);

    // ページ表示時に全件取得（カレンダーとは独立してフェッチ）
    useEffect(() => {
        refreshProjects();
    }, [refreshProjects]);

    useEffect(() => {
        if (!foremanInitialized) fetchForemen();
    }, [foremanInitialized, fetchForemen]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<Partial<Project> | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'date' | 'title'>('date');
    const [_isSubmitting, setIsSubmitting] = useState(false);

    // 見積書作成モーダル（案件詳細から起動）
    const [isEstimateModalOpen, setIsEstimateModalOpen] = useState(false);
    const [estimateInitialData, setEstimateInitialData] = useState<{ projectId?: string; title?: string }>({});

    const handleCreateEstimateFromProject = useCallback(() => {
        if (editingProject?.id) {
            setEstimateInitialData({
                projectId: editingProject.id,
                title: `${editingProject.title ?? ''} 見積書`,
            });
            setIsEstimateModalOpen(true);
        }
    }, [editingProject]);

    const handleEstimateSubmit = useCallback(async (data: EstimateInput) => {
        try {
            const res = await fetch('/api/estimates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...data,
                    validUntil: data.validUntil instanceof Date ? data.validUntil.toISOString() : data.validUntil,
                }),
            });
            if (!res.ok) throw new Error('Failed to create estimate');
            setIsEstimateModalOpen(false);
            toast.success('見積書を作成しました');
        } catch {
            toast.error('見積書の作成に失敗しました');
        }
    }, []);

    // フィルタリングとソート
    const filteredAndSortedProjects = projects
        .filter(project =>
            project.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            project.customer?.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .sort((a, b) => {
            if (sortBy === 'date') {
                return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
            } else {
                return a.title.localeCompare(b.title);
            }
        });

    const handleAddNew = () => {
        setEditingProject(null);
        setIsModalOpen(true);
    };

    const handleEdit = (project: Project) => {
        setEditingProject(project);
        setIsModalOpen(true);
    };

    const handleDelete = async (projectId: string) => {
        if (confirm('この案件を削除してもよろしいですか?')) {
            try {
                await deleteProject(projectId);
            } catch (error) {
                console.error('Failed to delete project:', error);
                toast.error(error instanceof Error ? error.message : '案件の削除に失敗しました');
            }
        }
    };

    const handleSubmit = async (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        try {
            setIsSubmitting(true);
            if (editingProject?.id) {
                await updateProject(editingProject.id, data);
            } else {
                await addProject(data);
            }
            setIsModalOpen(false);
            setEditingProject(null);
        } catch (error) {
            console.error('Failed to save project:', error);
            toast.error(error instanceof Error ? error.message : '案件の保存に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingProject(null);
    };

    if (isLoading && projects.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 h-full flex flex-col bg-gradient-to-br from-slate-50 to-white w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-2">
                    案件一覧
                </h1>
                <p className="text-slate-600">登録されている全ての案件を管理できます</p>
            </div>

            {/* ツールバー */}
            <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                {/* 検索バーとソート */}
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
                    {/* 検索バー */}
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="現場名または元請会社名で検索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm"
                        />
                    </div>

                    {/* ソート */}
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as 'date' | 'title')}
                        className="px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="date">日付順</option>
                        <option value="title">現場名順</option>
                    </select>
                </div>

                {/* 新規追加ボタン */}
                <button
                    onClick={handleAddNew}
                    className="
                        flex items-center justify-center gap-2 px-5 py-2.5
                        bg-gradient-to-r from-slate-700 to-slate-800
                        text-white font-semibold rounded-lg
                        hover:from-slate-800 hover:to-slate-900
                        active:scale-95
                        transition-all duration-200 shadow-md hover:shadow-lg
                    "
                >
                    <Plus className="w-5 h-5" />
                    <span className="hidden sm:inline">新規案件追加</span>
                    <span className="sm:hidden">新規追加</span>
                </button>
            </div>

            {/* モバイルカードビュー */}
            <div className="md:hidden flex-1 overflow-auto">
                {filteredAndSortedProjects.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-lg">
                        <p className="text-slate-500">
                            {searchTerm ? '検索結果が見つかりませんでした' : '案件が登録されていません'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredAndSortedProjects.map((project) => (
                            <div
                                key={project.id}
                                className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-lg transition-shadow"
                            >
                                {/* ヘッダー: 現場名とアクション */}
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center">
                                        <div
                                            className="w-3 h-3 rounded-full mr-2 shadow-sm flex-shrink-0"
                                            style={{ backgroundColor: project.color }}
                                        />
                                        <span className="text-base font-semibold text-slate-900">
                                            {project.title}
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleEdit(project)}
                                            className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            title="編集"
                                        >
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(project.id)}
                                            className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            title="削除"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* 元請会社 */}
                                {project.customer && (
                                    <div className="text-sm text-slate-600 mb-2">
                                        元請: {project.customer}
                                    </div>
                                )}

                                {/* 詳細情報 */}
                                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                                    <span className="inline-flex items-center px-2 py-1 bg-slate-100 rounded text-xs">
                                        {formatDate(project.startDate, 'short')}
                                    </span>
                                    <span>
                                        職長: {getForemanName(project.assignedEmployeeId ?? '')}
                                    </span>
                                    <span>
                                        {project.workers?.length || 0}人
                                    </span>
                                </div>

                                {/* 備考 */}
                                {project.remarks && (
                                    <div className="text-sm text-slate-500 truncate border-t border-slate-100 pt-2 mt-3">
                                        {project.remarks}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* デスクトップテーブルビュー */}
            <div className="hidden md:block flex-1 overflow-auto bg-white rounded-xl shadow-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-gradient-to-r from-slate-100 to-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                現場名
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                元請会社
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                開始日
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                担当職長
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                人数
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                備考
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-800 uppercase tracking-wider">
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {filteredAndSortedProjects.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                    {searchTerm ? '検索結果が見つかりませんでした' : '案件が登録されていません'}
                                </td>
                            </tr>
                        ) : (
                            filteredAndSortedProjects.map((project) => (
                                <tr
                                    key={project.id}
                                    className="hover:bg-gradient-to-r hover:from-slate-50 hover:to-transparent transition-all duration-200"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div
                                                className="w-3 h-3 rounded-full mr-3 shadow-sm"
                                                style={{ backgroundColor: project.color }}
                                            />
                                            <span className="text-sm font-semibold text-slate-900">
                                                {project.title}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                        {project.customer || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                        {formatDate(project.startDate, 'full')}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                        {getForemanName(project.assignedEmployeeId ?? '')}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                        {project.workers?.length || 0}人
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-700 max-w-xs truncate">
                                        {project.remarks || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => handleEdit(project)}
                                            className="text-slate-600 hover:text-slate-700 mr-4 transition-colors"
                                            title="編集"
                                        >
                                            <Edit className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(project.id)}
                                            className="text-slate-600 hover:text-slate-700 transition-colors"
                                            title="削除"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* 統計情報 */}
            <div className="mt-4 text-sm text-slate-600">
                全 {filteredAndSortedProjects.length} 件の案件
                {searchTerm && ` (${projects.length}件中)`}
            </div>

            {/* モーダル */}
            <ProjectModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSubmit={handleSubmit}
                onDelete={editingProject?.id ? () => handleDelete(editingProject.id!) : undefined}
                initialData={editingProject || undefined}
                onCreateEstimate={editingProject?.id ? handleCreateEstimateFromProject : undefined}
            />

            {/* 見積書作成モーダル（案件詳細から起動） */}
            <EstimateModal
                isOpen={isEstimateModalOpen}
                onClose={() => setIsEstimateModalOpen(false)}
                onSubmit={handleEstimateSubmit}
                initialData={estimateInitialData}
            />
        </div>
    );
}
