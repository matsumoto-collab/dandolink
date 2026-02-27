'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useEstimates } from '@/hooks/useEstimates';
import { EstimateInput, EstimateItem, Estimate } from '@/types/estimate';
import EstimateForm from '@/components/Estimates/EstimateForm';
import EstimatePreview from '@/components/Estimates/EstimatePreview';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function EditEstimatePage() {
    const router = useRouter();
    const params = useParams();
    const estimateId = params.id as string;
    const { estimates, ensureDataLoaded, updateEstimate } = useEstimates();
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => { ensureDataLoaded(); }, [ensureDataLoaded]);

    const estimate = estimates.find((e: Estimate) => e.id === estimateId);

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
            await updateEstimate(estimateId, data);
            toast.success('見積書を更新しました');
            router.push(`/estimates/${estimateId}`);
        } catch (error) {
            console.error('Failed to update estimate:', error);
            toast.error(error instanceof Error ? error.message : '見積書の更新に失敗しました');
        }
    };

    if (!estimate) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto mb-4"></div>
                    <p className="text-slate-600">読み込み中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-screen bg-slate-50">
            {/* ヘッダー */}
            <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <button onClick={() => router.push(`/estimates/${estimateId}`)} className="text-slate-600 hover:text-slate-800 transition-colors">
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className="text-xl font-bold text-slate-800">見積書編集</h1>
                </div>
                <button onClick={() => setShowPreview(!showPreview)} className="lg:hidden flex items-center gap-1 px-3 py-2 text-sm bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                    {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {showPreview ? 'フォーム' : 'プレビュー'}
                </button>
            </div>

            {/* コンテンツ */}
            <div className="flex-1 flex overflow-hidden">
                <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${showPreview ? 'hidden lg:block' : ''} lg:w-1/2`}>
                    <div className="max-w-4xl">
                        <EstimateForm
                            initialData={estimate}
                            onSubmit={handleSubmit}
                            onCancel={() => router.push(`/estimates/${estimateId}`)}
                            onDataChange={handleDataChange}
                        />
                    </div>
                </div>

                <div className={`lg:w-1/2 lg:border-l border-slate-200 overflow-y-auto bg-gray-100 p-4 ${showPreview ? '' : 'hidden lg:block'}`}>
                    <div className="max-w-3xl mx-auto">
                        <EstimatePreview {...previewData} />
                    </div>
                </div>
            </div>
        </div>
    );
}
