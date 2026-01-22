'use client';

import React from 'react';

interface ProjectSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectExisting: () => void;
    onCreateNew: () => void;
}

export default function ProjectSelectionModal({
    isOpen,
    onClose,
    onSelectExisting,
    onCreateNew,
}: ProjectSelectionModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />

            {/* モーダル本体 */}
            <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
                <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">
                    案件の登録方法を選択
                </h3>

                <p className="text-sm text-slate-600 mb-6 text-center">
                    既存の案件マスターから作成するか、新規で作成するかを選択してください。
                </p>

                <div className="flex flex-col gap-3">
                    <button
                        onClick={onSelectExisting}
                        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-md"
                    >
                        既存案件から作成
                    </button>

                    <button
                        onClick={onCreateNew}
                        className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors shadow-md"
                    >
                        新規作成
                    </button>

                    <button
                        onClick={onClose}
                        className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors border border-slate-300"
                    >
                        キャンセル
                    </button>
                </div>
            </div>
        </div>
    );
}
