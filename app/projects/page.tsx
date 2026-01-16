'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useProjects } from '@/contexts/ProjectContext';
import { Project } from '@/types/calendar';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Edit2, Trash2, Search, Loader2 } from 'lucide-react';
import { mockEmployees } from '@/data/mockEmployees';

// モーダルを遅延読み込み
const ProjectModal = dynamic(
    () => import('@/components/Projects/ProjectModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

export default function ProjectListPage() {
    const { projects, addProject, updateProject, deleteProject } = useProjects();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<Partial<Project> | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'date' | 'title'>('date');
    const [_isSubmitting, setIsSubmitting] = useState(false);

    // 職長名を取得
    const getEmployeeName = (employeeId: string) => {
        const employee = mockEmployees.find(emp => emp.id === employeeId);
        return employee?.name || '未割り当て';
    };

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
                alert(error instanceof Error ? error.message : '案件の削除に失敗しました');
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
            alert(error instanceof Error ? error.message : '案件の保存に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingProject(null);
    };

    return (
        <div className="p-4 sm:p-6 h-full flex flex-col bg-gradient-to-br from-gray-50 to-white w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent mb-2">
                    案件一覧
                </h1>
                <p className="text-gray-600">登録されている全ての案件を管理できます</p>
            </div>

            {/* ツールバー */}
            <div className="mb-6 flex items-center justify-between gap-4">
                {/* 検索バー */}
                <div className="flex-1 max-w-md relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="現場名または元請会社名で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                    />
                </div>

                {/* ソート */}
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'date' | 'title')}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                >
                    <option value="date">日付順</option>
                    <option value="title">現場名順</option>
                </select>

                {/* 新規追加ボタン */}
                <button
                    onClick={handleAddNew}
                    className="
                        flex items-center gap-2 px-5 py-2.5
                        bg-gradient-to-r from-blue-600 to-blue-700
                        text-white font-semibold rounded-lg
                        hover:from-blue-700 hover:to-blue-800
                        active:scale-95
                        transition-all duration-200 shadow-md hover:shadow-lg
                    "
                >
                    <Plus className="w-5 h-5" />
                    新規案件追加
                </button>
            </div>

            {/* テーブル */}
            <div className="flex-1 overflow-auto bg-white rounded-xl shadow-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gradient-to-r from-gray-100 to-gray-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                現場名
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                元請会社
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                開始日
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                担当職長
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                人数
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                備考
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-gray-800 uppercase tracking-wider">
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredAndSortedProjects.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                    {searchTerm ? '検索結果が見つかりませんでした' : '案件が登録されていません'}
                                </td>
                            </tr>
                        ) : (
                            filteredAndSortedProjects.map((project) => (
                                <tr
                                    key={project.id}
                                    className="hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-200"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div
                                                className="w-3 h-3 rounded-full mr-3 shadow-sm"
                                                style={{ backgroundColor: project.color }}
                                            />
                                            <span className="text-sm font-semibold text-gray-900">
                                                {project.title}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {project.customer || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {formatDate(project.startDate, 'full')}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {getEmployeeName(project.assignedEmployeeId ?? '')}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {project.workers?.length || 0}人
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate">
                                        {project.remarks || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => handleEdit(project)}
                                            className="text-blue-600 hover:text-blue-800 mr-4 transition-colors"
                                            title="編集"
                                        >
                                            <Edit2 className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(project.id)}
                                            className="text-red-600 hover:text-red-800 transition-colors"
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
            <div className="mt-4 text-sm text-gray-600">
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
            />
        </div>
    );
}
