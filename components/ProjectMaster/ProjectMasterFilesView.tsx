'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Folder } from 'lucide-react';

const CATEGORIES = [
    { key: 'survey',      label: '現調写真' },
    { key: 'assembly',    label: '組立' },
    { key: 'demolition',  label: '解体' },
    { key: 'other',       label: 'その他' },
    { key: 'instruction', label: '指示書/図面' },
] as const;

interface ProjectMasterFileData {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    category: string;
    createdAt: string;
    signedUrl: string | null;
}

interface ProjectMasterFilesViewProps {
    projectMasterId: string;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectMasterFilesView({ projectMasterId }: ProjectMasterFilesViewProps) {
    const [files, setFiles] = useState<ProjectMasterFileData[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchFiles = useCallback(async () => {
        try {
            const res = await fetch(`/api/project-masters/${projectMasterId}/files`);
            if (!res.ok) return;
            const data = await res.json();
            setFiles(data);
        } catch {
            // サイレントフェイル
        } finally {
            setIsLoading(false);
        }
    }, [projectMasterId]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    if (isLoading) {
        return (
            <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-10 rounded-lg bg-gray-200 animate-pulse" />
                ))}
            </div>
        );
    }

    if (files.length === 0) {
        return <p className="text-sm text-gray-400 py-1">ファイルがありません</p>;
    }

    const pdfFiles = files.filter(f => f.fileType === 'pdf');
    const hasImages = files.some(f => f.fileType === 'image');

    return (
        <div className="space-y-3">
            {/* フォルダ枚数サマリー */}
            {hasImages && (
                <div className="grid grid-cols-2 gap-2">
                    {CATEGORIES.map(({ key, label }) => {
                        const count = files.filter(f => f.category === key && f.fileType === 'image').length;
                        if (count === 0) return null;
                        return (
                            <div
                                key={key}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200"
                            >
                                <Folder className="w-4 h-4 text-slate-400 shrink-0" />
                                <span className="text-sm text-gray-700 flex-1 truncate">{label}</span>
                                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                                    {count}枚
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* PDFリスト */}
            {pdfFiles.length > 0 && (
                <div className="space-y-1.5">
                    {pdfFiles.map(file => (
                        <a
                            key={file.id}
                            href={file.signedUrl ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                        >
                            <div className="w-8 h-8 flex items-center justify-center bg-red-50 rounded border border-red-100 shrink-0">
                                <FileText className="w-4 h-4 text-red-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-blue-600 hover:underline truncate">{file.fileName}</p>
                                <p className="text-xs text-gray-400">{formatFileSize(file.fileSize)}</p>
                            </div>
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}
