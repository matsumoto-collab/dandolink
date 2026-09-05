'use client';

import React from 'react';
import { X } from 'lucide-react';
import ProjectChatTab from './ProjectChatTab';

interface ProjectChatModalProps {
    projectId: string;
    title?: string;
    onClose: () => void;
}

/**
 * 案件チャットを単独モーダルで開く（モバイルのアクションシート用）。
 */
export default function ProjectChatModal({ projectId, title, onClose }: ProjectChatModalProps) {
    return (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-stretch lg:items-center justify-center">
            <div className="relative bg-white w-full h-full lg:h-[85vh] lg:max-w-2xl lg:rounded-xl shadow-xl flex flex-col pwa-main-safe">
                <div className="flex-shrink-0 flex items-center px-4 py-3 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-900 flex-1 truncate">
                        {title ? `${title} のチャット` : '案件チャット'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5 text-slate-600" />
                    </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden p-3">
                    <ProjectChatTab projectId={projectId} onNavigateAway={onClose} />
                </div>
            </div>
        </div>
    );
}
