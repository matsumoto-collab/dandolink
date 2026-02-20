'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { ProjectMasterForm, ProjectMasterFormData, DEFAULT_FORM_DATA } from '@/components/ProjectMasters/ProjectMasterForm';
import toast from 'react-hot-toast';

interface ProjectMasterCreateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (data: ProjectMasterFormData) => Promise<void>;
}

export default function ProjectMasterCreateModal({ isOpen, onClose, onCreate }: ProjectMasterCreateModalProps) {
    const [formData, setFormData] = useState<ProjectMasterFormData>(DEFAULT_FORM_DATA);
    const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setFormData(DEFAULT_FORM_DATA);
            setShowUnsavedConfirm(false);
        }
    }, [isOpen]);

    const isFormDirty = () => {
        return JSON.stringify(formData) !== JSON.stringify(DEFAULT_FORM_DATA);
    };

    const handleClose = () => {
        if (isFormDirty()) {
            setShowUnsavedConfirm(true);
        } else {
            onClose();
        }
    };

    const modalRef = useModalKeyboard(isOpen, handleClose);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!formData.title.trim()) {
            toast.error('現場名は必須です');
            return;
        }
        if (!formData.constructionContent) {
            toast.error('工事内容は必須です');
            return;
        }
        if (formData.createdBy.length === 0) {
            toast.error('案件責任者は必須です');
            return;
        }
        if (!formData.customerName) {
            toast.error('元請けは必須です');
            return;
        }
        try {
            await onCreate(formData);
            onClose();
        } catch {
            toast.error('案件マスターの作成に失敗しました');
        }
    };

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex items-start pt-[4.5rem] lg:items-center lg:pt-0 justify-center overflow-y-auto">
            {/* オーバーレイ */}
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={handleClose} />

            {/* モーダル本体 */}
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[calc(100dvh-6rem)] lg:max-h-[90vh] overflow-y-auto mb-4 lg:mb-0 shrink-0"
            >
                {/* ヘッダー */}
                <div className="sticky top-0 bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-4 flex items-center justify-between z-10">
                    <div className="flex-1 min-w-0 mr-3">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg md:text-xl font-semibold text-gray-900">新規案件マスター</h2>
                            <span className="px-2 py-0.5 text-xs font-bold bg-blue-200 text-blue-800 rounded-full whitespace-nowrap">
                                新規作成
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="px-4 md:px-6 py-4">
                    <ProjectMasterForm
                        formData={formData}
                        setFormData={setFormData}
                        onSubmit={handleSubmit}
                        onCancel={handleClose}
                        isEdit={false}
                    />
                </div>
            </div>

            {/* 未保存変更確認ダイアログ */}
            {showUnsavedConfirm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowUnsavedConfirm(false)} />
                    <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                        <h3 className="text-base font-semibold text-gray-900 mb-2">入力内容を破棄しますか？</h3>
                        <p className="text-sm text-gray-500">入力中の内容は保存されません。</p>
                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setShowUnsavedConfirm(false)}
                                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                入力を続ける
                            </button>
                            <button
                                onClick={() => {
                                    setShowUnsavedConfirm(false);
                                    onClose();
                                }}
                                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                            >
                                破棄して閉じる
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
