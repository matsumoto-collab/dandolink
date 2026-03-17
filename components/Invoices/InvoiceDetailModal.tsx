'use client';

import { useEffect, useState, useMemo } from 'react';
import { Invoice } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
const loadPdfGenerator = () => import('@/utils/reactPdfGenerator');
import { X, FileDown, Printer, Trash2, Edit } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { InlinePdfViewer } from '@/components/ui/InlinePdfViewer';

interface InvoiceDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    invoice: Invoice | null;
    project: Project | null;
    companyInfo: CompanyInfo;
    onDelete: (id: string) => void;
    onEdit: (invoice: Invoice) => void;
    customerName?: string;
    customerHonorific?: string;
}

export default function InvoiceDetailModal({
    isOpen,
    onClose,
    invoice,
    project,
    companyInfo,
    onDelete,
    onEdit,
    customerName,
    customerHonorific,
}: InvoiceDetailModalProps) {
    const [pdfUrl, setPdfUrl] = useState<string>('');
    const modalRef = useModalKeyboard(isOpen, onClose);

    const effectiveProject: Project = useMemo(() => {
        if (project) {
            const patched = { ...project };
            if (!patched.customer && customerName) patched.customer = customerName;
            if (!patched.customerHonorific && customerHonorific) patched.customerHonorific = customerHonorific;
            return patched;
        }
        return {
            id: invoice?.id || '',
            title: invoice?.title || '',
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: customerName || '',
            customerHonorific: customerHonorific || '御中',
            location: '',
            createdAt: invoice?.createdAt || new Date(),
            updatedAt: invoice?.updatedAt || new Date(),
        };
    }, [project, invoice?.id, invoice?.title, invoice?.createdAt, invoice?.updatedAt, customerName, customerHonorific]);

    useEffect(() => {
        let currentUrl = '';
        if (isOpen && invoice && companyInfo) {
            const generatePDF = async () => {
                try {
                    const { generateInvoicePDFBlobReact } = await loadPdfGenerator();
                    const url = await generateInvoicePDFBlobReact(invoice, effectiveProject, companyInfo);
                    currentUrl = url;
                    setPdfUrl(url);
                } catch (error) {
                    console.error('PDF生成エラー:', error);
                }
            };
            generatePDF();
        }
        return () => {
            if (currentUrl) {
                URL.revokeObjectURL(currentUrl);
            }
        };
    }, [isOpen, invoice, effectiveProject, companyInfo]);

    const handleDownload = async () => {
        if (invoice && companyInfo) {
            const { exportInvoicePDFReact } = await loadPdfGenerator();
            await exportInvoicePDFReact(invoice, effectiveProject, companyInfo);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const handleDelete = () => {
        if (invoice && confirm('この請求書を削除しますか？')) {
            onDelete(invoice.id);
            onClose();
        }
    };

    const handleEdit = () => {
        if (invoice) {
            onEdit(invoice);
            onClose();
        }
    };

    if (!isOpen || !invoice) {
        return null;
    }

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-6xl lg:mx-4 lg:max-h-[90vh]"
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-4 lg:rounded-t-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-slate-500">請求書</div>
                            <h2 className="text-xl font-semibold text-slate-800">
                                {effectiveProject.title}
                            </h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleEdit}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
                            >
                                <Edit size={18} />
                                編集
                            </button>
                            <button
                                onClick={onClose}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                                title="閉じる"
                                aria-label="閉じる"
                            >
                                <X size={24} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* アクションバー */}
                <div className="bg-white border-b border-slate-200 px-6 py-3">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleDownload}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            title="PDF出力"
                        >
                            <FileDown size={18} />
                            <span className="hidden sm:inline">PDF出力</span>
                        </button>
                        <button
                            onClick={handlePrint}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            title="印刷"
                        >
                            <Printer size={18} />
                            <span className="hidden sm:inline">印刷</span>
                        </button>
                        <button
                            onClick={handleDelete}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            title="削除"
                        >
                            <Trash2 size={18} />
                            <span className="hidden sm:inline">削除</span>
                        </button>
                    </div>
                </div>

                {/* PDFプレビュー */}
                <div className="flex-1 overflow-hidden bg-slate-100">
                    {pdfUrl ? (
                        <InlinePdfViewer url={pdfUrl} />
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto mb-4"></div>
                                <p className="text-slate-600">PDFを読み込んでいます...</p>
                            </div>
                        </div>
                    )}
                </div>

                <style jsx global>{`
                    @media print {
                        body * {
                            visibility: hidden;
                        }
                        iframe, iframe * {
                            visibility: visible;
                        }
                        iframe {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: 100%;
                            height: 100%;
                        }
                    }
                `}</style>
            </div>
        </div>
    );
}
