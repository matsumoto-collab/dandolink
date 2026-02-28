'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';

interface InlinePdfViewerProps {
    url: string;
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

export function InlinePdfViewer({ url }: InlinePdfViewerProps) {
    const [numPages, setNumPages] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const [scale, setScale] = useState(1);
    const [PdfDocument, setPdfDocument] = useState<DocumentComponent | null>(null);
    const [PdfPage, setPdfPage] = useState<PageComponent | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // ドラッグ移動用（マウス＋タッチ共通）
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
    const prevScale = useRef(1);

    // スケール変更時に中央基準でスクロール位置を維持
    const changeScale = useCallback((fn: (s: number) => number) => {
        setScale(s => {
            const newScale = fn(s);
            prevScale.current = s;
            requestAnimationFrame(() => {
                const el = contentRef.current;
                if (!el) return;
                const ratio = newScale / prevScale.current;
                const centerX = el.scrollLeft + el.clientWidth / 2;
                const centerY = el.scrollTop + el.clientHeight / 2;
                el.scrollLeft = centerX * ratio - el.clientWidth / 2;
                el.scrollTop = centerY * ratio - el.clientHeight / 2;
            });
            return newScale;
        });
    }, []);

    // コンテナの幅を測定してPDFを描画幅に合わせる
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

    // react-pdf の遅延ロード
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
    }, [scale]);

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

    // 左右に少し余白を持たせる
    const baseWidth = Math.max(0, containerWidth - 32);
    const pageRenderWidth = Math.max(0, Math.floor(baseWidth * scale));

    return (
        <div className="relative w-full h-full flex flex-col items-center bg-gray-100">
            <div
                ref={contentRef}
                className="w-full h-full overflow-auto flex flex-col items-center py-4 overscroll-none"
                style={{
                    touchAction: scale > 1 ? 'none' : 'auto', // 拡大時はスクロールをJSで制御
                    cursor: isDragging ? 'grabbing' : (scale > 1 ? 'grab' : 'auto'),
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {!PdfDocument ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 mt-10">
                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                        <span className="text-sm text-gray-500">PDFを読み込んでいます...</span>
                    </div>
                ) : (
                    <PdfDocument
                        file={url}
                        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                        loading={
                            <div className="flex flex-col items-center justify-center h-full gap-3 mt-10">
                                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                                <span className="text-sm text-gray-500">PDFを読み込んでいます...</span>
                            </div>
                        }
                        error={
                            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-600 px-6 text-center mt-10">
                                <p>PDFの読み込みに失敗しました</p>
                            </div>
                        }
                    >
                        {PdfPage && pageRenderWidth > 0 && Array.from(new Array(numPages), (_, index) => (
                            <div key={`page_${index + 1}`} className="mb-4 shadow-md bg-white shrink-0">
                                <PdfPage
                                    pageNumber={index + 1}
                                    width={pageRenderWidth}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                />
                            </div>
                        ))}
                    </PdfDocument>
                )}
            </div>

            {/* ===== ズームコントロール（画面中央下に配置） ===== */}
            <div
                data-zoom-controls
                className="absolute left-1/2 -translate-x-1/2 z-[10] pointer-events-none"
                style={{ bottom: 16, marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
                <div className="pointer-events-auto flex items-center gap-1 bg-gray-800/80 backdrop-blur-sm rounded-full px-2 py-1 shadow-lg">
                    <button
                        type="button"
                        onClick={() => changeScale(s => Math.max(s - 0.25, MIN_SCALE))}
                        disabled={scale <= MIN_SCALE}
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 disabled:opacity-30 rounded-full transition-colors"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="縮小"
                        title="縮小"
                    >
                        <ZoomOut className="w-4 h-4 text-white" />
                    </button>
                    <button
                        type="button"
                        onClick={() => changeScale(() => 1)}
                        className="min-w-[40px] min-h-[36px] flex items-center justify-center hover:bg-white/10 active:bg-white/20 rounded transition-colors px-2"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="ズームリセット"
                        title="ズームリセット"
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
                        title="拡大"
                    >
                        <ZoomIn className="w-4 h-4 text-white" />
                    </button>
                </div>
            </div>
        </div>
    );
}
