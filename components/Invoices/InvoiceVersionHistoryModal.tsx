'use client';

import { useEffect, useState } from 'react';
import { X, FileDown, History, Loader2 } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { InlinePdfViewer } from '@/components/ui/InlinePdfViewer';
import { Invoice } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';

const loadPdfGenerator = () => import('@/utils/reactPdfGenerator');

interface VersionSummary {
    id: string;
    versionNumber: number;
    invoiceNumber: string;
    title: string;
    total: number;
    status: string;
    createdAt: string;
    createdBy: string | null;
    createdByName: string | null;
}

interface InvoiceVersionHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    invoiceId: string;
    project: Project | null;
    companyInfo: CompanyInfo | null;
}

export default function InvoiceVersionHistoryModal({
    isOpen,
    onClose,
    invoiceId,
    project,
    companyInfo,
}: InvoiceVersionHistoryModalProps) {
    const [versions, setVersions] = useState<VersionSummary[]>([]);
    const [isListLoading, setIsListLoading] = useState(false);
    const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);
    const [selectedInvoice, setSelectedInvoice] = useState<(Invoice & { versionCreatedByName?: string | null }) | null>(null);
    const [selectedProjectMasters, setSelectedProjectMasters] = useState<Array<{ id: string; title: string }>>([]);
    const [isVersionLoading, setIsVersionLoading] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string>('');
    const modalRef = useModalKeyboard(isOpen, onClose);

    useEffect(() => {
        if (!isOpen || !invoiceId) return;
        setIsListLoading(true);
        fetch(`/api/invoices/${invoiceId}/versions`, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error('履歴の取得に失敗しました');
                return res.json();
            })
            .then((data: VersionSummary[]) => {
                setVersions(data);
                if (data.length > 0) {
                    setSelectedVersionNumber(data[0].versionNumber);
                } else {
                    setSelectedVersionNumber(null);
                }
            })
            .catch(err => {
                logger.error('Failed to load version list:', err);
                toast.error('履歴の取得に失敗しました');
            })
            .finally(() => setIsListLoading(false));
    }, [isOpen, invoiceId]);

    useEffect(() => {
        if (!isOpen || !invoiceId || selectedVersionNumber === null) {
            setSelectedInvoice(null);
            setSelectedProjectMasters([]);
            return;
        }
        setIsVersionLoading(true);
        fetch(`/api/invoices/${invoiceId}/versions/${selectedVersionNumber}`, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error('履歴の取得に失敗しました');
                return res.json();
            })
            .then((data) => {
                const inv: Invoice = {
                    ...data,
                    dueDate: new Date(data.dueDate),
                    paidDate: data.paidDate ? new Date(data.paidDate) : undefined,
                    createdAt: new Date(data.createdAt),
                    updatedAt: new Date(data.updatedAt),
                };
                setSelectedInvoice({ ...inv, versionCreatedByName: data.versionCreatedByName });
                setSelectedProjectMasters(Array.isArray(data.projectMasters) ? data.projectMasters : []);
            })
            .catch(err => {
                logger.error('Failed to load version:', err);
                toast.error('履歴の取得に失敗しました');
            })
            .finally(() => setIsVersionLoading(false));
    }, [isOpen, invoiceId, selectedVersionNumber]);

    useEffect(() => {
        let currentUrl = '';
        setPdfUrl('');
        if (!selectedInvoice || !companyInfo) return;

        // 請求書には明示の project が無いケースが多いので、暫定 Project を作成
        const effectiveProject: Project = project ?? ({
            id: selectedInvoice.id,
            title: selectedInvoice.title,
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: '',
            location: '',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as Project);

        const run = async () => {
            try {
                const { generateInvoicePDFBlobReact } = await loadPdfGenerator();
                const url = await generateInvoicePDFBlobReact(
                    selectedInvoice,
                    effectiveProject,
                    companyInfo,
                    selectedProjectMasters.length > 0 ? selectedProjectMasters : undefined,
                    { includeCopy: true, includeDetails: false },
                );
                currentUrl = url;
                setPdfUrl(url);
            } catch (err) {
                logger.error('PDF生成エラー:', err);
                setPdfUrl('error');
            }
        };
        run();

        return () => {
            if (currentUrl) URL.revokeObjectURL(currentUrl);
        };
    }, [selectedInvoice, selectedProjectMasters, project, companyInfo]);

    const handleDownload = async () => {
        if (!selectedInvoice || !companyInfo) return;
        const effectiveProject: Project = project ?? ({
            id: selectedInvoice.id,
            title: selectedInvoice.title,
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: '',
            location: '',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as Project);
        try {
            const { exportInvoicePDFReact } = await loadPdfGenerator();
            await exportInvoicePDFReact(
                selectedInvoice,
                effectiveProject,
                companyInfo,
                selectedProjectMasters.length > 0 ? selectedProjectMasters : undefined,
                { includeCopy: true, includeDetails: false },
            );
        } catch (err) {
            logger.error('PDF出力エラー:', err);
            toast.error('PDF出力に失敗しました');
        }
    };

    if (!isOpen) return null;

    const latestVer = versions.length > 0 ? versions[0].versionNumber : null;

    return (
        <div className="fixed inset-0 lg:left-48 z-[70] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-xl lg:shadow-xl lg:max-w-6xl lg:mx-4 lg:max-h-[90vh]"
            >
                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-4 lg:rounded-t-xl">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <History className="w-5 h-5 text-slate-600" />
                            <h2 className="text-xl font-semibold text-slate-800">請求書の履歴</h2>
                        </div>
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

                <div className="flex-1 flex flex-col md:flex-row min-h-0">
                    <div className="md:w-80 border-b md:border-b-0 md:border-r border-slate-200 overflow-auto">
                        {isListLoading ? (
                            <div className="p-4 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                            </div>
                        ) : versions.length === 0 ? (
                            <div className="p-4 text-sm text-slate-500">履歴はまだありません</div>
                        ) : (
                            <ul className="divide-y divide-slate-200">
                                {versions.map(v => {
                                    const isSelected = v.versionNumber === selectedVersionNumber;
                                    const isLatest = v.versionNumber === latestVer;
                                    return (
                                        <li key={v.id}>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedVersionNumber(v.versionNumber)}
                                                className={`w-full text-left px-4 py-3 transition-colors ${isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                            >
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-semibold text-slate-800">Ver.{v.versionNumber}</span>
                                                    {isLatest && (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-white">最新</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500">
                                                    {new Date(v.createdAt).toLocaleString('ja-JP')}
                                                </div>
                                                {v.createdByName && (
                                                    <div className="text-xs text-slate-500">保存者: {v.createdByName}</div>
                                                )}
                                                <div className="text-xs text-slate-600 mt-1">
                                                    ¥{v.total.toLocaleString()}
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <div className="flex-1 min-h-0 flex flex-col bg-slate-100">
                        <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between">
                            <div className="text-sm text-slate-600">
                                {selectedVersionNumber !== null ? `Ver.${selectedVersionNumber} のプレビュー` : ''}
                            </div>
                            <button
                                onClick={handleDownload}
                                disabled={!selectedInvoice || !companyInfo}
                                className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="このバージョンをPDFでダウンロード"
                            >
                                <FileDown size={16} />
                                <span className="hidden sm:inline">このバージョンをダウンロード</span>
                                <span className="sm:hidden">DL</span>
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {isVersionLoading || !pdfUrl ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                                </div>
                            ) : pdfUrl === 'error' ? (
                                <div className="flex items-center justify-center h-full text-sm text-slate-500">
                                    PDFの生成に失敗しました
                                </div>
                            ) : (
                                <InlinePdfViewer url={pdfUrl} />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
