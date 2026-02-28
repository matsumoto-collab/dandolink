'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useEstimates } from '@/hooks/useEstimates';
import { useProjects } from '@/hooks/useProjects';
import { useCompany } from '@/hooks/useCompany';
// PDF生成は動的インポート（バンドルサイズ最適化）
const loadPdfGenerator = () => import('@/utils/reactPdfGenerator');
import { ArrowLeft, FileDown, Printer, Trash2, Edit, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { EstimateInput } from '@/types/estimate';
import dynamic from 'next/dynamic';
import { InlinePdfViewer } from '@/components/ui/InlinePdfViewer';

const EstimateModal = dynamic(
    () => import('@/components/Estimates/EstimateModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"></div> }
);

export default function EstimateDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { estimates, ensureDataLoaded: ensureEstimatesLoaded, updateEstimate, deleteEstimate } = useEstimates();
    const { projects } = useProjects();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();

    const [pdfUrl, setPdfUrl] = useState<string>('');
    const [activeTab, setActiveTab] = useState<'estimate' | 'budget'>('estimate');
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const estimateId = params.id as string;
    const estimate = estimates.find((e: Estimate) => e.id === estimateId);
    const project = estimate ? projects.find((p: Project) => p.id === estimate.projectId) : null;

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureEstimatesLoaded();
        ensureCompanyLoaded();
    }, [ensureEstimatesLoaded, ensureCompanyLoaded]);

    useEffect(() => {
        let currentUrl = '';
        if (estimate && project && companyInfo) {
            const generatePDF = async () => {
                try {
                    const { generateEstimatePDFBlobReact } = await loadPdfGenerator();
                    const url = await generateEstimatePDFBlobReact(estimate, project, companyInfo);
                    currentUrl = url;
                    setPdfUrl(url);
                } catch (error) {
                    console.error('PDF生成エラー:', error);
                    toast.error('PDF生成に失敗しました');
                    setPdfUrl('error');
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
    }, [estimate, project, companyInfo]);

    const handleDownload = async () => {
        if (estimate && project && companyInfo) {
            const { exportEstimatePDFReact } = await loadPdfGenerator();
            exportEstimatePDFReact(estimate, project, companyInfo);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const handleDelete = () => {
        if (confirm('この見積書を削除しますか？')) {
            deleteEstimate(estimateId);
            router.push('/estimates');
        }
    };

    const handleEdit = () => {
        setIsEditModalOpen(true);
    };

    const handleEditSubmit = async (data: EstimateInput) => {
        try {
            await updateEstimate(estimateId, data);
            setIsEditModalOpen(false);
            toast.success('見積書を更新しました');
            // PDF will be regenerated automatically by useEffect
        } catch (error) {
            console.error('Failed to update estimate:', error);
            toast.error('見積書の更新に失敗しました');
        }
    };

    const handleGoToProject = () => {
        if (estimate) {
            router.push(`/projects`);
        }
    };

    if (!estimate || !project) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">見積書が見つかりません</h2>
                    <button
                        onClick={() => router.push('/estimates')}
                        className="text-slate-600 hover:text-slate-700 flex items-center gap-2 mx-auto"
                    >
                        <ArrowLeft size={20} />
                        見積書一覧に戻る
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-slate-50 pt-16 lg:pt-0 lg:ml-64">
            {/* ヘッダー */}
            <div className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.push('/estimates')}
                            className="text-slate-600 hover:text-slate-800 transition-colors"
                            title="見積書一覧に戻る"
                            aria-label="見積書一覧に戻る"
                        >
                            <ArrowLeft size={24} />
                        </button>
                        <div>
                            <div className="text-sm text-slate-500">見積書</div>
                            <h1 className="text-2xl font-bold text-slate-800">
                                {project.title}
                            </h1>
                        </div>
                    </div>
                    <button
                        onClick={handleEdit}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                    >
                        <Edit size={18} />
                        編集
                    </button>
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
                    <button
                        onClick={handleGoToProject}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors ml-auto"
                        title="案件詳細へ"
                    >
                        <ExternalLink size={18} />
                        <span className="hidden sm:inline">案件詳細へ</span>
                    </button>
                </div>
            </div>

            {/* タブ */}
            <div className="bg-white border-b border-slate-200 px-6">
                <div className="flex gap-6">
                    <button
                        onClick={() => setActiveTab('estimate')}
                        className={`py-3 px-2 border-b-2 transition-colors ${activeTab === 'estimate'
                            ? 'border-slate-500 text-slate-600 font-medium'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        見積書
                    </button>
                    <button
                        onClick={() => setActiveTab('budget')}
                        className={`py-3 px-2 border-b-2 transition-colors ${activeTab === 'budget'
                            ? 'border-slate-500 text-slate-600 font-medium'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        予算書
                    </button>
                </div>
            </div>

            {/* PDFプレビュー */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'estimate' ? (
                    pdfUrl && pdfUrl !== 'error' ? (
                        <InlinePdfViewer url={pdfUrl} />
                    ) : pdfUrl === 'error' ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center text-slate-500">
                                <p className="text-lg">PDF生成に失敗しました</p>
                                <button
                                    onClick={() => { setPdfUrl(''); }}
                                    className="mt-4 text-slate-600 hover:text-slate-700"
                                >
                                    再試行
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto mb-4"></div>
                                <p className="text-slate-600">PDFを読み込んでいます...</p>
                            </div>
                        </div>
                    )
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center text-slate-500">
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

            {/* 編集モーダル */}
            <EstimateModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSubmit={handleEditSubmit}
                initialData={estimate}
            />
        </div>
    );
}
