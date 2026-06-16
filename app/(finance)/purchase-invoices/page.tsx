'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { PurchaseInvoice } from '@/types/purchaseInvoice';
import PurchaseInvoiceClassifyModal from '@/components/PurchaseInvoices/PurchaseInvoiceClassifyModal';

const TABS = [
    { id: 'pending', label: '未仕分け' },
    { id: 'classified', label: '仕分け済み' },
    { id: 'confirmed', label: '確定済み' },
] as const;

const yen = (n: number | string | null) => (n == null || n === '' ? '—' : `¥${Number(n).toLocaleString()}`);
const fmtDate = (s: string | null) => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export default function PurchaseInvoicesPage() {
    const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('pending');
    const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [selected, setSelected] = useState<PurchaseInvoice | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const fetchInvoices = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/purchase-invoices?status=${activeTab}`, { cache: 'no-store' });
            setInvoices(res.ok ? await res.json() : []);
        } catch (e) {
            logger.error('Failed to fetch purchase invoices:', e);
            setInvoices([]);
        } finally {
            setIsLoading(false);
        }
    }, [activeTab]);

    useEffect(() => {
        fetchInvoices();
    }, [fetchInvoices]);

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        let ok = 0;
        for (const file of Array.from(files)) {
            const fd = new FormData();
            fd.append('file', file);
            try {
                const res = await fetch('/api/purchase-invoices', { method: 'POST', body: fd });
                if (res.ok) ok++;
                else {
                    const e = await res.json().catch(() => ({}));
                    toast.error(e.error || `${file.name} の取り込みに失敗しました`);
                }
            } catch {
                toast.error(`${file.name} の取り込みに失敗しました`);
            }
        }
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        if (ok > 0) {
            toast.success(`${ok}件の請求書を取り込みました`);
            if (activeTab !== 'pending') setActiveTab('pending');
            else fetchInvoices();
        }
    };

    return (
        <div className="max-w-[1800px] mx-auto w-full min-w-0">
            <div className="mb-4">
                <h2 className="text-xl font-bold text-slate-900">仕入請求書</h2>
                <p className="text-sm text-slate-500 mt-1">
                    仕入先・リース会社などの請求書を取り込み、AIが読み取った内容を確認して各案件の原価と支払予定に登録します。
                </p>
            </div>

            {/* アップロードゾーン */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                className={`mb-6 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
            >
                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-3">請求書（PDF・画像）をドラッグ＆ドロップ、または選択してください</p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors font-medium inline-flex items-center gap-2 disabled:opacity-50"
                    >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? '取り込み中…' : 'ファイルを選択'}
                    </button>
                    <button
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={uploading}
                        className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium inline-flex items-center gap-2 disabled:opacity-50 sm:hidden"
                    >
                        <ImageIcon className="w-4 h-4" />
                        写真を撮影
                    </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            </div>

            {/* タブ */}
            <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-fit">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* 一覧 */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : invoices.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                    <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p>
                        {activeTab === 'pending' ? '未仕分けの請求書はありません' : activeTab === 'classified' ? '仕分け済みの請求書はありません' : '確定済みの請求書はありません'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {invoices.map((inv) => (
                        <button
                            key={inv.id}
                            onClick={() => setSelected(inv)}
                            className="text-left bg-white rounded-xl border border-slate-200 hover:border-teal-300 hover:shadow-md transition-all overflow-hidden"
                        >
                            <div className="aspect-[4/3] bg-slate-100 flex items-center justify-center overflow-hidden">
                                {inv.thumbnailSignedUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={inv.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                                ) : inv.mimeType !== 'application/pdf' && inv.signedUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={inv.signedUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <FileText className="w-10 h-10 text-slate-300" />
                                )}
                            </div>
                            <div className="p-3">
                                <div className="font-medium text-slate-900 truncate">{inv.payeeName || '（支払先 未取得）'}</div>
                                <div className="text-lg font-bold text-slate-900 mt-0.5">{yen(inv.totalAmount)}</div>
                                <div className="text-xs text-slate-500 mt-1">発行 {fmtDate(inv.issueDate)}</div>
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {inv.expenseCategory && (
                                        <span className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700 border border-amber-200">{inv.expenseCategory.name}</span>
                                    )}
                                    {inv.projectMaster ? (
                                        <span className="px-2 py-0.5 text-xs rounded-full bg-teal-50 text-teal-700 border border-teal-200 truncate max-w-full">
                                            {inv.projectMaster.name || inv.projectMaster.title}
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 text-xs rounded-full bg-slate-50 text-slate-500 border border-slate-200">案件 未割当</span>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {selected && (
                <PurchaseInvoiceClassifyModal
                    invoice={selected}
                    onClose={() => setSelected(null)}
                    onSaved={() => { setSelected(null); fetchInvoices(); }}
                />
            )}
        </div>
    );
}
