'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { FileText, Trash2, Upload, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import dynamic from 'next/dynamic';
import { ImageLightbox } from '@/components/ui/ImageLightbox';

const PdfViewer = dynamic(
    () => import('@/components/ui/PdfViewer').then(m => m.PdfViewer),
    { ssr: false }
);

type FileCategory = 'survey' | 'assembly' | 'demolition' | 'other' | 'instruction';

const CATEGORIES: { key: FileCategory; label: string }[] = [
    { key: 'survey',      label: '現調写真' },
    { key: 'assembly',    label: '組立' },
    { key: 'demolition',  label: '解体' },
    { key: 'other',       label: 'その他' },
    { key: 'instruction', label: '指示書/図面' },
];

interface ProjectMasterFileData {
    id: string;
    fileName: string;
    storagePath: string;
    fileType: string;
    mimeType: string;
    fileSize: number;
    category: string;
    description: string | null;
    createdAt: string;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
}

interface FilesSectionProps {
    projectMasterId: string;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesSection({ projectMasterId }: FilesSectionProps) {
    const [files, setFiles] = useState<ProjectMasterFileData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<FileCategory>('survey');
    const [uploading, setUploading] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [pdfPreview, setPdfPreview] = useState<{ url: string; fileName: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchFiles = useCallback(async () => {
        try {
            const res = await fetch(`/api/project-masters/${projectMasterId}/files`);
            if (!res.ok) throw new Error('取得失敗');
            const data = await res.json();
            setFiles(data);
        } catch {
            toast.error('ファイル一覧の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [projectMasterId]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const handleUpload = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;

        setUploading(true);
        let successCount = 0;

        for (const rawFile of Array.from(fileList)) {
            const formData = new FormData();
            formData.append('file', rawFile);
            formData.append('category', activeTab);

            try {
                const res = await fetch(`/api/project-masters/${projectMasterId}/files`, {
                    method: 'POST',
                    body: formData,
                });
                if (!res.ok) {
                    const err = await res.json();
                    toast.error(`${rawFile.name}: ${err.error || 'アップロード失敗'}`);
                } else {
                    successCount++;
                }
            } catch {
                toast.error(`${rawFile.name}: アップロードに失敗しました`);
            }
        }

        if (successCount > 0) {
            toast.success(`${successCount}件のファイルをアップロードしました`);
            await fetchFiles();
        }
        // input をリセット（同じファイルを再アップロードできるよう）
        if (fileInputRef.current) fileInputRef.current.value = '';
        setUploading(false);
    };

    const handleDelete = async (fileId: string, fileName: string) => {
        if (!confirm(`「${fileName}」を削除しますか？`)) return;

        setDeletingId(fileId);
        try {
            const res = await fetch(
                `/api/project-masters/${projectMasterId}/files/${fileId}`,
                { method: 'DELETE' }
            );
            if (!res.ok) throw new Error('削除失敗');
            toast.success('ファイルを削除しました');
            setFiles(prev => prev.filter(f => f.id !== fileId));
        } catch {
            toast.error('ファイルの削除に失敗しました');
        } finally {
            setDeletingId(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        handleUpload(e.dataTransfer.files);
    };

    const tabFiles = files.filter(f => f.category === activeTab);
    const tabImages = tabFiles
        .filter(f => f.fileType === 'image' && f.signedUrl)
        .map(f => ({ src: f.signedUrl!, alt: f.fileName, thumbnail: f.thumbnailSignedUrl || f.signedUrl! }));

    if (isLoading) {
        return (
            <div className="space-y-3">
                {/* タブスケルトン */}
                <div className="flex gap-1">
                    {[80, 48, 48, 64, 72].map((w, i) => (
                        <div key={i} className={`h-7 rounded-full bg-slate-200 animate-pulse`} style={{ width: w }} />
                    ))}
                </div>
                {/* ファイル行スケルトン */}
                {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="w-12 h-12 rounded bg-slate-200 animate-pulse shrink-0" />
                        <div className="flex-1 space-y-2">
                            <div className="h-3.5 bg-slate-200 animate-pulse rounded w-2/3" />
                            <div className="h-3 bg-slate-100 animate-pulse rounded w-1/3" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* カテゴリタブ（モバイルで横スクロール） */}
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                {CATEGORIES.map(({ key, label }) => {
                    const count = files.filter(f => f.category === key).length;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setActiveTab(key)}
                            className={`
                                shrink-0 px-3 py-2 rounded-full text-xs font-medium transition-colors min-h-[36px]
                                ${activeTab === key
                                    ? 'bg-slate-700 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 active:bg-slate-300'}
                            `}
                        >
                            {label}
                            {count > 0 && (
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === key ? 'bg-white/20' : 'bg-slate-300'}`}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* アップロードエリア */}
            <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`
                    border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
                    ${isDragOver ? 'border-slate-400 bg-slate-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}
                    ${uploading ? 'pointer-events-none opacity-60' : ''}
                `}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => handleUpload(e.target.files)}
                    disabled={uploading}
                />
                {uploading ? (
                    <div className="flex items-center justify-center gap-2 text-slate-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">アップロード中...</span>
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                        <Upload className="w-4 h-4" />
                        <span className="text-sm">
                            「{CATEGORIES.find(c => c.key === activeTab)?.label}」にアップロード
                        </span>
                    </div>
                )}
                <p className="text-xs text-slate-400 mt-1">画像（JPG・PNG等）・PDF対応 / 最大20MB</p>
            </div>

            {/* ファイル一覧 */}
            {tabFiles.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-2">ファイルがありません</p>
            ) : (
                <div className="space-y-2">
                    {tabFiles.map((file) => (
                        <div
                            key={file.id}
                            className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200"
                        >
                            {/* サムネイル or PDF アイコン */}
                            {file.fileType === 'image' && file.signedUrl ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const idx = tabImages.findIndex(img => img.src === file.signedUrl);
                                        setLightboxIndex(idx >= 0 ? idx : 0);
                                        setLightboxOpen(true);
                                    }}
                                    className="shrink-0 hover:opacity-80 transition-opacity"
                                >
                                    <div className="relative w-12 h-12 overflow-hidden rounded border border-slate-200">
                                        <Image
                                            src={file.thumbnailSignedUrl || file.signedUrl}
                                            alt={file.fileName}
                                            fill
                                            sizes="48px"
                                            className="object-cover"
                                        />
                                    </div>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => file.signedUrl && setPdfPreview({ url: file.signedUrl, fileName: file.fileName })}
                                    className="shrink-0 w-12 h-12 flex items-center justify-center bg-slate-50 rounded border border-slate-200 hover:bg-slate-100 transition-colors"
                                >
                                    <FileText className="w-6 h-6 text-slate-400" />
                                </button>
                            )}

                            {/* ファイル情報 */}
                            <div className="flex-1 min-w-0">
                                {file.signedUrl ? (
                                    file.fileType === 'pdf' ? (
                                        <button
                                            type="button"
                                            onClick={() => setPdfPreview({ url: file.signedUrl!, fileName: file.fileName })}
                                            className="text-sm font-medium text-slate-600 hover:underline truncate block text-left w-full"
                                        >
                                            {file.fileName}
                                        </button>
                                    ) : (
                                        <a
                                            href={file.signedUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm font-medium text-slate-600 hover:underline truncate block"
                                        >
                                            {file.fileName}
                                        </a>
                                    )
                                ) : (
                                    <span className="text-sm font-medium text-slate-700 truncate block">
                                        {file.fileName}
                                    </span>
                                )}
                                <p className="text-xs text-slate-400">
                                    {formatFileSize(file.fileSize)} · {new Date(file.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                                </p>
                            </div>

                            {/* 削除ボタン */}
                            <button
                                type="button"
                                onClick={() => handleDelete(file.id, file.fileName)}
                                disabled={deletingId === file.id}
                                className="shrink-0 p-1.5 text-slate-400 hover:text-slate-500 hover:bg-slate-50 rounded transition-colors"
                                title="削除"
                            >
                                {deletingId === file.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Trash2 className="w-4 h-4" />
                                )}
                            </button>
                        </div>
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

            {/* PDFビューア */}
            {pdfPreview && (
                <PdfViewer
                    url={pdfPreview.url}
                    fileName={pdfPreview.fileName}
                    onClose={() => setPdfPreview(null)}
                />
            )}
        </div>
    );
}
