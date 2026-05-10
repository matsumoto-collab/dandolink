'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { FileText, Folder, X, Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { ImageLightbox } from '@/components/ui/ImageLightbox';

const PdfViewer = dynamic(
    () => import('@/components/ui/PdfViewer').then(m => m.PdfViewer),
    { ssr: false }
);

const ALL_CATEGORIES = [
    { key: 'survey', label: '現調写真' },
    { key: 'assembly', label: '組立' },
    { key: 'demolition', label: '解体' },
    { key: 'other', label: 'その他' },
    { key: 'instruction', label: '指示書/図面' },
    { key: 'document', label: '書類', adminOnly: true },
] as const;

type CategoryKey = typeof ALL_CATEGORIES[number]['key'];

interface ProjectMasterFileData {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    category: string;
    createdAt: string;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    originalStoragePath: string | null;
    sourceType: string | null;
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
    const { data: session } = useSession();
    const isAdminOrManager = session?.user?.role === 'admin' || session?.user?.role === 'manager';
    const CATEGORIES = ALL_CATEGORIES.filter(c => !('adminOnly' in c && c.adminOnly) || isAdminOrManager);

    const [files, setFiles] = useState<ProjectMasterFileData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState<CategoryKey | null>(null);
    const [lightboxImages, setLightboxImages] = useState<{ src: string; alt: string }[]>([]);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [pdfView, setPdfView] = useState<{ url: string; name: string } | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    /**
     * PWAスタンドアロンモードでも確実に動くダウンロード処理:
     * fetch → Blob → object URL → <a download> → click → revoke
     * (window.open は iOS PWA で無反応になることがあるため使わない)
     */
    const handleDownload = useCallback(async (file: ProjectMasterFileData, format?: string) => {
        if (downloadingId) return;
        if (!projectMasterId) return;
        setDownloadingId(file.id);
        try {
            const params = new URLSearchParams();
            if (format) {
                params.set('format', format);
            } else {
                params.set('quality', file.originalStoragePath ? 'original' : 'display');
            }
            const apiUrl = `/api/project-masters/${projectMasterId}/files/${file.id}?${params}`;

            const res = await fetch(apiUrl, { cache: 'no-store' });
            if (!res.ok) throw new Error('download failed');
            const blob = await res.blob();

            // 形式変換時は拡張子を差し替え
            let downloadName = file.fileName;
            if (format) {
                const base = file.fileName.replace(/\.[^.]+$/, '');
                const ext = format === 'jpeg' ? 'jpg' : format;
                downloadName = `${base}.${ext}`;
            }

            const fileObj = new File([blob], downloadName, { type: blob.type || 'application/octet-stream' });
            const nav = navigator as Navigator & {
                canShare?: (data: { files: File[] }) => boolean;
                share?: (data: { files: File[]; title?: string }) => Promise<void>;
            };
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            if (isMobile && nav.canShare && nav.share && nav.canShare({ files: [fileObj] })) {
                try {
                    await nav.share({ files: [fileObj], title: downloadName });
                    return;
                } catch (e) {
                    if ((e as Error)?.name === 'AbortError') return;
                }
            }

            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = downloadName;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch {
            toast.error('ダウンロードに失敗しました');
        } finally {
            setDownloadingId(null);
        }
    }, [downloadingId, projectMasterId]);

    const fetchFiles = useCallback(async () => {
        if (!projectMasterId) {
            setIsLoading(false);
            return;
        }
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
                    <div key={i} className={`h-11 rounded-xl bg-slate-200 animate-pulse ${i === 5 ? 'col-span-2' : ''}`} />
                ))}
            </div>
        );
    }

    const selectedFiles = selectedCategory ? files.filter(f => f.category === selectedCategory) : [];
    const selectedImageFiles = selectedFiles.filter(f => f.fileType === 'image' && f.signedUrl);
    const selectedImages = selectedImageFiles.map(f => ({ src: f.signedUrl!, alt: f.fileName, thumbnail: f.thumbnailSignedUrl || f.signedUrl! }));
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
                                    ? 'bg-slate-50 border-slate-200 hover:bg-slate-100 active:bg-slate-200 cursor-pointer'
                                    : 'bg-slate-50 border-slate-100 opacity-40 cursor-default'}
                            `}
                        >
                            <Folder className={`w-4 h-4 shrink-0 ${hasFiles ? 'text-slate-500' : 'text-slate-300'}`} />
                            <span className="text-sm text-slate-700 flex-1 truncate">{label}</span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${hasFiles ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-400'}`}>
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
                            <div className="w-10 h-1 bg-slate-300 rounded-full" />
                        </div>

                        {/* ヘッダー */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
                            <div className="flex items-center gap-2">
                                <Folder className="w-4 h-4 text-slate-500" />
                                <span className="font-medium text-slate-800">{selectedLabel}</span>
                                <span className="text-xs text-slate-400">{selectedFiles.length}件</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedCategory(null)}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* コンテンツ */}
                        <div className="overflow-y-auto p-4 space-y-4">
                            {/* 画像グリッド: 3列・正方形（タップで拡大→ライトボックス内で保存） */}
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
                                            className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 hover:opacity-80 active:opacity-60 transition-opacity"
                                        >
                                            <Image
                                                src={img.thumbnail}
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
                                        <div
                                            key={file.id}
                                            className="w-full flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 min-h-[56px]"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => file.signedUrl && setPdfView({ url: file.signedUrl, name: file.fileName })}
                                                className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                                            >
                                                <div className="w-10 h-10 flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200 shrink-0">
                                                    <FileText className="w-5 h-5 text-slate-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-slate-600 truncate">{file.fileName}</p>
                                                    <p className="text-xs text-slate-400 mt-0.5">{formatFileSize(file.fileSize)}</p>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDownload(file)}
                                                disabled={downloadingId === file.id}
                                                className="shrink-0 p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center disabled:opacity-50"
                                                title="ダウンロード"
                                            >
                                                {downloadingId === file.id ? (
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                ) : (
                                                    <Download className="w-5 h-5" />
                                                )}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* PDFビューア（react-pdf） */}
            {pdfView && (
                <PdfViewer
                    url={pdfView.url}
                    fileName={pdfView.name}
                    onClose={() => setPdfView(null)}
                />
            )}

            {/* 画像ライトボックス（PWAでも保存ボタンから確実にダウンロード可能）
                元がPDFの画像は形式選択（PDF/JPEG/PNG/WebP）が出る */}
            {lightboxOpen && (
                <ImageLightbox
                    images={lightboxImages}
                    initialIndex={lightboxIndex}
                    onClose={() => setLightboxOpen(false)}
                    onDownload={(idx, format) => {
                        const file = selectedImageFiles[idx];
                        if (file) handleDownload(file, format);
                    }}
                    getDownloadFormats={(idx) => {
                        const file = selectedImageFiles[idx];
                        return file?.sourceType === 'pdf'
                            ? ['PDF', 'JPEG', 'PNG', 'WebP']
                            : undefined;
                    }}
                />
            )}
        </div>
    );
}
