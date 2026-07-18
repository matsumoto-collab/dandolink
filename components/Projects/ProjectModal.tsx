'use client';

import React, { useEffect, useState } from 'react';
import { Project } from '@/types/calendar';
import ProjectForm from './ProjectForm';
import ProjectDetailView from './ProjectDetailView';
import EditingIndicator from '../Calendar/EditingIndicator';
import { useAssignmentPresence } from '@/hooks/useAssignmentPresence';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { FileText, Pencil, Trash2, MessageSquare, ExternalLink, UserMinus } from 'lucide-react';
import dynamic from 'next/dynamic';

const ProjectChatTab = dynamic(() => import('@/components/Chat/ProjectChatTab'), { ssr: false });
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
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
    onCreateEstimate?: () => void;
    // 案件マスタ編集画面へ遷移する導線。呼び出し側で権限（管理者/マネージャー）を
    // 判定し、許可された場合のみ渡す。undefined のときはボタン自体を描画しない。
    onEditProjectMaster?: () => void;
    // 配置を浮き（班未定）に戻す＝降格。玉突き運用の正規操作。
    // 呼び出し側が「編集可＋現在浮きでない」場合のみ渡す。
    onDemoteToFloating?: (id: string) => void | Promise<void>;
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
    onCreateEstimate,
    onEditProjectMaster,
    onDemoteToFloating,
}: ProjectModalProps) {
    // 編集モードの状態管理
    // 既存案件の場合は閲覧モード、新規作成の場合は編集モード
    const [isEditMode, setIsEditMode] = useState(!initialData?.id);
    const [isSaving, setIsSaving] = useState(false);
    const [showChat, setShowChat] = useState(false);

    // モーダル開時 / 別案件切替時は常に「詳細表示」へリセット
    useEffect(() => {
        if (isOpen) setShowChat(false);
    }, [isOpen, initialData?.id]);
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

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showDemoteConfirm, setShowDemoteConfirm] = useState(false);

    if (!isOpen) return null;

    // モーダルのタイトルを動的に設定
    const modalTitle = initialData?.id
        ? (isEditMode ? '案件編集' : '案件詳細')
        : '案件登録';

    const handleDelete = () => {
        setShowDeleteConfirm(true);
    };

    const confirmDelete = () => {
        if (initialData?.id && onDelete) {
            onDelete(initialData.id);
            onClose();
        }
        setShowDeleteConfirm(false);
    };

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ（デスクトップのみ） */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block"
                onClick={onClose}
            />

            {/* モーダルコンテンツ */}
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:max-h-[90vh]">
                {/* ヘッダー */}
                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 mr-3">
                        <div className="min-w-0">
                            <h2 className="text-lg md:text-xl font-semibold text-slate-900 truncate">{modalTitle}</h2>
                            {initialData && <LastUpdatedLabel updatedAt={initialData.updatedAt} updatedBy={initialData.updatedBy} />}
                        </div>
                        {otherEditingUsers.length > 0 && (
                            <EditingIndicator users={otherEditingUsers} />
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
                        {!isEditMode && initialData?.id && initialData?.projectMasterId && (
                            <button
                                onClick={() => setShowChat((v) => !v)}
                                title={showChat ? '詳細を表示' : 'チャット'}
                                className={`hidden lg:flex items-center gap-1.5 p-1.5 md:px-3 md:py-1.5 text-sm font-medium border rounded-lg transition-colors ${
                                    showChat
                                        ? 'border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100'
                                        : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                                <MessageSquare className="w-4 h-4" />
                                <span className="hidden md:inline">{showChat ? '詳細を表示' : 'チャット'}</span>
                            </button>
                        )}
                        {!readOnly && !isEditMode && !showChat && initialData?.id && (
                            <button
                                onClick={() => setIsEditMode(true)}
                                title="編集"
                                className="flex items-center gap-1.5 p-1.5 md:px-3 md:py-1.5 text-sm font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <Pencil className="w-4 h-4" />
                                <span className="hidden md:inline">編集</span>
                            </button>
                        )}
                        {!isEditMode && !showChat && initialData?.id && initialData?.projectMasterId && onEditProjectMaster && (
                            <button
                                onClick={onEditProjectMaster}
                                title="案件マスタを編集"
                                className="flex items-center gap-1.5 p-1.5 md:px-3 md:py-1.5 text-sm font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <ExternalLink className="w-4 h-4" />
                                <span className="hidden md:inline">案件マスタを編集</span>
                            </button>
                        )}
                        {!readOnly && !isEditMode && initialData?.id && onDemoteToFloating && (
                            <button
                                onClick={() => setShowDemoteConfirm(true)}
                                title="浮きに戻す（班を外す）"
                                className="flex items-center gap-1.5 p-1.5 md:px-3 md:py-1.5 text-sm font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <UserMinus className="w-4 h-4" />
                                <span className="hidden md:inline">浮きに戻す</span>
                            </button>
                        )}
                        {!readOnly && !isEditMode && initialData?.id && onDelete && (
                            <button
                                onClick={handleDelete}
                                title="削除"
                                className="flex items-center gap-1.5 p-1.5 md:px-3 md:py-1.5 text-sm font-medium border border-red-300 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                                <span className="hidden md:inline">削除</span>
                            </button>
                        )}
                        {!readOnly && !isEditMode && onCreateEstimate && (
                            <button
                                onClick={onCreateEstimate}
                                title="見積書を作成"
                                className="flex items-center gap-1.5 p-1.5 md:px-3 md:py-1.5 text-sm font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <FileText className="w-4 h-4" />
                                <span className="hidden md:inline">見積書を作成</span>
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            title="閉じる"
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* コンテンツ */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 md:px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                    {initialData?.id && showChat && initialData?.projectMasterId ? (
                        <ProjectChatTab projectId={initialData.projectMasterId} />
                    ) : initialData?.id && (!isEditMode || readOnly) ? (
                        // 既存案件の閲覧モード（readOnlyの場合は常に閲覧モード）
                        <ProjectDetailView
                            project={initialData as Project}
                            onClose={onClose}
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

                {/* 浮きに戻す確認ダイアログ */}
                {showDemoteConfirm && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 rounded-lg">
                        <div className="bg-white rounded-xl p-6 mx-4 max-w-sm w-full shadow-xl">
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">浮きに戻しますか？</h3>
                            <p className="text-sm text-slate-600 mb-4">
                                「{initialData?.title}」の班を外し、カレンダー最下部の「浮いている」レーンに移します。
                                手配確定も解除され、担当職長に通知されます。
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowDemoteConfirm(false)}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors font-medium"
                                >
                                    キャンセル
                                </button>
                                <button
                                    onClick={() => {
                                        setShowDemoteConfirm(false);
                                        if (initialData?.id) onDemoteToFloating?.(initialData.id);
                                    }}
                                    className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-xl hover:bg-slate-800 transition-colors font-medium"
                                >
                                    浮きに戻す
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 削除確認ダイアログ */}
                {showDeleteConfirm && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 rounded-lg">
                        <div className="bg-white rounded-xl p-6 mx-4 max-w-sm w-full shadow-xl">
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">案件を削除しますか？</h3>
                            <p className="text-sm text-slate-600 mb-4">
                                「{initialData?.title}」を削除します。この操作は元に戻せません。
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors font-medium"
                                >
                                    キャンセル
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium"
                                >
                                    削除
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
