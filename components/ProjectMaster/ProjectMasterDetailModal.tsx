'use client';

import React, { useState, useEffect } from 'react';
import { X, Edit, ArrowLeft } from 'lucide-react';
import { ProjectMaster } from '@/types/calendar';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import ProjectMasterDetailPanel from './ProjectMasterDetailPanel';
import { ProjectMasterForm, ProjectMasterFormData, DEFAULT_FORM_DATA } from '@/components/ProjectMasters/ProjectMasterForm';
import toast from 'react-hot-toast';

interface ProjectMasterDetailModalProps {
    pm: ProjectMaster | null;
    onClose: () => void;
    onUpdate: (id: string, data: ProjectMasterFormData) => Promise<void>;
    initialEditMode?: boolean;
}

function initFormDataFromPm(pm: ProjectMaster): ProjectMasterFormData {
    return {
        title: pm.title,
        customerId: pm.customerId || '',
        customerName: pm.customerName || '',
        constructionContent: pm.constructionContent || '',
        postalCode: pm.postalCode || '',
        prefecture: pm.prefecture || '',
        city: pm.city || '',
        location: pm.location || '',
        plusCode: pm.plusCode || '',
        latitude: pm.latitude ?? undefined,
        longitude: pm.longitude ?? undefined,
        area: pm.area?.toString() || '',
        areaRemarks: pm.areaRemarks || '',
        assemblyDate: pm.assemblyDate ? new Date(pm.assemblyDate).toISOString().split('T')[0] : '',
        demolitionDate: pm.demolitionDate ? new Date(pm.demolitionDate).toISOString().split('T')[0] : '',
        estimatedAssemblyWorkers: pm.estimatedAssemblyWorkers?.toString() || '',
        estimatedDemolitionWorkers: pm.estimatedDemolitionWorkers?.toString() || '',
        contractAmount: pm.contractAmount?.toString() || '',
        scaffoldingSpec: pm.scaffoldingSpec || DEFAULT_FORM_DATA.scaffoldingSpec,
        assemblyForemen: [],
        demolitionForemen: [],
        assemblyConstructionType: '',
        demolitionConstructionType: '',
        remarks: pm.remarks || '',
        createdBy: Array.isArray(pm.createdBy) ? pm.createdBy : (pm.createdBy ? [pm.createdBy] : []),
    };
}

export default function ProjectMasterDetailModal({ pm, onClose, onUpdate, initialEditMode }: ProjectMasterDetailModalProps) {
    const isOpen = pm !== null;
    const [mode, setMode] = useState<'view' | 'edit'>('view');
    const [formData, setFormData] = useState<ProjectMasterFormData>(DEFAULT_FORM_DATA);
    const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

    useEffect(() => {
        if (pm) {
            setMode(initialEditMode ? 'edit' : 'view');
            setFormData(initFormDataFromPm(pm));
            setShowUnsavedConfirm(false);
        }
    }, [pm?.id, initialEditMode]);

    const isFormDirty = () => {
        if (!pm) return false;
        return JSON.stringify(formData) !== JSON.stringify(initFormDataFromPm(pm));
    };

    const handleClose = () => {
        if (mode === 'edit' && isFormDirty()) {
            setShowUnsavedConfirm(true);
        } else {
            onClose();
        }
    };

    const modalRef = useModalKeyboard(isOpen, handleClose);

    if (!pm) return null;

    const handleStartEdit = () => {
        setFormData(initFormDataFromPm(pm));
        setMode('edit');
    };

    const handleCancelEdit = () => {
        if (isFormDirty()) {
            setShowUnsavedConfirm(true);
        } else {
            setMode('view');
            setFormData(initFormDataFromPm(pm));
        }
    };

    const handleUpdate = async () => {
        if (!formData.title.trim()) {
            toast.error('現場名は必須です');
            return;
        }
        try {
            await onUpdate(pm.id, formData);
            setMode('view');
            toast.success('更新しました');
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const isEditMode = mode === 'edit';

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
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
                <div className={`flex-shrink-0 border-b border-gray-200 px-4 md:px-6 py-4 flex items-center justify-between transition-colors ${isEditMode ? 'bg-slate-50' : 'bg-white'}`}>
                    <div className="flex-1 min-w-0 mr-3">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg md:text-xl font-semibold text-gray-900 truncate">{pm.title}</h2>
                            {isEditMode && (
                                <span className="px-2 py-0.5 text-xs font-bold bg-slate-200 text-slate-700 rounded-full whitespace-nowrap">
                                    編集中
                                </span>
                            )}
                        </div>
                        {pm.customerName && (
                            <p className="text-sm text-gray-500 truncate">{pm.customerName}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {isEditMode ? (
                            <button
                                onClick={handleCancelEdit}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                閲覧に戻る
                            </button>
                        ) : (
                            <button
                                onClick={handleStartEdit}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <Edit className="w-4 h-4" />
                                編集
                            </button>
                        )}
                        <button
                            onClick={handleClose}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* コンテンツ */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 md:px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                    {isEditMode ? (
                        <ProjectMasterForm
                            formData={formData}
                            setFormData={setFormData}
                            onSubmit={handleUpdate}
                            onCancel={handleCancelEdit}
                            isEdit={true}
                            projectMasterId={pm.id}
                        />
                    ) : (
                        <ProjectMasterDetailPanel pm={pm} />
                    )}
                </div>
            </div>

            {/* 未保存変更確認ダイアログ */}
            {showUnsavedConfirm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowUnsavedConfirm(false)} />
                    <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                        <h3 className="text-base font-semibold text-gray-900 mb-2">変更を破棄しますか？</h3>
                        <p className="text-sm text-gray-500">編集中の内容は保存されません。</p>
                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setShowUnsavedConfirm(false)}
                                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                編集を続ける
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
