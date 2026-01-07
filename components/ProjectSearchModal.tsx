'use client';

import React, { useState, useMemo } from 'react';
import { useProjects } from '@/contexts/ProjectContext';
import { Project, CONSTRUCTION_TYPE_LABELS } from '@/types/calendar';

interface ProjectSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (project: Project) => void;
}

export default function ProjectSearchModal({
    isOpen,
    onClose,
    onSelect,
}: ProjectSearchModalProps) {
    const { projects } = useProjects();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedType, setSelectedType] = useState<string>('all');

    // 検索とフィルタリング
    const filteredProjects = useMemo(() => {
        let results = projects;

        // 検索クエリでフィルタリング
        if (searchQuery.trim()) {
            const lowerQuery = searchQuery.toLowerCase();
            results = results.filter(
                (project) =>
                    project.title.toLowerCase().includes(lowerQuery) ||
                    project.customer?.toLowerCase().includes(lowerQuery) ||
                    project.location?.toLowerCase().includes(lowerQuery)
            );
        }

        // 工事種別でフィルタリング
        if (selectedType !== 'all') {
            results = results.filter((project) => project.constructionType === selectedType);
        }

        // 日付でソート（新しい順）
        return results.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }, [searchQuery, selectedType, projects]);

    const handleSelect = (project: Project) => {
        onSelect(project);
        onClose();
        setSearchQuery('');
        setSelectedType('all');
    };

    // 日付をフォーマット
    const formatDate = (date: Date) => {
        const d = new Date(date);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
                {/* ヘッダー */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-800">案件を検索</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <svg
                                className="w-6 h-6"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    </div>

                    {/* 検索フィールド */}
                    <div className="mt-4 space-y-3">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="現場名、顧客名、場所で検索..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />

                        {/* 工事種別フィルター */}
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => setSelectedType('all')}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedType === 'all'
                                    ? 'bg-slate-700 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                すべて
                            </button>
                            <button
                                onClick={() => setSelectedType('assembly')}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedType === 'assembly'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                組立
                            </button>
                            <button
                                onClick={() => setSelectedType('demolition')}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedType === 'demolition'
                                    ? 'bg-red-500 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                解体
                            </button>
                            <button
                                onClick={() => setSelectedType('other')}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedType === 'other'
                                    ? 'bg-yellow-500 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                その他
                            </button>
                        </div>
                    </div>
                </div>

                {/* 検索結果 */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {filteredProjects.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <svg
                                className="w-16 h-16 mx-auto mb-4 text-gray-300"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                            <p className="text-lg font-medium">案件が見つかりません</p>
                            <p className="text-sm mt-2">別のキーワードで検索してください</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredProjects.map((project) => (
                                <div
                                    key={project.id}
                                    onClick={() => handleSelect(project)}
                                    className="p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all cursor-pointer"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-gray-800">
                                                {project.title}
                                            </h3>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                                                {project.customer && (
                                                    <span>顧客: {project.customer}</span>
                                                )}
                                                <span>日付: {formatDate(project.startDate)}</span>
                                            </div>
                                            {project.location && (
                                                <p className="text-sm text-gray-500 mt-1">
                                                    場所: {project.location}
                                                </p>
                                            )}
                                            <div className="flex gap-2 mt-2">
                                                <span
                                                    className={`px-3 py-1 rounded-full text-xs font-medium ${project.constructionType === 'assembly'
                                                        ? 'bg-blue-100 text-blue-700'
                                                        : project.constructionType === 'demolition'
                                                            ? 'bg-red-100 text-red-700'
                                                            : 'bg-yellow-100 text-yellow-700'
                                                        }`}
                                                >
                                                    {project.constructionType ? (CONSTRUCTION_TYPE_LABELS[project.constructionType] || project.constructionType) : '未設定'}
                                                </span>
                                            </div>
                                        </div>
                                        <svg
                                            className="w-6 h-6 text-gray-400"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M9 5l7 7-7 7"
                                            />
                                        </svg>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* フッター */}
                <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-gray-600">
                            {filteredProjects.length}件の案件が見つかりました
                        </p>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            キャンセル
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
