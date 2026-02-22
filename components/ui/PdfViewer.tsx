'use client';

import { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';

interface PdfViewerProps {
    url: string;
    fileName: string;
    onClose: () => void;
}

export function PdfViewer({ url, fileName, onClose }: PdfViewerProps) {
    // Escキーで閉じる
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 lg:left-64 z-[100] flex flex-col bg-black/95">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-black/60">
                <span className="text-white/80 text-sm truncate max-w-[60vw]" title={fileName}>
                    {fileName}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-sm text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                    >
                        <ExternalLink className="w-4 h-4" />
                        <span className="hidden sm:inline">外部で開く</span>
                    </a>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-6 h-6 text-white" />
                    </button>
                </div>
            </div>

            {/* PDF表示エリア */}
            <div className="flex-1 overflow-hidden">
                <iframe
                    src={url}
                    className="w-full h-full border-0"
                    title={fileName}
                />
            </div>
        </div>
    );
}
