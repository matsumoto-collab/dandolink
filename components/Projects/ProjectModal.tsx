'use client';

import React, { useEffect, useState } from 'react';
import { Project } from '@/types/calendar';
import ProjectForm from './ProjectForm';
import ProjectDetailView from './ProjectDetailView';
import EditingIndicator from '../Calendar/EditingIndicator';
import { useAssignmentPresence } from '@/hooks/useAssignmentPresence';

interface ProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => void | Promise<void>;
    onDelete?: (id: string) => void;
    initialData?: Partial<Project>;
    title?: string;
    defaultDate?: Date;
    defaultEmployeeId?: string;
    readOnly?: boolean;
}

export default function ProjectModal({
    isOpen,
    onClose,
    onSubmit,
    onDelete,
    initialData,
    title: _title = '案件登録',
    defaultDate,
    defaultEmployeeId,
    readOnly = false,
}: ProjectModalProps) {
    // 編集モードの状態管理
    // 既存案件の場合は閲覧モード、新規作成の場合は編集モード
    const [isEditMode, setIsEditMode] = useState(!initialData?.id);
    const [isSaving, setIsSaving] = useState(false);

    // Presence機能: 編集中ユーザーの追跡
    const { startEditing, stopEditing, getEditingUsers } = useAssignmentPresence();
    const assignmentId = initialData?.assignmentId || initialData?.id;
    const otherEditingUsers = assignmentId ? getEditingUsers(assignmentId) : [];

    // モーダルが開くたびに初期状態をリセット
    useEffect(() => {
        if (isOpen) {
            setIsEditMode(!initialData?.id);
            setIsSaving(false);
        }
    }, [isOpen, initialData?.id]);

    // 編集開始/終了をPresenceに通知
    useEffect(() => {
        if (isOpen && assignmentId && isEditMode) {
            startEditing(assignmentId);
        }

        return () => {
            if (assignmentId) {
                stopEditing();
            }
        };
    }, [isOpen, assignmentId, isEditMode, startEditing, stopEditing]);

    // ESCキーでモーダルを閉じる
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // モーダルのタイトルを動的に設定
    const modalTitle = initialData?.id
        ? (isEditMode ? '案件編集' : '案件詳細')
        : '案件登録';

    const handleDelete = () => {
        if (initialData?.id && onDelete) {
            onDelete(initialData.id);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex items-center justify-center">
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50"
                onClick={onClose}
            />

            {/* モーダルコンテンツ */}
            <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                {/* ヘッダー */}
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-semibold text-gray-900">{modalTitle}</h2>
                        {otherEditingUsers.length > 0 && (
                            <EditingIndicator users={otherEditingUsers} />
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="px-6 py-4">
                    {initialData?.id && (!isEditMode || readOnly) ? (
                        // 既存案件の閲覧モード（readOnlyの場合は常に閲覧モード）
                        <ProjectDetailView
                            project={initialData as Project}
                            onEdit={readOnly ? undefined : () => setIsEditMode(true)}
                            onClose={onClose}
                            onDelete={readOnly ? undefined : handleDelete}
                            readOnly={readOnly}
                        />
                    ) : (
                        // 編集モード（新規作成または編集）
                        <ProjectForm
                            initialData={initialData}
                            defaultDate={defaultDate}
                            defaultEmployeeId={defaultEmployeeId}
                            onSubmit={async (data) => {
                                setIsSaving(true);
                                try {
                                    await onSubmit(data);
                                    onClose();
                                } catch {
                                    setIsSaving(false);
                                }
                            }}
                            onCancel={onClose}
                            isSaving={isSaving}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
