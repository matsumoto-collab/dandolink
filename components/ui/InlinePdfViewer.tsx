'use client';

import { useEffect, useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';

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

export function InlinePdfViewer({ url }: InlinePdfViewerProps) {
    const [numPages, setNumPages] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const [PdfDocument, setPdfDocument] = useState<DocumentComponent | null>(null);
    const [PdfPage, setPdfPage] = useState<PageComponent | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

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

    // 左右に少し余白を持たせる
    const pageRenderWidth = Math.max(0, containerWidth - 32);

    return (
        <div ref={contentRef} className="w-full h-full overflow-auto bg-gray-100 flex flex-col items-center py-4 overscroll-none">
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
    );
}
