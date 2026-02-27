'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Loader2, ArrowLeft, ZoomIn, ZoomOut } from 'lucide-react';

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

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function PdfViewer({ url, fileName, onClose }: PdfViewerProps) {
    const [numPages, setNumPages] = useState(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [containerWidth, setContainerWidth] = useState(0);
    const [scale, setScale] = useState(1);
    const [PdfDocument, setPdfDocument] = useState<DocumentComponent | null>(null);
    const [PdfPage, setPdfPage] = useState<PageComponent | null>(null);
    const [mounted, setMounted] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const lastPinchDist = useRef<number | null>(null);
    const gestureBaseScale = useRef(1);

    // ドラッグ移動用
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

    // createPortal はクライアント側のみ
    useEffect(() => setMounted(true), []);

    // コンテナ幅を測定（スケール計算の基準）
    useEffect(() => {
        const measure = () => {
            if (contentRef.current) {
                setContainerWidth(contentRef.current.clientWidth);
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

    // ピンチズーム: iOS Safari は GestureEvent API、その他は TouchEvent で対応
    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (isIOS) {
            const onGestureStart = (e: Event) => {
                e.preventDefault();
                gestureBaseScale.current = scale;
            };
            const onGestureChange = (e: Event) => {
                e.preventDefault();
                const ge = e as unknown as { scale: number };
                const newScale = gestureBaseScale.current * ge.scale;
                setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale)));
            };
            const onGestureEnd = (e: Event) => {
                e.preventDefault();
            };

            el.addEventListener('gesturestart', onGestureStart, { capture: true });
            el.addEventListener('gesturechange', onGestureChange, { capture: true });
            el.addEventListener('gestureend', onGestureEnd, { capture: true });
            return () => {
                el.removeEventListener('gesturestart', onGestureStart, { capture: true });
                el.removeEventListener('gesturechange', onGestureChange, { capture: true });
                el.removeEventListener('gestureend', onGestureEnd, { capture: true });
            };
        }

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                lastPinchDist.current = Math.hypot(
                    e.touches[1].clientX - e.touches[0].clientX,
                    e.touches[1].clientY - e.touches[0].clientY
                );
            }
        };
        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length !== 2) return;
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
            if (lastPinchDist.current !== null) {
                const ratio = dist / lastPinchDist.current;
                setScale(s => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * ratio)));
            }
            lastPinchDist.current = dist;
        };
        const onTouchEnd = () => { lastPinchDist.current = null; };

        el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
        el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
        return () => {
            el.removeEventListener('touchstart', onTouchStart, { capture: true });
            el.removeEventListener('touchmove', onTouchMove, { capture: true });
            el.removeEventListener('touchend', onTouchEnd, { capture: true });
        };
    }, [mounted, scale]);

    // マウスドラッグ移動
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const el = contentRef.current;
        if (!el) return;
        // ズームボタン上のクリックは無視
        if ((e.target as HTMLElement).closest('[data-zoom-controls]')) return;
        setIsDragging(true);
        dragStart.current = {
            x: e.clientX,
            y: e.clientY,
            scrollLeft: el.scrollLeft,
            scrollTop: el.scrollTop,
        };
        e.preventDefault();
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || !dragStart.current || !contentRef.current) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        contentRef.current.scrollLeft = dragStart.current.scrollLeft - dx;
        contentRef.current.scrollTop = dragStart.current.scrollTop - dy;
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        dragStart.current = null;
    }, []);

    const baseWidth = Math.min(containerWidth - 16, 900);
    const pageRenderWidth = Math.max(0, Math.floor(baseWidth * scale));
    const showFooter = numPages > 1;

    if (!mounted) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[200] bg-black flex flex-col"
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            {/* ===== ヘッダー ===== */}
            <div
                className="flex items-center justify-between px-2 bg-gray-900 shrink-0"
                style={{ minHeight: 48 }}
            >
                <div className="flex items-center gap-1 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 rounded-full transition-colors shrink-0"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="戻る"
                    >
                        <ArrowLeft className="w-5 h-5 text-white" />
                    </button>
                    <span className="text-white/80 text-sm truncate" title={fileName}>
                        {fileName}
                    </span>
                </div>
            </div>

            {/* ===== PDFコンテンツエリア ===== */}
            <div
                ref={contentRef}
                className="relative flex-1 overflow-auto bg-gray-700"
                style={{
                    overscrollBehavior: 'contain',
                    touchAction: scale > 1 ? 'pan-x pan-y pinch-zoom' : 'manipulation',
                    cursor: isDragging ? 'grabbing' : 'grab',
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <div
                    style={{ minHeight: '100%', padding: '16px 8px', width: 'fit-content', margin: '0 auto' }}
                >
                    {!PdfDocument ? (
                        <div className="flex flex-col items-center gap-3 mt-8">
                            <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                            <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                        </div>
                    ) : (
                        <PdfDocument
                            file={url}
                            onLoadSuccess={({ numPages: n }) => { setNumPages(n); setPageNumber(1); }}
                            loading={
                                <div className="flex flex-col items-center gap-3 mt-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                                    <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                                </div>
                            }
                            error={
                                <div className="flex flex-col items-center gap-4 text-white px-6 text-center mt-8">
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
                                <PdfPage
                                    pageNumber={pageNumber}
                                    width={pageRenderWidth}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                />
                            )}
                        </PdfDocument>
                    )}
                </div>

                {/* ===== ズームコントロール（PDFエリア上にオーバーレイ） ===== */}
                <div
                    data-zoom-controls
                    className="sticky bottom-4 flex justify-center pointer-events-none"
                    style={{ marginTop: -52 }}
                >
                    <div className="pointer-events-auto flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded-full px-2 py-1 opacity-60 sm:opacity-40 sm:hover:opacity-100 active:opacity-100 transition-opacity duration-200">
                        <button
                            type="button"
                            onClick={() => setScale(s => Math.max(s - 0.25, MIN_SCALE))}
                            disabled={scale <= MIN_SCALE}
                            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 disabled:opacity-30 rounded-full transition-colors"
                            style={{ touchAction: 'manipulation' }}
                            aria-label="縮小"
                        >
                            <ZoomOut className="w-4 h-4 text-white" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setScale(1)}
                            className="min-w-[40px] min-h-[36px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 rounded transition-colors"
                            style={{ touchAction: 'manipulation' }}
                            aria-label="ズームリセット"
                        >
                            <span className="text-white text-xs tabular-nums">
                                {Math.round(scale * 100)}%
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setScale(s => Math.min(s + 0.25, MAX_SCALE))}
                            disabled={scale >= MAX_SCALE}
                            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 disabled:opacity-30 rounded-full transition-colors"
                            style={{ touchAction: 'manipulation' }}
                            aria-label="拡大"
                        >
                            <ZoomIn className="w-4 h-4 text-white" />
                        </button>
                    </div>
                </div>
            </div>

            {/* ===== フッター・ページナビ ===== */}
            {showFooter && (
                <div className="flex items-center justify-center gap-6 bg-gray-900 shrink-0" style={{ minHeight: 52 }}>
                    <button
                        type="button"
                        onClick={() => setPageNumber(p => Math.max(p - 1, 1))}
                        disabled={pageNumber <= 1}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 active:bg-white/30 disabled:opacity-30 rounded-full transition-colors"
                        style={{ touchAction: 'manipulation' }}
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
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 active:bg-white/30 disabled:opacity-30 rounded-full transition-colors"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="次のページ"
                    >
                        <ChevronRight className="w-5 h-5 text-white" />
                    </button>
                </div>
            )}

            {/* 1ページのみの場合も下部に閉じるボタンを表示 */}
            {!showFooter && numPages > 0 && (
                <div className="flex items-center justify-center bg-gray-900 shrink-0" style={{ minHeight: 52 }}>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full transition-colors"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="閉じる"
                    >
                        <ArrowLeft className="w-4 h-4 text-white" />
                        <span className="text-white text-sm">戻る</span>
                    </button>
                </div>
            )}
        </div>,
        document.body
    );
}
