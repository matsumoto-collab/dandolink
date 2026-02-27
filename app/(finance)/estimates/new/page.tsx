'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEstimates } from '@/hooks/useEstimates';
import { EstimateInput, EstimateItem } from '@/types/estimate';
import EstimateForm from '@/components/Estimates/EstimateForm';
import EstimatePreview from '@/components/Estimates/EstimatePreview';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NewEstimatePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const copyFromId = searchParams.get('copyFrom');
    const { estimates, ensureDataLoaded, addEstimate } = useEstimates();
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => { ensureDataLoaded(); }, [ensureDataLoaded]);

    // コピー元データ
    const copySource = copyFromId ? estimates.find(e => e.id === copyFromId) : null;
    const initialData: Partial<EstimateInput> | undefined = copySource ? {
        projectId: copySource.projectId,
        title: copySource.title,
        items: copySource.items.map(item => ({ ...item, id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })),
        notes: copySource.notes,
    } : undefined;

    // プレビュー用データ
    const [previewData, setPreviewData] = useState<{
        title: string; customerName: string; siteName: string;
        items: EstimateItem[]; subtotal: number; tax: number; total: number;
        notes: string; estimateNumber: string;
    }>({ title: '', customerName: '', siteName: '', items: [], subtotal: 0, tax: 0, total: 0, notes: '', estimateNumber: '' });

    const handleDataChange = useCallback((data: typeof previewData) => {
        setPreviewData(data);
    }, []);

    const handleSubmit = async (data: EstimateInput) => {
        try {
            await addEstimate(data);
            toast.success('見積書を作成しました');
            router.push('/estimates');
        } catch (error) {
            console.error('Failed to create estimate:', error);
            toast.error(error instanceof Error ? error.message : '見積書の作成に失敗しました');
        }
    };

    return (
        <div className="flex flex-col h-full min-h-screen bg-slate-50">
            {/* ヘッダー */}
            <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <button onClick={() => router.push('/estimates')} className="text-slate-600 hover:text-slate-800 transition-colors">
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className="text-xl font-bold text-slate-800">
                        {copySource ? '見積書コピー作成' : '新規見積書作成'}
                    </h1>
                </div>
                {/* モバイル: プレビュー切替 */}
                <button onClick={() => setShowPreview(!showPreview)} className="lg:hidden flex items-center gap-1 px-3 py-2 text-sm bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                    {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {showPreview ? 'フォーム' : 'プレビュー'}
                </button>
            </div>

            {/* コンテンツ */}
            <div className="flex-1 flex overflow-hidden">
                {/* 左: フォーム */}
                <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${showPreview ? 'hidden lg:block' : ''} lg:w-1/2`}>
                    <div className="max-w-4xl">
                        <EstimateForm
                            initialData={initialData}
                            onSubmit={handleSubmit}
                            onCancel={() => router.push('/estimates')}
                            onDataChange={handleDataChange}
                        />
                    </div>
                </div>

                {/* 右: プレビュー */}
                <div className={`lg:w-1/2 lg:border-l border-slate-200 overflow-y-auto bg-gray-100 p-4 ${showPreview ? '' : 'hidden lg:block'}`}>
                    <div className="max-w-3xl mx-auto">
                        <EstimatePreview {...previewData} />
                    </div>
                </div>
            </div>
        </div>
    );
}
