'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface LightboxImage {
    src: string;
    alt: string;
}

interface ImageLightboxProps {
    images: LightboxImage[];
    initialIndex: number;
    onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const transformRef = useRef<ReactZoomPanPinchRef>(null);

    const goPrev = useCallback(() => {
        setCurrentIndex(i => (i - 1 + images.length) % images.length);
    }, [images.length]);

    const goNext = useCallback(() => {
        setCurrentIndex(i => (i + 1) % images.length);
    }, [images.length]);

    // 画像切り替え時にズームをリセット
    useEffect(() => {
        transformRef.current?.resetTransform();
    }, [currentIndex]);

    // キーボード操作
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') goPrev();
            if (e.key === 'ArrowRight') goNext();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose, goPrev, goNext]);

    const current = images[currentIndex];
    const hasMultiple = images.length > 1;

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 select-none">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <span className="text-white/70 text-sm truncate max-w-xs md:max-w-md" title={current.alt}>
                    {current.alt}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                    {hasMultiple && (
                        <span className="text-white/50 text-sm tabular-nums">
                            {currentIndex + 1} / {images.length}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] hover:bg-white/10 rounded-lg transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-6 h-6 text-white" />
                        <span className="text-white text-sm sm:hidden">閉じる</span>
                    </button>
                </div>
            </div>

            {/* 画像エリア */}
            <div className="flex-1 relative overflow-hidden">
                {/* 前へ */}
                {hasMultiple && (
                    <button
                        type="button"
                        onClick={goPrev}
                        className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-3 min-w-[44px] min-h-[44px] bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                        aria-label="前の画像"
                    >
                        <ChevronLeft className="w-6 h-6 text-white" />
                    </button>
                )}

                <TransformWrapper
                    ref={transformRef}
                    initialScale={1}
                    minScale={0.3}
                    maxScale={10}
                    centerOnInit
                    doubleClick={{ mode: 'zoomIn' }}
                    wheel={{ step: 0.15 }}
                >
                    <TransformComponent
                        wrapperStyle={{ width: '100%', height: '100%', cursor: 'grab' }}
                        contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={current.src}
                            alt={current.alt}
                            draggable={false}
                            style={{
                                maxWidth: '90vw',
                                maxHeight: '78vh',
                                objectFit: 'contain',
                                pointerEvents: 'none',
                            }}
                        />
                    </TransformComponent>
                </TransformWrapper>

                {/* 次へ */}
                {hasMultiple && (
                    <button
                        type="button"
                        onClick={goNext}
                        className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-3 min-w-[44px] min-h-[44px] bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                        aria-label="次の画像"
                    >
                        <ChevronRight className="w-6 h-6 text-white" />
                    </button>
                )}
            </div>

            {/* ズームコントロール */}
            <div className="flex items-center justify-center gap-3 py-3 shrink-0">
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
        </div>
    );
}
