'use client';

import React, { useState, useEffect } from 'react';
import { Estimate } from '@/types/estimate';
import { Invoice } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';

// Sample data for development
const sampleEstimate: Estimate = {
    id: 'est-001',
    projectId: 'proj-001',
    estimateNumber: 'E-2024-0001',
    title: 'サンプル工事現場',
    items: [
        {
            id: 'item-1',
            description: '仮設足場組立工事',
            quantity: 1,
            unit: '式',
            unitPrice: 250000,
            amount: 250000,
            taxType: 'standard',
            notes: '',
        },
        {
            id: 'item-2',
            description: '外壁塗装工事',
            quantity: 150,
            unit: '㎡',
            unitPrice: 3500,
            amount: 525000,
            taxType: 'standard',
            notes: '',
        },
        {
            id: 'item-3',
            description: '屋根防水工事',
            quantity: 80,
            unit: '㎡',
            unitPrice: 4500,
            amount: 360000,
            taxType: 'standard',
            notes: '',
        },
        {
            id: 'item-4',
            description: '仮設足場解体工事',
            quantity: 1,
            unit: '式',
            unitPrice: 180000,
            amount: 180000,
            taxType: 'standard',
            notes: '',
        },
        {
            id: 'item-5',
            description: '諸経費',
            quantity: 1,
            unit: '式',
            unitPrice: 85000,
            amount: 85000,
            taxType: 'standard',
            notes: '',
        },
        {
            id: 'item-6',
            description: '値引き',
            quantity: 1,
            unit: '式',
            unitPrice: -50000,
            amount: -50000,
            taxType: 'none',
            notes: '',
        },
    ],
    subtotal: 1350000,
    tax: 135000,
    total: 1485000,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
    status: 'draft',
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date(),
};

const sampleProject: Project = {
    id: 'proj-001',
    title: 'サンプル工事現場',
    startDate: new Date(),
    category: 'construction',
    color: '#3B82F6',
    customer: '株式会社サンプル商事',
    location: '東京都渋谷区神宮前1-2-3',
    description: 'サンプル工事の説明',
    createdAt: new Date(),
    updatedAt: new Date(),
};

