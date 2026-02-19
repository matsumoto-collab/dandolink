'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { FileText } from 'lucide-react';
import { ImageLightbox } from '@/components/ui/ImageLightbox';

const CATEGORIES = [
    { key: 'survey',      label: '現調写真' },
    { key: 'assembly',    label: '組立' },
    { key: 'demolition',  label: '解体' },
    { key: 'other',       label: 'その他' },
    { key: 'instruction', label: '指示書/図面' },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

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
    const [activeTab, setActiveTab] = useState<CategoryKey>('survey');
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    const fetchFiles = useCallback(async () => {
        try {
            const res = await fetch(`/api/project-masters/${projectMasterId}/files`);
            if (!res.ok) return;
            const data = await res.json();
            setFiles(data);
            // ファイルがあるカテゴリの最初のタブを自動選択
            if (data.length > 0) {
                const firstCat = CATEGORIES.find(c => data.some((f: ProjectMasterFileData) => f.category === c.key));
                if (firstCat) setActiveTab(firstCat.key);
            }
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
            <div className="space-y-2">
                {/* タブスケルトン */}
                <div className="flex gap-1">
                    {[80, 48, 48, 64, 72].map((w, i) => (
                        <div key={i} className="h-6 rounded-full bg-gray-200 animate-pulse" style={{ width: w }} />
                    ))}
                </div>
                {/* 画像グリッドスケルトン */}
                <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="w-20 h-20 rounded-lg bg-gray-200 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (files.length === 0) {
        return <p className="text-sm text-gray-400 py-1">ファイルがありません</p>;
    }

    const tabFiles = files.filter(f => f.category === activeTab);
    const tabImages = tabFiles
        .filter(f => f.fileType === 'image' && f.signedUrl)
        .map(f => ({ src: f.signedUrl!, alt: f.fileName }));

    return (
        <div className="space-y-3">
            {/* カテゴリタブ */}
            <div className="flex gap-1 flex-wrap">
                {CATEGORIES.map(({ key, label }) => {
                    const count = files.filter(f => f.category === key).length;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setActiveTab(key)}
                            className={`
                                px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                                ${activeTab === key
                                    ? 'bg-slate-700 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                            `}
                        >
                            {label}
                            {count > 0 && (
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === key ? 'bg-white/20' : 'bg-gray-300'}`}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* 選択中カテゴリのファイル */}
            {tabFiles.length === 0 ? (
                <p className="text-sm text-gray-400 py-1">このカテゴリにファイルはありません</p>
            ) : (
                <div className="space-y-2">
                    {/* 画像グリッド */}
                    {tabFiles.some(f => f.fileType === 'image') && (
                        <div className="flex flex-wrap gap-2">
                            {tabFiles
                                .filter(f => f.fileType === 'image' && f.signedUrl)
                                .map(file => (
                                    <button
                                        key={file.id}
                                        type="button"
                                        title={file.fileName}
                                        onClick={() => {
                                            const idx = tabImages.findIndex(img => img.src === file.signedUrl);
                                            setLightboxIndex(idx >= 0 ? idx : 0);
                                            setLightboxOpen(true);
                                        }}
                                    >
                                        <div className="relative w-20 h-20 overflow-hidden rounded-lg border border-gray-200 hover:opacity-80 transition-opacity">
                                            <Image
                                                src={file.signedUrl!}
                                                alt={file.fileName}
                                                fill
                                                sizes="80px"
                                                className="object-cover"
                                            />
                                        </div>
                                    </button>
                                ))
                            }
                        </div>
                    )}

                    {/* PDFリスト */}
                    {tabFiles.filter(f => f.fileType === 'pdf').map(file => (
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

            {/* ライトボックス */}
            {lightboxOpen && (
                <ImageLightbox
                    images={tabImages}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </div>
    );
}
