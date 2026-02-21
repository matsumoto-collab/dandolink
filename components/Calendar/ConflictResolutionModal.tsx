'use client';

import React from 'react';
import { ProjectAssignment, ConflictResolutionAction } from '@/types/calendar';
import { AlertTriangle, RefreshCw, Upload, X } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface ConflictResolutionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onResolve: (action: ConflictResolutionAction) => void;
    latestData?: ProjectAssignment;
    conflictMessage?: string;
}

export default function ConflictResolutionModal({
    isOpen,
    onClose,
    onResolve,
    latestData,
    conflictMessage = '他のユーザーによってデータが更新されました',
}: ConflictResolutionModalProps) {
    const modalRef = useModalKeyboard(isOpen, onClose);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 z-[70] flex items-center justify-center">
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50"
                onClick={onClose}
            />

            {/* モーダルコンテンツ */}
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                {/* ヘッダー */}
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center gap-3 rounded-t-lg">
                    <AlertTriangle className="w-6 h-6 text-slate-600" />
                    <h2 className="text-lg font-semibold text-slate-700">編集の競合</h2>
                </div>

                {/* コンテンツ */}
                <div className="px-6 py-4">
                    <p className="text-gray-700 mb-4">
                        {conflictMessage}
                    </p>

                    {latestData && (
                        <div className="bg-gray-50 rounded-lg p-4 mb-4">
                            <h3 className="text-sm font-medium text-gray-700 mb-2">最新のデータ:</h3>
                            <div className="text-sm text-gray-600 space-y-1">
                                <p>
                                    <span className="font-medium">現場名:</span>{' '}
                                    {latestData.projectMaster?.title || '不明'}
                                </p>
                                <p>
                                    <span className="font-medium">日付:</span>{' '}
                                    {new Date(latestData.date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                                </p>
                                <p>
                                    <span className="font-medium">更新日時:</span>{' '}
                                    {new Date(latestData.updatedAt).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </div>
                    )}

                    <p className="text-sm text-gray-500 mb-6">
                        どのように処理しますか？
                    </p>

                    {/* アクションボタン */}
                    <div className="space-y-3">
                        <button
                            onClick={() => onResolve('reload')}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                        >
                            <RefreshCw className="w-5 h-5" />
                            <span>最新のデータを読み込む</span>
                        </button>

                        <button
                            onClick={() => onResolve('overwrite')}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                        >
                            <Upload className="w-5 h-5" />
                            <span>自分の変更で上書き</span>
                        </button>

                        <button
                            onClick={() => onResolve('cancel')}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                            <X className="w-5 h-5" />
                            <span>キャンセル</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
