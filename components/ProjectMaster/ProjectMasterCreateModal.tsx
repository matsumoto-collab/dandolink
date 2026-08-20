'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { ProjectMasterForm, ProjectMasterFormData, DEFAULT_FORM_DATA } from '@/components/ProjectMasters/ProjectMasterForm';
import toast from 'react-hot-toast';

interface ProjectMasterCreateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (data: ProjectMasterFormData) => Promise<void>;
    /** フォーム初期値の上書き（見積書から作成時の名前・顧客の引き継ぎ等）。参照は親側で安定させること */
    initialData?: Partial<ProjectMasterFormData>;
}

export default function ProjectMasterCreateModal({ isOpen, onClose, onCreate, initialData }: ProjectMasterCreateModalProps) {
    const { data: session } = useSession();
    const currentUserId = session?.user?.id;
    const buildInitialFormData = useCallback((): ProjectMasterFormData => ({
        ...DEFAULT_FORM_DATA,
        ...(currentUserId ? { createdBy: [currentUserId] } : {}),
        ...initialData,
    }), [currentUserId, initialData]);
    const [formData, setFormData] = useState<ProjectMasterFormData>(buildInitialFormData);
    const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    // stateはコミットまで反映されないため、同一ティック内の連打はrefで同期的に弾く
    const isSavingRef = useRef(false);

    useEffect(() => {
        if (isOpen) {
            setFormData(buildInitialFormData());
            setShowUnsavedConfirm(false);
            setErrors({});
            setIsSaving(false);
            isSavingRef.current = false;
        }
    }, [isOpen, buildInitialFormData]);

    // 入力が修正されたら該当エラーを自動クリア
    useEffect(() => {
        setErrors(prev => {
            if (Object.keys(prev).length === 0) return prev;
            const next = { ...prev };
            if (formData.name.trim() && next.name) delete next.name;
            if (formData.constructionContent && next.constructionContent) delete next.constructionContent;
            if (formData.createdBy.length > 0 && next.createdBy) delete next.createdBy;
            if (formData.customerName && next.customerName) delete next.customerName;
            return next;
        });
    }, [formData.name, formData.constructionContent, formData.createdBy, formData.customerName]);

    const isFormDirty = () => {
        return JSON.stringify(formData) !== JSON.stringify(buildInitialFormData());
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
        if (isSavingRef.current) return;
        const newErrors: Record<string, string> = {};
        if (formData.createdBy.length === 0) newErrors.createdBy = '案件責任者を1名以上選択してください';
        if (!formData.constructionContent) newErrors.constructionContent = '工事内容を選択してください';
        if (!formData.name.trim()) newErrors.name = '名前を入力してください';
        if (!formData.customerName) newErrors.customerName = '元請けを選択してください';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            // 画面上の並び順で最初のエラーを特定
            const fieldOrder = ['createdBy', 'constructionContent', 'name', 'customerName'];
            const firstErrorField = fieldOrder.find(f => newErrors[f]);
            if (firstErrorField) {
                requestAnimationFrame(() => {
                    const el = document.querySelector(`[data-field-id="${firstErrorField}"]`) as HTMLElement | null;
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        const input = el.querySelector('input, select, textarea') as HTMLElement | null;
                        if (input) {
                            input.focus({ preventScroll: true });
                        } else {
                            el.focus({ preventScroll: true });
                        }
                    }
                });
            }
            toast.error('入力に不備があります');
            return;
        }
        setErrors({});
        isSavingRef.current = true;
        setIsSaving(true);
        try {
            await onCreate(formData);
            onClose();
        } catch {
            toast.error('案件マスターの作成に失敗しました');
            isSavingRef.current = false;
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ */}
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={handleClose} />

            {/* モーダル本体 */}
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:max-h-[90vh]"
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 bg-slate-50 border-b border-slate-200 px-4 md:px-6 py-4 flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-3">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg md:text-xl font-semibold text-slate-900">新規案件登録</h2>
                            <span className="px-2 py-0.5 text-xs font-bold bg-slate-200 text-slate-700 rounded-full whitespace-nowrap">
                                新規作成
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 md:px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                    <ProjectMasterForm
                        formData={formData}
                        setFormData={setFormData}
                        onSubmit={handleSubmit}
                        onCancel={handleClose}
                        isEdit={false}
                        errors={errors}
                        isSaving={isSaving}
                    />
                </div>
            </div>

            {/* 未保存変更確認ダイアログ */}
            {showUnsavedConfirm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowUnsavedConfirm(false)} />
                    <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                        <h3 className="text-base font-semibold text-slate-900 mb-2">入力内容を破棄しますか？</h3>
                        <p className="text-sm text-slate-500">入力中の内容は保存されません。</p>
                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setShowUnsavedConfirm(false)}
                                className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                入力を続ける
                            </button>
                            <button
                                onClick={() => {
                                    setShowUnsavedConfirm(false);
                                    onClose();
                                }}
                                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition-colors"
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
