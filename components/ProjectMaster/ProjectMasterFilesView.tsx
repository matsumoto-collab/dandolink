'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { FileText, Folder, X } from 'lucide-react';
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
    const [selectedCategory, setSelectedCategory] = useState<CategoryKey | null>(null);
    const [lightboxImages, setLightboxImages] = useState<{ src: string; alt: string }[]>([]);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [pdfView, setPdfView] = useState<{ url: string; name: string } | null>(null);

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
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={`h-11 rounded-xl bg-gray-200 animate-pulse ${i === 5 ? 'col-span-2' : ''}`} />
                ))}
            </div>
        );
    }

    const selectedFiles = selectedCategory ? files.filter(f => f.category === selectedCategory) : [];
    const selectedImages = selectedFiles
        .filter(f => f.fileType === 'image' && f.signedUrl)
        .map(f => ({ src: f.signedUrl!, alt: f.fileName }));
    const selectedPdfs = selectedFiles.filter(f => f.fileType === 'pdf');
    const selectedLabel = CATEGORIES.find(c => c.key === selectedCategory)?.label ?? '';

    return (
        <div className="space-y-2">
            {/* フォルダカード一覧 */}
            <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map(({ key, label }, index) => {
                    const count = files.filter(f => f.category === key).length;
                    const hasFiles = count > 0;
                    const isLast = index === CATEGORIES.length - 1;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => hasFiles && setSelectedCategory(key)}
                            disabled={!hasFiles}
                            className={`
                                flex items-center gap-2 px-3 py-3 rounded-xl border text-left transition-colors min-h-[44px]
                                ${isLast ? 'col-span-2' : ''}
                                ${hasFiles
                                    ? 'bg-gray-50 border-gray-200 hover:bg-slate-100 active:bg-slate-200 cursor-pointer'
                                    : 'bg-gray-50 border-gray-100 opacity-40 cursor-default'}
                            `}
                        >
                            <Folder className={`w-4 h-4 shrink-0 ${hasFiles ? 'text-slate-500' : 'text-gray-300'}`} />
                            <span className="text-sm text-gray-700 flex-1 truncate">{label}</span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${hasFiles ? 'bg-slate-100 text-slate-600' : 'bg-gray-100 text-gray-400'}`}>
                                {count}件
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* フォルダ中身モーダル
                モバイル: 下から出るボトムシート
                PC(sm+): 画面中央のモーダル */}
            {selectedCategory && (
                <div
                    className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4 bg-black/50"
                    onClick={(e) => e.target === e.currentTarget && setSelectedCategory(null)}
                >
                    <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg flex flex-col max-h-[85vh] sm:max-h-[80vh]">
                        {/* モバイル用ドラッグハンドル */}
                        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
                            <div className="w-10 h-1 bg-gray-300 rounded-full" />
                        </div>

                        {/* ヘッダー */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
                            <div className="flex items-center gap-2">
                                <Folder className="w-4 h-4 text-slate-500" />
                                <span className="font-medium text-gray-800">{selectedLabel}</span>
                                <span className="text-xs text-gray-400">{selectedFiles.length}件</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedCategory(null)}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* コンテンツ */}
                        <div className="overflow-y-auto p-4 space-y-4">
                            {/* 画像グリッド: 3列・正方形 */}
                            {selectedImages.length > 0 && (
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                    {selectedImages.map((img, idx) => (
                                        <button
                                            key={img.src}
                                            type="button"
                                            onClick={() => {
                                                setLightboxImages(selectedImages);
                                                setLightboxIndex(idx);
                                                setLightboxOpen(true);
                                            }}
                                            className="relative aspect-square overflow-hidden rounded-lg border border-gray-200 hover:opacity-80 active:opacity-60 transition-opacity"
                                        >
                                            <Image
                                                src={img.src}
                                                alt={img.alt}
                                                fill
                                                sizes="(max-width: 640px) 30vw, 120px"
                                                className="object-cover"
                                            />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* PDFリスト */}
                            {selectedPdfs.length > 0 && (
                                <div className="space-y-2">
                                    {selectedPdfs.map(file => (
                                        <button
                                            key={file.id}
                                            type="button"
                                            onClick={() => file.signedUrl && setPdfView({ url: file.signedUrl, name: file.fileName })}
                                            className="w-full flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200 hover:bg-gray-100 active:bg-gray-200 transition-colors text-left min-h-[56px]"
                                        >
                                            <div className="w-10 h-10 flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200 shrink-0">
                                                <FileText className="w-5 h-5 text-slate-400" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-600 truncate">{file.fileName}</p>
                                                <p className="text-xs text-gray-400 mt-0.5">{formatFileSize(file.fileSize)}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* PDFビューアモーダル（全画面） */}
            {pdfView && (
                <div className="fixed inset-0 z-[60] flex flex-col bg-black/90">
                    <div className="flex items-center justify-between px-4 bg-gray-900 shrink-0 min-h-[56px]">
                        <span className="text-sm text-white truncate flex-1 mr-3">{pdfView.name}</span>
                        <button
                            type="button"
                            onClick={() => setPdfView(null)}
                            className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <iframe
                        src={pdfView.url}
                        className="flex-1 w-full"
                        title={pdfView.name}
                    />
                </div>
            )}

            {/* 画像ライトボックス */}
            {lightboxOpen && (
                <ImageLightbox
                    images={lightboxImages}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </div>
    );
}
