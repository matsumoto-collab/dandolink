'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, ExternalLink, ChevronLeft, ChevronRight, Loader2, ArrowLeft, ZoomIn, ZoomOut } from 'lucide-react';

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
    scale?: number;
    renderTextLayer?: boolean;
    renderAnnotationLayer?: boolean;
}>;

const HEADER_H = 52; // px
const FOOTER_H = 64; // px — ページ送りボタン + iOSセーフエリア分

export function PdfViewer({ url, fileName, onClose }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [pageWidth, setPageWidth] = useState(0);
    const [scale, setScale] = useState(1);
    const [PdfDocument, setPdfDocument] = useState<DocumentComponent | null>(null);
    const [PdfPage, setPdfPage] = useState<PageComponent | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    // ピンチズーム用のタッチ状態管理
    const pinchRef = useRef<{ initialDistance: number; initialScale: number } | null>(null);

    const MIN_SCALE = 0.5;
    const MAX_SCALE = 3;

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
            if (e.key === '+' || e.key === '=') setScale(s => Math.min(s + 0.25, MAX_SCALE));
            if (e.key === '-') setScale(s => Math.max(s - 0.25, MIN_SCALE));
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose, numPages]);

    // ピンチズームのタッチイベント
    const getDistance = (touches: React.TouchList) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            pinchRef.current = {
                initialDistance: getDistance(e.touches),
                initialScale: scale,
            };
        }
    }, [scale]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 2 && pinchRef.current) {
            e.preventDefault();
            const currentDistance = getDistance(e.touches);
            const ratio = currentDistance / pinchRef.current.initialDistance;
            const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchRef.current.initialScale * ratio));
            setScale(newScale);
        }
    }, []);

    const handleTouchEnd = useCallback(() => {
        pinchRef.current = null;
    }, []);

    const showFooter = numPages > 1;

    return (
        <div className="fixed inset-0 z-[100] bg-black/95">
            {/* ヘッダー（絶対配置・常に最前面） */}
            <div
                className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-2 bg-black/80"
                style={{ height: HEADER_H, paddingTop: 'env(safe-area-inset-top, 0px)' }}
            >
                {/* 戻るボタン + ファイル名 */}
                <div className="flex items-center gap-1 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors shrink-0"
                        aria-label="戻る"
                    >
                        <ArrowLeft className="w-5 h-5 text-white" />
                    </button>
                    <span className="text-white/80 text-sm truncate" title={fileName}>
                        {fileName}
                    </span>
                </div>

                {/* 右側ボタン */}
                <div className="flex items-center gap-1 shrink-0">
                    {/* ズームボタン */}
                    <button
                        type="button"
                        onClick={() => setScale(s => Math.max(s - 0.25, MIN_SCALE))}
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors"
                        aria-label="縮小"
                    >
                        <ZoomOut className="w-4 h-4 text-white/70" />
                    </button>
                    <span className="text-white/50 text-xs tabular-nums w-10 text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        type="button"
                        onClick={() => setScale(s => Math.min(s + 0.25, MAX_SCALE))}
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors"
                        aria-label="拡大"
                    >
                        <ZoomIn className="w-4 h-4 text-white/70" />
                    </button>

                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                        aria-label="外部で開く"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5 text-white" />
                    </button>
                </div>
            </div>

            {/* PDFスクロールエリア（ヘッダー・フッター分だけ内側に） */}
            <div
                ref={scrollAreaRef}
                className="absolute left-0 right-0 overflow-auto bg-gray-700 flex justify-center items-start"
                style={{
                    top: HEADER_H,
                    bottom: showFooter ? FOOTER_H : 0,
                    WebkitOverflowScrolling: 'touch',
                    touchAction: 'pan-x pan-y',
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {!PdfDocument ? (
                    <div className="flex flex-col items-center gap-3 text-white mt-24">
                        <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                        <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                    </div>
                ) : (
                    <div
                        className="flex justify-center py-4"
                        style={{ minHeight: '100%' }}
                    >
                        <PdfDocument
                            file={url}
                            onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPageNumber(1); }}
                            loading={
                                <div className="flex flex-col items-center gap-3 text-white mt-24">
                                    <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                                    <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                                </div>
                            }
                            error={
                                <div className="flex flex-col items-center gap-4 text-white mt-24 px-6 text-center">
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
                                    scale={scale}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                />
                            )}
                        </PdfDocument>
                    </div>
                )}
            </div>

            {/* フッター・ページナビ（セーフエリア分上げる） */}
            {showFooter && (
                <div
                    className="absolute left-0 right-0 z-10 flex items-center justify-center gap-6 bg-black/80"
                    style={{
                        bottom: 0,
                        height: FOOTER_H,
                        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                    }}
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
