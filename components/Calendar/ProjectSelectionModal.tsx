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
        <div className="fixed inset-0 z-50 flex flex-col lg:items-center lg:justify-center lg:bg-black/50">
            {/* オーバーレイ（デスクトップのみ） */}
            <div
                className="absolute inset-0 bg-black/50 hidden lg:block"
                onClick={onClose}
            />

            {/* モーダル本体 */}
            <div className="relative bg-white flex flex-col justify-center w-full h-full lg:rounded-lg lg:shadow-xl lg:h-auto lg:w-[400px] lg:max-w-full lg:mx-4 p-8">
                <h3 className="text-xl font-bold text-slate-800 mb-4 text-center">
                    案件の登録方法を選択
                </h3>

                <p className="text-sm text-slate-600 mb-6 text-center">
                    既存の案件マスターから作成するか、新規で作成するかを選択してください。
                </p>

                <div className="flex flex-col gap-3">
                    <button
                        onClick={onSelectExisting}
                        className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg transition-colors duration-150"
                    >
                        既存案件から作成
                    </button>

                    <button
                        onClick={onCreateNew}
                        className="w-full py-3 px-4 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded-lg transition-colors duration-150"
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
