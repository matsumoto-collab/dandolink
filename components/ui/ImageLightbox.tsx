'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Download } from 'lucide-react';

interface LightboxImage {
    src: string;
    alt: string;
}

interface ImageLightboxProps {
    images: LightboxImage[];
    initialIndex: number;
    onClose: () => void;
    /** 提供されると下部バーにダウンロードボタンを表示する */
    onDownload?: (index: number, format?: string) => void | Promise<void>;
    /** 該当indexで形式選択を表示したい場合に形式名の配列を返す（例: ['PDF', 'JPEG', 'PNG', 'WebP']） */
    getDownloadFormats?: (index: number) => string[] | undefined;
}

export function ImageLightbox({ images, initialIndex, onClose, onDownload, getDownloadFormats }: ImageLightboxProps) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [formatMenuOpen, setFormatMenuOpen] = useState(false);
    const transformRef = useRef<ReactZoomPanPinchRef>(null);

    // 画像切り替え時はフォーマットメニューを閉じる
    useEffect(() => {
        setFormatMenuOpen(false);
    }, [currentIndex]);

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

    // 親モーダルのスタッキングコンテキストに閉じ込められるとサイドバー(z-50)の裏に隠れるため、
    // body直下にポータルして常に最前面に表示する
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 select-none pwa-modal-safe">
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
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-6 h-6 text-white" />
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

            {/* 下部バー：ズームコントロール＋閉じるボタン */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0">
                {/* ズームコントロール */}
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

                {/* 右下: ダウンロード（任意）＋閉じるボタン */}
                <div className="flex items-center gap-2">
                    {onDownload && (() => {
                        const formats = getDownloadFormats?.(currentIndex);
                        const hasFormats = formats && formats.length > 0;
                        return (
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (hasFormats) {
                                            setFormatMenuOpen(o => !o);
                                        } else {
                                            onDownload(currentIndex);
                                        }
                                    }}
                                    className="flex items-center gap-2 px-5 py-3 min-h-[44px] bg-white/15 hover:bg-white/25 active:bg-white/30 rounded-xl transition-colors"
                                    aria-label="ダウンロード"
                                >
                                    <Download className="w-5 h-5 text-white" />
                                    <span className="text-white text-sm font-medium">保存{hasFormats ? '...' : ''}</span>
                                </button>
                                {hasFormats && formatMenuOpen && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-10"
                                            onClick={() => setFormatMenuOpen(false)}
                                        />
                                        <div className="absolute right-0 bottom-full mb-2 z-20 bg-white border border-slate-200 rounded-xl shadow-2xl py-1 min-w-[140px] overflow-hidden">
                                            {formats!.map((fmt) => (
                                                <button
                                                    key={fmt}
                                                    type="button"
                                                    onClick={() => {
                                                        setFormatMenuOpen(false);
                                                        onDownload(currentIndex, fmt.toLowerCase());
                                                    }}
                                                    className="w-full text-left px-4 py-3 min-h-[44px] text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors"
                                                >
                                                    {fmt}で保存
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })()}
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
            </div>
        </div>,
        document.body
    );
}
