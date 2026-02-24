'use client';

import React, { useEffect, useState } from 'react';
import { Project } from '@/types/calendar';
import ProjectForm from './ProjectForm';
import ProjectDetailView from './ProjectDetailView';
import EditingIndicator from '../Calendar/EditingIndicator';
import { useAssignmentPresence } from '@/hooks/useAssignmentPresence';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import toast from 'react-hot-toast';

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
    const modalRef = useModalKeyboard(isOpen, onClose);

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
        <div className="fixed inset-0 lg:left-64 z-[60] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ（デスクトップのみ） */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block"
                onClick={onClose}
            />

            {/* モーダルコンテンツ */}
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:h-auto max-h-[calc(100dvh-5rem)] lg:max-h-[90vh] mt-4 lg:mt-0">
                {/* ヘッダー */}
                <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between pwa-modal-safe">
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
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
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
                                } catch (error) {
                                    toast.error(`保存に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
                                } finally {
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
