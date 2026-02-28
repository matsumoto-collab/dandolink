'use client';

import { useEffect, useState, useMemo } from 'react';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
// React PDF生成は動的インポート（バンドルサイズ最適化）
const loadPdfGenerator = () => import('@/utils/reactPdfGenerator');
import { X, FileDown, Printer, Trash2, Edit, FolderOpen } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { InlinePdfViewer } from '@/components/ui/InlinePdfViewer';

interface EstimateDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    estimate: Estimate | null;
    project: Project | null;
    companyInfo: CompanyInfo;
    onDelete: (id: string) => void;
    onEdit: (estimate: Estimate) => void;
    onCreateProject?: () => void;
    customerName?: string;
    customerHonorific?: string;
}

export default function EstimateDetailModal({
    isOpen,
    onClose,
    estimate,
    project,
    companyInfo,
    onDelete,
    onEdit,
    onCreateProject,
    customerName,
    customerHonorific,
}: EstimateDetailModalProps) {
    const [pdfUrl, setPdfUrl] = useState<string>('');
    const [activeTab, setActiveTab] = useState<'estimate' | 'budget'>('estimate');
    const [includeCoverPage, setIncludeCoverPage] = useState(true);
    const modalRef = useModalKeyboard(isOpen, onClose);

    // projectがnullの場合はestimateからダミーのProjectを作成（useMemoでメモ化）
    const effectiveProject: Project = useMemo(() => {
        if (project) {
            // projectにcustomerがない場合、customerNameで補完
            const patched = { ...project };
            if (!patched.customer && customerName) patched.customer = customerName;
            if (!patched.customerHonorific && customerHonorific) patched.customerHonorific = customerHonorific;
            return patched;
        }
        return {
            id: estimate?.id || '',
            title: estimate?.title || '',
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: customerName || '',
            customerHonorific: customerHonorific || '御中',
            location: '',
            createdAt: estimate?.createdAt || new Date(),
            updatedAt: estimate?.updatedAt || new Date(),
        };
    }, [project, estimate?.id, estimate?.title, estimate?.createdAt, estimate?.updatedAt, customerName, customerHonorific]);

    useEffect(() => {
        let currentUrl = '';
        if (isOpen && estimate && companyInfo) {
            const generatePDF = async () => {
                try {
                    const { generateEstimatePDFBlobReact } = await loadPdfGenerator();
                    const url = await generateEstimatePDFBlobReact(estimate, effectiveProject, companyInfo, { includeCoverPage });
                    currentUrl = url;
                    setPdfUrl(url);
                } catch (error) {
                    console.error('PDF生成エラー:', error);
                }
            };

            generatePDF();
        }
        // クリーンアップ
        return () => {
            if (currentUrl) {
                URL.revokeObjectURL(currentUrl);
            }
        };
    }, [isOpen, estimate, effectiveProject, companyInfo, includeCoverPage]);

    const handleDownload = async () => {
        if (estimate && companyInfo) {
            const { exportEstimatePDFReact } = await loadPdfGenerator();
            await exportEstimatePDFReact(estimate, effectiveProject, companyInfo, { includeCoverPage });
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const handleDelete = () => {
        if (estimate && confirm('この見積書を削除しますか？')) {
            onDelete(estimate.id);
            onClose();
        }
    };

    const handleEdit = () => {
        if (estimate) {
            onEdit(estimate);
            onClose();
        }
    };

    if (!isOpen || !estimate) {
        return null;
    }

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ */}
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            {/* モーダル本体 */}
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-6xl lg:mx-4 lg:max-h-[90vh]"
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 md:px-6 py-4 lg:rounded-t-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div>
                                <div className="text-sm text-gray-500">見積書</div>
                                <h2 className="text-xl font-semibold text-gray-800">
                                    {effectiveProject.title}
                                </h2>
                            </div>
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
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                title="閉じる"
                                aria-label="閉じる"
                            >
                                <X size={24} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* アクションバー */}
                {/* アクションバー */}
                <div className="bg-white border-b border-gray-200 px-6 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {!estimate.projectId && onCreateProject && (
                                <button
                                    onClick={() => { onCreateProject(); onClose(); }}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white hover:bg-slate-800 rounded-lg transition-colors"
                                    title="この見積書から案件を作成"
                                >
                                    <FolderOpen size={18} />
                                    <span className="hidden sm:inline">案件を作成</span>
                                </button>
                            )}
                            <button
                                onClick={handleDownload}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                                title="PDF出力"
                                aria-label="PDF出力"
                            >
                                <FileDown size={18} />
                                <span className="hidden sm:inline">PDF出力</span>
                            </button>
                            <button
                                onClick={handlePrint}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                                title="印刷"
                                aria-label="印刷"
                            >
                                <Printer size={18} />
                                <span className="hidden sm:inline">印刷</span>
                            </button>
                            <button
                                onClick={handleDelete}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                title="削除"
                                aria-label="削除"
                            >
                                <Trash2 size={18} />
                                <span className="hidden sm:inline">削除</span>
                            </button>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeCoverPage}
                                onChange={(e) => setIncludeCoverPage(e.target.checked)}
                                className="w-4 h-4 text-slate-600 border-gray-300 rounded focus:ring-slate-500"
                            />
                            表紙を含める
                        </label>
                    </div>
                </div>

                {/* タブ */}
                <div className="bg-white border-b border-gray-200 px-6">
                    <div className="flex gap-6">
                        <button
                            onClick={() => setActiveTab('estimate')}
                            className={`py-3 px-2 border-b-2 transition-colors ${activeTab === 'estimate'
                                ? 'border-slate-500 text-slate-600 font-medium'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            見積書
                        </button>
                        <button
                            onClick={() => setActiveTab('budget')}
                            className={`py-3 px-2 border-b-2 transition-colors ${activeTab === 'budget'
                                ? 'border-slate-500 text-slate-600 font-medium'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            予算書
                        </button>
                    </div>
                </div>

                {/* PDFプレビュー */}
                <div className="flex-1 overflow-hidden bg-gray-100">
                    {activeTab === 'estimate' ? (
                        pdfUrl ? (
                            <InlinePdfViewer url={pdfUrl} />
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto mb-4"></div>
                                    <p className="text-gray-600">PDFを読み込んでいます...</p>
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center text-gray-500">
                                <p className="text-lg">予算書機能は今後実装予定です</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* 印刷用スタイル */}
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
