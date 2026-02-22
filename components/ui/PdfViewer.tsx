'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, ExternalLink, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PdfViewerProps {
    url: string;
    fileName: string;
    onClose: () => void;
}

// react-pdf の型だけ import（バンドルには含まれない）
type DocumentComponent = React.ComponentType<{
    file: string;
    onLoadSuccess: (pdf: { numPages: number }) => void;
    loading?: React.ReactNode;
    error?: React.ReactNode;
    children?: React.ReactNode;
}>;
type PageComponent = React.ComponentType<{
    pageNumber: number;
    width?: number;
    renderTextLayer?: boolean;
    renderAnnotationLayer?: boolean;
    className?: string;
}>;

export function PdfViewer({ url, fileName, onClose }: PdfViewerProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [containerWidth, setContainerWidth] = useState(0);
    const [PdfDocument, setPdfDocument] = useState<DocumentComponent | null>(null);
    const [PdfPage, setPdfPage] = useState<PageComponent | null>(null);

    const containerRef = useCallback((node: HTMLDivElement | null) => {
        if (node) setContainerWidth(node.clientWidth);
    }, []);

    // クライアント側でのみ react-pdf を動的ロード
    useEffect(() => {
        let cancelled = false;
        import('react-pdf').then(({ Document, Page, pdfjs }) => {
            if (cancelled) return;
            pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            setPdfDocument(() => Document as unknown as DocumentComponent);
            setPdfPage(() => Page as unknown as PageComponent);
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') setPageNumber(p => Math.min(p + 1, numPages));
            if (e.key === 'ArrowLeft') setPageNumber(p => Math.max(p - 1, 1));
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose, numPages]);

    return (
        <div className="fixed inset-0 lg:left-64 z-[100] flex flex-col bg-black/95">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-black/60">
                <span className="text-white/80 text-sm truncate max-w-[50vw]" title={fileName}>
                    {fileName}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                    {numPages > 1 && (
                        <span className="text-white/50 text-sm tabular-nums">
                            {pageNumber} / {numPages}
                        </span>
                    )}
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
            <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden flex justify-center bg-gray-700">
                {!PdfDocument ? (
                    <div className="flex items-center justify-center h-full text-white gap-2 pt-20">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span>読み込み中...</span>
                    </div>
                ) : (
                    <PdfDocument
                        file={url}
                        onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPageNumber(1); }}
                        loading={
                            <div className="flex items-center justify-center h-full text-white gap-2 pt-20">
                                <Loader2 className="w-6 h-6 animate-spin" />
                                <span>読み込み中...</span>
                            </div>
                        }
                        error={
                            <div className="flex flex-col items-center justify-center h-full text-white gap-4 pt-20 px-6 text-center">
                                <p>PDFの読み込みに失敗しました</p>
                                <a href={url} target="_blank" rel="noopener noreferrer"
                                    className="px-4 py-2 bg-white/20 rounded-lg text-sm hover:bg-white/30 transition-colors">
                                    外部ブラウザで開く
                                </a>
                            </div>
                        }
                    >
                        {PdfPage && (
                            <PdfPage
                                pageNumber={pageNumber}
                                width={containerWidth > 0 ? Math.min(containerWidth - 16, 900) : undefined}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                className="my-2 shadow-lg"
                            />
                        )}
                    </PdfDocument>
                )}
            </div>

            {/* ページナビゲーション */}
            {numPages > 1 && (
                <div className="flex items-center justify-center gap-4 py-3 shrink-0 bg-black/60">
                    <button
                        type="button"
                        onClick={() => setPageNumber(p => Math.max(p - 1, 1))}
                        disabled={pageNumber <= 1}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded-full transition-colors"
                        aria-label="前のページ"
                    >
                        <ChevronLeft className="w-5 h-5 text-white" />
                    </button>
                    <span className="text-white text-sm tabular-nums">
                        {pageNumber} / {numPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPageNumber(p => Math.min(p + 1, numPages))}
                        disabled={pageNumber >= numPages}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded-full transition-colors"
                        aria-label="次のページ"
                    >
                        <ChevronRight className="w-5 h-5 text-white" />
                    </button>
                </div>
            )}
        </div>
    );
}
