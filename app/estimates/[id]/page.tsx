'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useEstimates } from '@/contexts/EstimateContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useCompany } from '@/contexts/CompanyContext';
// PDF生成は動的インポート（バンドルサイズ最適化）
const loadPdfGenerator = () => import('@/utils/reactPdfGenerator');
import { ArrowLeft, FileDown, Printer, Trash2, Edit, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';

export default function EstimateDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { estimates, ensureDataLoaded: ensureEstimatesLoaded, deleteEstimate } = useEstimates();
    const { projects } = useProjects();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();

    const [pdfUrl, setPdfUrl] = useState<string>('');
    const [activeTab, setActiveTab] = useState<'estimate' | 'budget'>('estimate');

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
        // TODO: 編集モーダルを開く
        toast('編集機能は今後実装予定です');
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
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">見積書が見つかりません</h2>
                    <button
                        onClick={() => router.push('/estimates')}
                        className="text-blue-600 hover:text-blue-700 flex items-center gap-2 mx-auto"
                    >
                        <ArrowLeft size={20} />
                        見積書一覧に戻る
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-gray-50 pt-16 lg:pt-0 lg:ml-64">
            {/* ヘッダー */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.push('/estimates')}
                            className="text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            <ArrowLeft size={24} />
                        </button>
                        <div>
                            <div className="text-sm text-gray-500">見積書</div>
                            <h1 className="text-2xl font-bold text-gray-800">
                                {project.title}
                            </h1>
                        </div>
                    </div>
                    <button
                        onClick={handleEdit}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        <Edit size={18} />
                        編集
                    </button>
                </div>
            </div>

            {/* アクションバー */}
            <div className="bg-white border-b border-gray-200 px-6 py-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                        title="PDF出力"
                    >
                        <FileDown size={18} />
                        <span className="hidden sm:inline">PDF出力</span>
                    </button>
                    <button
                        onClick={handlePrint}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                        title="印刷"
                    >
                        <Printer size={18} />
                        <span className="hidden sm:inline">印刷</span>
                    </button>
                    <button
                        onClick={handleDelete}
                        className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                        title="削除"
                    >
                        <Trash2 size={18} />
                        <span className="hidden sm:inline">削除</span>
                    </button>
                    <button
                        onClick={handleGoToProject}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors ml-auto"
                        title="案件詳細へ"
                    >
                        <ExternalLink size={18} />
                        <span className="hidden sm:inline">案件詳細へ</span>
                    </button>
                </div>
            </div>

            {/* タブ */}
            <div className="bg-white border-b border-gray-200 px-6">
                <div className="flex gap-6">
                    <button
                        onClick={() => setActiveTab('estimate')}
                        className={`py-3 px-2 border-b-2 transition-colors ${activeTab === 'estimate'
                            ? 'border-blue-500 text-blue-600 font-medium'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        見積書
                    </button>
                    <button
                        onClick={() => setActiveTab('budget')}
                        className={`py-3 px-2 border-b-2 transition-colors ${activeTab === 'budget'
                            ? 'border-blue-500 text-blue-600 font-medium'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        予算書
                    </button>
                </div>
            </div>

            {/* PDFプレビュー */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'estimate' ? (
                    pdfUrl ? (
                        <iframe
                            src={pdfUrl}
                            className="w-full h-full border-0"
                            title="見積書プレビュー"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
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
    );
}
