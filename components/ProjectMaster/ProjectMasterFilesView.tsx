'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Paperclip } from 'lucide-react';

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
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>ファイル読み込み中...</span>
            </div>
        );
    }

    if (files.length === 0) return null;

    // カテゴリごとにファイルをグループ化（ファイルがあるカテゴリのみ表示）
    const grouped = CATEGORIES
        .map(cat => ({ ...cat, files: files.filter(f => f.category === cat.key) }))
        .filter(g => g.files.length > 0);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-xs font-medium text-gray-600">
                    添付ファイル（{files.length}件）
                </span>
            </div>

            {grouped.map(({ key, label, files: catFiles }) => (
                <div key={key}>
                    <p className="text-xs text-gray-500 font-medium mb-1.5">{label}</p>

                    {/* 画像サムネイル */}
                    {catFiles.some(f => f.fileType === 'image') && (
                        <div className="flex flex-wrap gap-2 mb-1.5">
                            {catFiles
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
                    {catFiles.filter(f => f.fileType === 'pdf').map(file => (
                        <a
                            key={file.id}
                            href={file.signedUrl ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-blue-600 hover:underline mb-1"
                        >
                            <FileText className="w-4 h-4 text-red-400 shrink-0" />
                            <span className="truncate">{file.fileName}</span>
                            <span className="text-xs text-gray-400 shrink-0">{formatFileSize(file.fileSize)}</span>
                        </a>
                    ))}
                </div>
            ))}
        </div>
    );
}
