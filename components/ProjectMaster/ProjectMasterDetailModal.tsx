'use client';

import React from 'react';
import { X, Edit } from 'lucide-react';
import { ProjectMaster } from '@/types/calendar';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import ProjectMasterDetailPanel from './ProjectMasterDetailPanel';

interface ProjectMasterDetailModalProps {
    pm: ProjectMaster | null;
    onClose: () => void;
    onEdit: (pm: ProjectMaster) => void;
}

export default function ProjectMasterDetailModal({ pm, onClose, onEdit }: ProjectMasterDetailModalProps) {
    const isOpen = pm !== null;
    const modalRef = useModalKeyboard(isOpen, onClose);

    if (!pm) return null;

    const handleEdit = () => {
        onEdit(pm);
        onClose();
    };

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex items-start pt-[4.5rem] lg:items-center lg:pt-0 justify-center overflow-y-auto">
            {/* オーバーレイ */}
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

            {/* モーダル本体 */}
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[calc(100dvh-6rem)] lg:max-h-[90vh] overflow-y-auto mb-4 lg:mb-0 shrink-0"
            >
                {/* ヘッダー */}
                <div className="sticky top-0 bg-white border-b border-gray-200 px-4 md:px-6 py-4 flex items-center justify-between z-10">
                    <div className="flex-1 min-w-0 mr-3">
                        <h2 className="text-lg md:text-xl font-semibold text-gray-900 truncate">{pm.title}</h2>
                        {pm.customerName && (
                            <p className="text-sm text-gray-500 truncate">{pm.customerName}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={handleEdit}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                            <Edit className="w-4 h-4" />
                            編集
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* コンテンツ */}
                <div className="px-4 md:px-6 py-4">
                    <ProjectMasterDetailPanel pm={pm} />
                </div>
            </div>
        </div>
    );
}
