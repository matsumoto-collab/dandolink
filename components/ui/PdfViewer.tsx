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

    // ドラッグ移動用（マウス＋タッチ共通）
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

    // スケール変更時に中央基準でスクロール位置を維持
    const changeScale = useCallback((fn: (s: number) => number) => {
        setScale(s => {
            const newScale = fn(s);
            if (newScale === s) return s;

            // DOMの状態をキャプチャ (requestAnimationFrameの前に計算)
            const el = contentRef.current;
            if (!el) return newScale;

            const ratio = newScale / s;
            const cw = el.clientWidth;
            const ch = el.clientHeight;

            const baseW = Math.min(cw - 16, 900);
            const oldWidth = Math.max(0, Math.floor(baseW * s));
            const newWidth = Math.max(0, Math.floor(baseW * newScale));

            // CSS margin:autoの代わりに使われるパディング量を計算（旧・新）
            const oldPadX = Math.max(0, (cw - oldWidth) / 2);
            const newPadX = Math.max(0, (cw - newWidth) / 2);

            const scrollL = el.scrollLeft;
            const scrollT = el.scrollTop;

            requestAnimationFrame(() => {
                const updatedEl = contentRef.current;
                if (!updatedEl) return;

                // コンテンツの原点に対するX座標を計算しズーム後の座標へマッピング
                const contentX = scrollL + cw / 2 - oldPadX;
                const newContentX = contentX * ratio;
                updatedEl.scrollLeft = newContentX + newPadX - cw / 2;

                // PDFViewerの中央描画の場合：パディング固定16pxとする
                const oldPadY = 16 * s;
                const newPadY = 16 * newScale;
                const contentY = scrollT + ch / 2 - oldPadY;
                const newContentY = contentY * ratio;
                updatedEl.scrollTop = newContentY + newPadY - ch / 2;
            });
            return newScale;
        });
    }, []);

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

    // ピンチズーム無効化 + タッチドラッグ移動
    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;

        let touchDragId: number | null = null;

        const onTouchStart = (e: TouchEvent) => {
            // 2本指以上はすべて無効化（ピンチズーム防止）
            if (e.touches.length >= 2) {
                e.preventDefault();
                return;
            }
            // ズームボタン上は無視
            if ((e.target as HTMLElement).closest('[data-zoom-controls]')) return;
            // 1本指: 拡大時のみドラッグ移動開始
            if (scale > 1) {
                touchDragId = e.touches[0].identifier;
                dragStart.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                    scrollLeft: el.scrollLeft,
                    scrollTop: el.scrollTop,
                };
            }
        };
        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length >= 2) {
                e.preventDefault();
                return;
            }
            if (touchDragId === null || !dragStart.current) return;
            const touch = Array.from(e.touches).find(t => t.identifier === touchDragId);
            if (!touch) return;
            e.preventDefault();
            el.scrollLeft = dragStart.current.scrollLeft - (touch.clientX - dragStart.current.x);
            el.scrollTop = dragStart.current.scrollTop - (touch.clientY - dragStart.current.y);
        };
        const onTouchEnd = () => {
            touchDragId = null;
            dragStart.current = null;
        };

        // iOS Safari GestureEvent も無効化
        const preventGesture = (e: Event) => { e.preventDefault(); };

        el.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
        el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
        el.addEventListener('gesturestart', preventGesture, { capture: true });
        el.addEventListener('gesturechange', preventGesture, { capture: true });
        el.addEventListener('gestureend', preventGesture, { capture: true });
        return () => {
            el.removeEventListener('touchstart', onTouchStart, { capture: true });
            el.removeEventListener('touchmove', onTouchMove, { capture: true });
            el.removeEventListener('touchend', onTouchEnd, { capture: true });
            el.removeEventListener('gesturestart', preventGesture, { capture: true });
            el.removeEventListener('gesturechange', preventGesture, { capture: true });
            el.removeEventListener('gestureend', preventGesture, { capture: true });
        };
    }, [mounted, scale]);

    // マウスドラッグ移動
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const el = contentRef.current;
        if (!el) return;
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
    const padX = Math.max(0, (containerWidth - pageRenderWidth) / 2);
    const padY = 16 * scale;
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

            <div
                ref={contentRef}
                className="relative flex-1 overflow-auto bg-gray-700 overscroll-none scroll-smooth"
                style={{
                    touchAction: scale > 1 ? 'none' : 'auto',
                    cursor: isDragging ? 'grabbing' : (scale > 1 ? 'grab' : 'auto'),
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <div style={{ padding: `${padY}px ${padX}px`, minWidth: 'max-content' }}>
                    {!PdfDocument ? (
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                            <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                        </div>
                    ) : (
                        <PdfDocument
                            file={url}
                            onLoadSuccess={({ numPages: n }) => { setNumPages(n); setPageNumber(1); }}
                            loading={
                                <div className="flex flex-col items-center gap-3">
                                    <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                                    <span className="text-sm text-white/70">PDFを読み込んでいます...</span>
                                </div>
                            }
                            error={
                                <div className="flex flex-col items-center gap-4 text-white px-6 text-center">
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
                                <div style={{ width: pageRenderWidth }} className="bg-white shadow-lg mx-auto">
                                    <PdfPage
                                        pageNumber={pageNumber}
                                        width={pageRenderWidth}
                                        renderTextLayer={false}
                                        renderAnnotationLayer={false}
                                    />
                                </div>
                            )}
                        </PdfDocument>
                    )}
                </div>
            </div>

            {/* ===== ズームコントロール（画面中央下に固定） ===== */}
            <div
                data-zoom-controls
                className="fixed left-1/2 -translate-x-1/2 z-[201] pointer-events-none"
                style={{ bottom: showFooter ? 72 : 24, marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
                <div className="pointer-events-auto flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded-full px-2 py-1 opacity-60 sm:opacity-40 sm:hover:opacity-100 active:opacity-100 transition-opacity duration-200">
                    <button
                        type="button"
                        onClick={() => changeScale(s => Math.max(s - 0.25, MIN_SCALE))}
                        disabled={scale <= MIN_SCALE}
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 disabled:opacity-30 rounded-full transition-colors"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="縮小"
                    >
                        <ZoomOut className="w-4 h-4 text-white" />
                    </button>
                    <button
                        type="button"
                        onClick={() => changeScale(() => 1)}
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
                        onClick={() => changeScale(s => Math.min(s + 0.25, MAX_SCALE))}
                        disabled={scale >= MAX_SCALE}
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 disabled:opacity-30 rounded-full transition-colors"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="拡大"
                    >
                        <ZoomIn className="w-4 h-4 text-white" />
                    </button>
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
        </div>,
        document.body
    );
}
