'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Paperclip } from 'lucide-react';

interface ProjectMasterFileData {
    id: string;
    fileName: string;
    fileType: string;
    mimeType: string;
    fileSize: number;
    description: string | null;
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
            // サイレントフェイル（詳細エリアなので表示しない）
        } finally {
            setIsLoading(false);
        }
    }, [projectMasterId]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>ファイル読み込み中...</span>
            </div>
        );
    }

    if (files.length === 0) return null;

    return (
        <div>
            <div className="flex items-center gap-1.5 mb-2">
                <Paperclip className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-xs font-medium text-gray-600">
                    添付ファイル ({files.length}件)
                </span>
            </div>

            {/* 画像サムネイルグリッド */}
            {files.some(f => f.fileType === 'image') && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {files
                        .filter(f => f.fileType === 'image' && f.signedUrl)
                        .map(file => (
                            <a
                                key={file.id}
                                href={file.signedUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={file.fileName}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={file.signedUrl!}
                                    alt={file.fileName}
                                    className="w-16 h-16 object-cover rounded border border-gray-200 hover:opacity-80 transition-opacity"
                                />
                            </a>
                        ))
                    }
                </div>
            )}

            {/* PDFリスト */}
            {files.filter(f => f.fileType === 'pdf').length > 0 && (
                <div className="space-y-1">
                    {files
                        .filter(f => f.fileType === 'pdf')
                        .map(file => (
                            <a
                                key={file.id}
                                href={file.signedUrl ?? '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                            >
                                <FileText className="w-4 h-4 text-red-400 shrink-0" />
                                <span className="truncate">{file.fileName}</span>
                                <span className="text-xs text-gray-400 shrink-0">
                                    {formatFileSize(file.fileSize)}
                                </span>
                            </a>
                        ))
                    }
                </div>
            )}
        </div>
    );
}