const sampleCompanyInfo: CompanyInfo = {
    id: 'company-001',
    name: '株式会社雄伸工業',
    postalCode: '799-3104',
    address: '伊予市上三谷甲3517番地',
    tel: '089-989-7350',
    fax: '089-989-7351',
    representative: '今井　公一郎',
    licenseNumber: '愛媛県知事　許可（般-6）　第17335号',
    registrationNumber: 'T8500001018289',
    bankAccounts: [
        { bankName: '愛媛銀行', branchName: '古川支店', accountType: '普', accountNumber: '3916237' },
        { bankName: '伊予銀行', branchName: '郡中支店', accountType: '普', accountNumber: '1844218' },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
};

const sampleInvoice: Invoice = {
    id: 'inv-001',
    projectId: 'proj-001',
    estimateId: 'est-001',
    invoiceNumber: 'INV-2024-0001',
    title: 'サンプル工事現場',
    items: sampleEstimate.items,
    subtotal: 1350000,
    tax: 135000,
    total: 1485000,
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    status: 'sent',
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date(),
};

export default function PDFPreviewPage() {
    const [includeCoverPage, setIncludeCoverPage] = useState(true);
    const [activeTab, setActiveTab] = useState<'estimate' | 'invoice'>('estimate');
    const [key, setKey] = useState(0); // For forcing re-render
    const [isClient, setIsClient] = useState(false);
    const [PdfComponents, setPdfComponents] = useState<{
        // Using any for PDFViewer due to @react-pdf/renderer style type incompatibility
        PDFViewer: React.ComponentType<any> | null;
        EstimatePDF: React.ComponentType<{ estimate: Estimate; project: Project; companyInfo: CompanyInfo; includeCoverPage?: boolean }> | null;
        InvoicePDF: React.ComponentType<{ invoice: Invoice; project: Project; companyInfo: CompanyInfo }> | null;
    }>({ PDFViewer: null, EstimatePDF: null, InvoicePDF: null });

    useEffect(() => {
        setIsClient(true);
        // Dynamically import PDF components only on client side
        Promise.all([
            import('@react-pdf/renderer'),
            import('@/components/pdf/EstimatePDF'),
            import('@/components/pdf/InvoicePDF'),
        ]).then(([reactPdf, estimateMod, invoiceMod]) => {
            setPdfComponents({
                PDFViewer: reactPdf.PDFViewer,
                EstimatePDF: estimateMod.EstimatePDF,
                InvoicePDF: invoiceMod.InvoicePDF,
            });
        }).catch(err => {
            console.error('Failed to load PDF components:', err);
        });
    }, []);

    const handleRefresh = () => {
        setKey(prev => prev + 1);
    };

    if (!isClient) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-100">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto mb-4"></div>
                    <p className="text-slate-600">読み込み中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-slate-100">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">PDF開発プレビュー</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            コンポーネントを編集すると自動的に更新されます
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleRefresh}
                            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                        >
                            再読み込み
                        </button>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="bg-white border-b border-slate-200 px-6 py-3">
                <div className="flex items-center justify-between">
                    {/* Tabs */}
                    <div className="flex gap-4">
                        <button
                            onClick={() => setActiveTab('estimate')}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                activeTab === 'estimate'
                                    ? 'bg-slate-100 text-slate-700'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            見積書
                        </button>
                        <button
                            onClick={() => setActiveTab('invoice')}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                activeTab === 'invoice'
                                    ? 'bg-slate-100 text-slate-700'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            請求書
                        </button>
                    </div>

                    {/* Options */}
                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeCoverPage}
                                onChange={(e) => setIncludeCoverPage(e.target.checked)}
                                className="w-4 h-4 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                            />
                            <span className="text-sm text-slate-700">表紙を含める</span>
                        </label>
                    </div>
                </div>
            </div>

            {/* PDF Preview */}
            <div className="flex-1 p-4">
                <div className="h-full bg-white rounded-lg shadow-lg overflow-hidden">
                    {!PdfComponents.PDFViewer || !PdfComponents.EstimatePDF || !PdfComponents.InvoicePDF ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto mb-4"></div>
                                <p className="text-slate-600">PDFコンポーネントを読み込み中...</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'estimate' && (
                                <PdfComponents.PDFViewer
                                    key={`estimate-${key}-${includeCoverPage}`}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    showToolbar={true}
                                >
                                    <PdfComponents.EstimatePDF
                                        estimate={sampleEstimate}
                                        project={sampleProject}
                                        companyInfo={sampleCompanyInfo}
                                        includeCoverPage={includeCoverPage}
                                    />
                                </PdfComponents.PDFViewer>
                            )}
                            {activeTab === 'invoice' && (
                                <PdfComponents.PDFViewer
                                    key={`invoice-${key}-${includeCoverPage}`}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    showToolbar={true}
                                >
                                    <PdfComponents.InvoicePDF
                                        invoice={sampleInvoice}
                                        project={sampleProject}
                                        companyInfo={sampleCompanyInfo}
                                    />
                                </PdfComponents.PDFViewer>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Footer info */}
            <div className="bg-white border-t border-slate-200 px-6 py-3">
                <div className="flex items-center justify-between text-sm text-slate-500">
                    <div>
                        <span className="font-medium">編集対象:</span>{' '}
                        <code className="bg-slate-100 px-2 py-1 rounded">
                            {activeTab === 'estimate' ? 'components/pdf/EstimatePDF.tsx' : 'components/pdf/InvoicePDF.tsx'}
                        </code>
                    </div>
                    <div>
                        <span className="font-medium">スタイル:</span>{' '}
                        <code className="bg-slate-100 px-2 py-1 rounded">components/pdf/styles.ts</code>
                    </div>
                </div>
            </div>
        </div>
    );
}
