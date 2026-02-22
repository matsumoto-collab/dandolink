'use client';

import { useEffect, useState, useRef } from 'react';
import { X, ExternalLink, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PdfViewerProps {
    url: string;
    fileName: string;
    onClose: () => void;
}

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
}>;

const HEADER_H = 56; // px
const FOOTER_H = 56; // px

export function PdfViewer({ url, fileName, onClose }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [pageWidth, setPageWidth] = useState(0);
    const [PdfDocument, setPdfDocument] = useState<DocumentComponent | null>(null);
    const [PdfPage, setPdfPage] = useState<PageComponent | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    // コンテナ幅を測定
    useEffect(() => {
        const measure = () => {
            if (scrollAreaRef.current) {
                setPageWidth(scrollAreaRef.current.clientWidth - 8);
            }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    // react-pdf をクライアント側のみで動的ロード
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

    // キーボード操作
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') setPageNumber(p => Math.min(p + 1, numPages));
            if (e.key === 'ArrowLeft') setPageNumber(p => Math.max(p - 1, 1));
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose, numPages]);

    const showFooter = numPages > 1;

    return (
        <div className="fixed inset-0 lg:left-64 z-[100] bg-black/95">
            {/* ヘッダー（絶対配置・常に最前面） */}
            <div
                className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 bg-black/80"
                style={{ height: HEADER_H }}
            >
                <span className="text-white/80 text-sm truncate max-w-[55vw]" title={fileName}>
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
                        className="flex items-center gap-1 px-3 py-2 min-h-[44px] text-sm text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                    >
                        <ExternalLink className="w-4 h-4" />
                        <span className="hidden sm:inline ml-1">外部で開く</span>
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

            {/* PDFスクロールエリア（ヘッダー・フッター分だけ内側に） */}
            <div
                ref={scrollAreaRef}
                className="absolute left-0 right-0 overflow-y-auto overflow-x-hidden bg-gray-700 flex justify-center"
                style={{
                    top: HEADER_H,
                    bottom: showFooter ? FOOTER_H : 0,
                }}
            >
                {!PdfDocument ? (
                    <div className="flex items-center gap-2 text-white mt-16">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span>読み込み中...</span>
                    </div>
                ) : (
                    <PdfDocument
                        file={url}
                        onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPageNumber(1); }}
                        loading={
                            <div className="flex items-center gap-2 text-white mt-16">
                                <Loader2 className="w-6 h-6 animate-spin" />
                                <span>読み込み中...</span>
                            </div>
                        }
                        error={
                            <div className="flex flex-col items-center gap-4 text-white mt-16 px-6 text-center">
                                <p>PDFの読み込みに失敗しました</p>
                                <a href={url} target="_blank" rel="noopener noreferrer"
                                    className="px-4 py-2 bg-white/20 rounded-lg text-sm">
                                    外部ブラウザで開く
                                </a>
                            </div>
                        }
                    >
                        {PdfPage && pageWidth > 0 && (
                            <PdfPage
                                pageNumber={pageNumber}
                                width={Math.min(pageWidth, 900)}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                            />
                        )}
                    </PdfDocument>
                )}
            </div>

            {/* フッター・ページナビ（絶対配置・常に最前面） */}
            {showFooter && (
                <div
                    className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-6 bg-black/80"
                    style={{ height: FOOTER_H }}
                >
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
