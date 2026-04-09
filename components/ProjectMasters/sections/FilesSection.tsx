'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { FileText, Trash2, Upload, Loader2, Download, ChevronDown } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import toast from 'react-hot-toast';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { ImageLightbox } from '@/components/ui/ImageLightbox';

const PdfViewer = dynamic(
    () => import('@/components/ui/PdfViewer').then(m => m.PdfViewer),
    { ssr: false }
);

type FileCategory = 'survey' | 'assembly' | 'demolition' | 'other' | 'instruction' | 'document';

const ALL_CATEGORIES: { key: FileCategory; label: string; adminOnly?: boolean }[] = [
    { key: 'survey',      label: '現調写真' },
    { key: 'assembly',    label: '組立' },
    { key: 'demolition',  label: '解体' },
    { key: 'other',       label: 'その他' },
    { key: 'instruction', label: '指示書/図面' },
    { key: 'document',    label: '書類', adminOnly: true },
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
    originalSignedUrl: string | null;
    originalStoragePath: string | null;
    sourceType: string | null;
}

/** PDF の各ページを canvas 経由で WebP Blob に変換する */
async function pdfToImages(pdfFile: Blob): Promise<{ blob: Blob; name: string }[]> {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const results: { blob: Blob; name: string }[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 2; // 高解像度
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;

        const blob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((b) => resolve(b!), 'image/webp', 0.85);
        });
        results.push({ blob, name: `page_${i}.webp` });
        canvas.remove();
    }

    return results;
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
    const { data: session } = useSession();
    const isAdminOrManager = session?.user?.role === 'admin' || session?.user?.role === 'manager';
    const CATEGORIES = ALL_CATEGORIES.filter(c => !c.adminOnly || isAdminOrManager);

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

    const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

    const handleUpload = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;

        const rawFiles = Array.from(fileList);
        setUploading(true);
        setUploadProgress({ done: 0, total: rawFiles.length });

        // 1. PDF→画像変換 + 画像圧縮
        // uploadItems: { file, name, originalPdf? }
        type UploadItem = { file: Blob; name: string; originalPdf?: Blob; originalPdfName?: string };
        const uploadItems: UploadItem[] = [];

        for (const rawFile of rawFiles) {
            if (rawFile.type === 'application/pdf') {
                // PDF → 各ページを画像に変換
                try {
                    toast('PDFを画像に変換中...', { icon: '📄' });
                    const pages = await pdfToImages(rawFile);
                    const baseName = rawFile.name.replace(/\.pdf$/i, '');
                    pages.forEach((page, idx) => {
                        uploadItems.push({
                            file: page.blob,
                            name: `${baseName}_p${idx + 1}.webp`,
                            // 最初のページにのみ元PDFを添付
                            ...(idx === 0 ? { originalPdf: rawFile, originalPdfName: rawFile.name } : {}),
                        });
                    });
                } catch (err) {
                    console.error('PDF conversion failed:', err);
                    toast.error(`PDF変換に失敗しました: ${rawFile.name}`);
                }
            } else if (rawFile.type.startsWith('image/') && rawFile.size > 3 * 1024 * 1024) {
                try {
                    const blob = await imageCompression(rawFile, {
                        maxSizeMB: 3,
                        maxWidthOrHeight: 3000,
                        useWebWorker: true,
                        initialQuality: 0.9,
                    });
                    uploadItems.push({ file: blob, name: rawFile.name });
                } catch {
                    uploadItems.push({ file: rawFile as Blob, name: rawFile.name });
                }
            } else {
                uploadItems.push({ file: rawFile as Blob, name: rawFile.name });
            }
        }

        setUploadProgress({ done: 0, total: uploadItems.length });

        // 2. 5枚ずつ並列アップロード
        let successCount = 0;
        let doneCount = 0;
        const CONCURRENCY = 5;
        for (let i = 0; i < uploadItems.length; i += CONCURRENCY) {
            const batch = uploadItems.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(async (item) => {
                    const formData = new FormData();
                    formData.append('file', item.file, item.name);
                    formData.append('category', activeTab);
                    if (item.originalPdf) {
                        formData.append('originalPdf', item.originalPdf, item.originalPdfName || 'original.pdf');
                    }
                    const res = await fetch(`/api/project-masters/${projectMasterId}/files`, {
                        method: 'POST',
                        body: formData,
                    });
                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || 'アップロード失敗');
                    }
                    const data = await res.json();
                    doneCount++;
                    setUploadProgress({ done: doneCount, total: uploadItems.length });
                    return data as ProjectMasterFileData;
                })
            );
            const newFiles: ProjectMasterFileData[] = [];
            for (const r of results) {
                if (r.status === 'fulfilled') {
                    successCount++;
                    newFiles.push(r.value);
                } else {
                    doneCount++;
                    setUploadProgress({ done: doneCount, total: uploadItems.length });
                    toast.error(r.reason?.message || 'アップロードに失敗しました');
                }
            }
            if (newFiles.length > 0) {
                setFiles(prev => [...newFiles, ...prev]);
            }
        }

        if (successCount > 0) {
            toast.success(`${successCount}件のファイルをアップロードしました`);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
        setUploading(false);
        setUploadProgress(null);
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

    const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);

    const handleDownload = (file: ProjectMasterFileData, format?: string) => {
        const params = new URLSearchParams();
        if (format) {
            params.set('format', format);
        } else {
            params.set('quality', file.originalStoragePath ? 'original' : 'display');
        }
        const url = `/api/project-masters/${projectMasterId}/files/${file.id}?${params}`;
        window.open(url, '_blank');
        setDownloadMenuId(null);
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
                        <span className="text-sm">
                            アップロード中...{uploadProgress ? ` (${uploadProgress.done}/${uploadProgress.total})` : ''}
                        </span>
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

                            {/* ダウンロード・削除ボタン */}
                            <div className="flex items-center gap-1 shrink-0">
                                {file.sourceType === 'pdf' ? (
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setDownloadMenuId(downloadMenuId === file.id ? null : file.id)}
                                            className="flex items-center gap-0.5 p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-50 rounded transition-colors"
                                            title="形式を選んでダウンロード"
                                        >
                                            <Download className="w-4 h-4" />
                                            <ChevronDown className="w-3 h-3" />
                                        </button>
                                        {downloadMenuId === file.id && (
                                            <>
                                                <div className="fixed inset-0 z-10" onClick={() => setDownloadMenuId(null)} />
                                                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[120px]">
                                                    {['PDF', 'JPEG', 'PNG', 'WebP'].map((fmt) => (
                                                        <button
                                                            key={fmt}
                                                            type="button"
                                                            onClick={() => handleDownload(file, fmt.toLowerCase())}
                                                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                                        >
                                                            {fmt}
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleDownload(file)}
                                        className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-50 rounded transition-colors"
                                        title={file.originalStoragePath ? '元画像をダウンロード' : 'ダウンロード'}
                                    >
                                        <Download className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleDelete(file.id, file.fileName)}
                                    disabled={deletingId === file.id}
                                    className="p-1.5 text-slate-400 hover:text-slate-500 hover:bg-slate-50 rounded transition-colors"
                                    title="削除"
                                >
                                    {deletingId === file.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Trash2 className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
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
