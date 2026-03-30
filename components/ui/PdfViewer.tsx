'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ChevronLeft, ChevronRight, Loader2, X, ZoomIn, ZoomOut, Maximize } from 'lucide-react';

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

export function PdfViewer({ url, fileName, onClose }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [PdfDocument, setPdfDocument] = useState<DocumentComponent | null>(null);
    const [PdfPage, setPdfPage] = useState<PageComponent | null>(null);
    const [mounted, setMounted] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const transformRef = useRef<ReactZoomPanPinchRef>(null);

    // createPortal はクライアント側のみ
    useEffect(() => setMounted(true), []);

    // コンテナサイズを測定
    useEffect(() => {
        const measure = () => {
            if (containerRef.current) {
                setContainerSize({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
            }
        };
        const timer = setTimeout(measure, 50);
        window.addEventListener('resize', measure);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', measure);
        };
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

    // body スクロール無効化
    useEffect(() => {
        const original = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = original; };
    }, []);

    // ページ切り替え時にズームリセット
    useEffect(() => {
        transformRef.current?.resetTransform();
    }, [pageNumber]);

    // PDFページの描画幅（コンテナの90%、最大900px）
    const pageRenderWidth = Math.max(0, Math.min(Math.floor(containerSize.width * 0.9), 900));
    const showFooter = numPages > 1;

    if (!mounted) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[200] bg-black flex flex-col select-none pwa-modal-safe"
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            {/* ===== ヘッダー ===== */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <span className="text-white/70 text-sm truncate max-w-xs md:max-w-md" title={fileName}>
                    {fileName}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                    {showFooter && (
                        <span className="text-white/50 text-sm tabular-nums">
                            {pageNumber} / {numPages}
                        </span>
                    )}
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

            {/* ===== PDFコンテンツエリア ===== */}
            <div ref={containerRef} className="flex-1 relative overflow-hidden bg-slate-700">
                {/* ページナビ矢印 */}
                {showFooter && (
                    <>
                        <button
                            type="button"
                            onClick={() => setPageNumber(p => Math.max(p - 1, 1))}
                            disabled={pageNumber <= 1}
                            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-3 min-w-[44px] min-h-[44px] bg-black/50 hover:bg-black/70 disabled:opacity-30 rounded-full transition-colors"
                            aria-label="前のページ"
                        >
                            <ChevronLeft className="w-6 h-6 text-white" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPageNumber(p => Math.min(p + 1, numPages))}
                            disabled={pageNumber >= numPages}
                            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-3 min-w-[44px] min-h-[44px] bg-black/50 hover:bg-black/70 disabled:opacity-30 rounded-full transition-colors"
                            aria-label="次のページ"
                        >
                            <ChevronRight className="w-6 h-6 text-white" />
                        </button>
                    </>
                )}

                {!PdfDocument ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                        <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                    </div>
                ) : (
                    <PdfDocument
                        file={url}
                        onLoadSuccess={({ numPages: n }) => { setNumPages(n); setPageNumber(1); }}
                        loading={
                            <div className="flex flex-col items-center justify-center h-full gap-3">
                                <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                                <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                            </div>
                        }
                        error={
                            <div className="flex flex-col items-center justify-center h-full gap-4 text-white px-6 text-center">
                                <p>PDFの読み込みに失敗しました</p>
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-4 py-2 bg-white/20 rounded-lg text-sm"
                                >
                                    外部ブラウザで開く
                                </a>
                            </div>
                        }
                    >
                        {PdfPage && pageRenderWidth > 0 && (
                            <TransformWrapper
                                ref={transformRef}
                                initialScale={1}
                                minScale={0.3}
                                maxScale={10}
                                centerOnInit
                                pinch={{ disabled: true }}
                                doubleClick={{ disabled: true }}
                                wheel={{ step: 0.15 }}
                            >
                                <TransformComponent
                                    wrapperStyle={{ width: '100%', height: '100%', cursor: 'grab' }}
                                    contentStyle={{ width: '100%', height: '100%' }}
                                >
                                    <div style={{ width: '100%', height: containerSize.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <div className="bg-white shadow-lg">
                                            <PdfPage
                                                pageNumber={pageNumber}
                                                width={pageRenderWidth}
                                                renderTextLayer={false}
                                                renderAnnotationLayer={false}
                                            />
                                        </div>
                                    </div>
                                </TransformComponent>
                            </TransformWrapper>
                        )}
                    </PdfDocument>
                )}
            </div>

            {/* ===== 下部バー：ズームコントロール＋閉じるボタン ===== */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => transformRef.current?.zoomOut()}
                        className="p-3 min-w-[44px] min-h-[44px] bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                        aria-label="縮小"
                    >
                        <ZoomOut className="w-5 h-5 text-white" />
                    </button>
                    <button
                        type="button"
                        onClick={() => transformRef.current?.resetTransform()}
                        className="p-3 min-w-[44px] min-h-[44px] bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                        aria-label="リセット"
                    >
                        <Maximize className="w-5 h-5 text-white" />
                    </button>
                    <button
                        type="button"
                        onClick={() => transformRef.current?.zoomIn()}
                        className="p-3 min-w-[44px] min-h-[44px] bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                        aria-label="拡大"
                    >
                        <ZoomIn className="w-5 h-5 text-white" />
                    </button>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center gap-2 px-5 py-3 min-h-[44px] bg-white/15 hover:bg-white/25 active:bg-white/30 rounded-xl transition-colors"
                    aria-label="閉じる"
                >
                    <X className="w-5 h-5 text-white" />
                    <span className="text-white text-sm font-medium">閉じる</span>
                </button>
            </div>
        </div>,
        document.body
    );
}
