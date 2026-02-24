'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import Loading from '@/components/ui/Loading';
import { ProjectMaster } from '@/types/calendar';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface ProjectMasterSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (projectMaster: ProjectMaster) => void;
    onCreateNew: () => void;
}

export default function ProjectMasterSearchModal({
    isOpen,
    onClose,
    onSelect,
    onCreateNew,
}: ProjectMasterSearchModalProps) {
    const { projectMasters, isLoading, fetchProjectMasters } = useProjectMasters();
    const [searchQuery, setSearchQuery] = useState('');
    const modalRef = useModalKeyboard(isOpen, onClose);

    // モーダルが開いたときにデータを再取得
    useEffect(() => {
        if (isOpen) {
            fetchProjectMasters();
        }
    }, [isOpen, fetchProjectMasters]);

    // 検索とフィルタリング
    const filteredMasters = useMemo(() => {
        let results = projectMasters;

        // アクティブな案件のみ
        results = results.filter(pm => pm.status === 'active');

        // 検索クエリでフィルタリング
        if (searchQuery.trim()) {
            const lowerQuery = searchQuery.toLowerCase();
            results = results.filter(
                (pm) =>
                    pm.title.toLowerCase().includes(lowerQuery) ||
                    pm.customerName?.toLowerCase().includes(lowerQuery) ||
                    pm.location?.toLowerCase().includes(lowerQuery)
            );
        }

        // 更新日でソート（新しい順）
        return results.sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }, [searchQuery, projectMasters]);

    const handleSelect = (projectMaster: ProjectMaster) => {
        onSelect(projectMaster);
        onClose();
        setSearchQuery('');
    };

    const handleCreateNew = () => {
        onCreateNew();
        onClose();
        setSearchQuery('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-3xl lg:max-h-[80vh]">
                {/* ヘッダー */}
                <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 pwa-modal-safe">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-800">案件マスターを選択</h2>
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
                    <div className="mt-4">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="現場名、顧客名、場所で検索..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                        />
                    </div>
                </div>

                {/* 検索結果 */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                    {isLoading ? (
                        <div className="text-center py-12">
                            <Loading text="読み込み中..." />
                        </div>
                    ) : filteredMasters.length === 0 ? (
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
                            <p className="text-lg font-medium">案件マスターが見つかりません</p>
                            <p className="text-sm mt-2">新規作成してください</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredMasters.map((pm) => (
                                <div
                                    key={pm.id}
                                    onClick={() => handleSelect(pm)}
                                    className="p-4 border border-gray-200 rounded-lg hover:border-slate-500 hover:shadow-md transition-all cursor-pointer"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-gray-800">
                                                {pm.title}
                                            </h3>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                                                {pm.customerName && (
                                                    <span>顧客: {pm.customerName}</span>
                                                )}
                                                {pm.location && (
                                                    <span>場所: {pm.location}</span>
                                                )}
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
                <div className="flex-shrink-0 px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-gray-600">
                            {filteredMasters.length}件の案件マスター
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={handleCreateNew}
                                className="px-4 py-2 text-white bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors"
                            >
                                新規作成
                            </button>
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
        </div>
    );
}
