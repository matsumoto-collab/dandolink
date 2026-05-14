'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { InlinePdfViewer } from './InlinePdfViewer';
import { logger } from '@/lib/logger';

interface LivePdfPreviewProps {
    /** 監視対象のシード値が変わるたびに PDF を再生成する */
    seed: unknown;
    /** PDF Blob を生成する関数。null を返すとプレビューを描画しない（必須情報未入力） */
    renderPdf: () => Promise<Blob | null>;
    /** デバウンス遅延 (ms) */
    debounceMs?: number;
    /** 初回マウント時の遅延 (ms)。0 だと即時生成 */
    initialDelayMs?: number;
}

/**
 * フォーム入力に追従してリアルタイムに PDF プレビューを再生成する共通コンポーネント。
 * - seed が変化するたびに debounceMs 後に renderPdf を実行
 * - 生成中はオーバーレイのスピナーを重ねる（既存プレビューは残す）
 * - 旧 Blob URL は自動で revoke
 * - in-flight な生成が古い場合は破棄
 */
export function LivePdfPreview({ seed, renderPdf, debounceMs = 700, initialDelayMs = 200 }: LivePdfPreviewProps) {
    const [pdfUrl, setPdfUrl] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>('');
    const generationSeqRef = useRef(0);
    const urlRef = useRef<string>('');
    const firstRunRef = useRef(true);

    useEffect(() => {
        const delay = firstRunRef.current ? initialDelayMs : debounceMs;
        firstRunRef.current = false;

        const handler = setTimeout(async () => {
            const seq = ++generationSeqRef.current;
            setIsGenerating(true);
            setErrorMessage('');
            try {
                const blob = await renderPdf();
                if (seq !== generationSeqRef.current) return;
                if (!blob) {
                    if (urlRef.current) {
                        URL.revokeObjectURL(urlRef.current);
                        urlRef.current = '';
                    }
                    setPdfUrl('');
                    return;
                }
                const url = URL.createObjectURL(blob);
                if (urlRef.current) URL.revokeObjectURL(urlRef.current);
                urlRef.current = url;
                setPdfUrl(url);
            } catch (error) {
                if (seq !== generationSeqRef.current) return;
                logger.error('PDFプレビュー生成エラー:', error);
                setErrorMessage('プレビューの生成に失敗しました');
            } finally {
                if (seq === generationSeqRef.current) setIsGenerating(false);
            }
        }, delay);

        return () => clearTimeout(handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seed]);

    useEffect(() => {
        return () => {
            if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        };
    }, []);

    return (
        <div className="relative w-full h-full bg-slate-100 flex flex-col">
            {pdfUrl ? (
                <InlinePdfViewer url={pdfUrl} />
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
                    {isGenerating ? (
                        <>
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <span className="text-sm">プレビューを生成しています...</span>
                        </>
                    ) : errorMessage ? (
                        <span className="text-sm text-red-500">{errorMessage}</span>
                    ) : (
                        <span className="text-sm">必要な情報を入力するとプレビューが表示されます</span>
                    )}
                </div>
            )}

            {/* 再生成中のオーバーレイ（既存プレビューを残しつつローディング表示） */}
            {pdfUrl && isGenerating && (
                <div className="absolute top-3 right-3 z-[5] flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 text-white text-xs rounded-full shadow-md pointer-events-none">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>更新中...</span>
                </div>
            )}
            {pdfUrl && errorMessage && (
                <div className="absolute top-3 right-3 z-[5] px-3 py-1.5 bg-red-600/90 text-white text-xs rounded-full shadow-md">
                    {errorMessage}
                </div>
            )}
        </div>
    );
}
