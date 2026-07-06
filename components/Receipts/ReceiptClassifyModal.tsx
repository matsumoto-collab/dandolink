'use client';

import React, { useState, useEffect } from 'react';
import { X, Loader2, Trash2, RefreshCw, Save, ExternalLink, ZoomIn, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import type { Receipt, ExpenseCategoryRef } from '@/types/receipt';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/types/receipt';

interface Props {
    receipt: Receipt;
    onClose: () => void;
    onSaved: () => void;
    /** 閲覧専用ユーザー（税理士など）。true なら編集・削除・確定・再読取の操作を出さない */
    viewerOnly?: boolean;
}

const toInputDate = (s: string | null) => {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const toAmountStr = (n: number | string | null) => (n == null || n === '' ? '' : String(Number(n)));

function summaryOf(r: Receipt): string | null {
    const d = r.extractedData;
    return d && typeof d.summary === 'string' && d.summary ? d.summary : null;
}

export default function ReceiptClassifyModal({ receipt, onClose, onSaved, viewerOnly = false }: Props) {
    const readOnly = receipt.status === 'confirmed' || viewerOnly;

    const [storeName, setStoreName] = useState(receipt.storeName ?? '');
    const [issueDate, setIssueDate] = useState(toInputDate(receipt.issueDate));
    const [totalAmount, setTotalAmount] = useState(toAmountStr(receipt.totalAmount));
    const [taxAmount, setTaxAmount] = useState(toAmountStr(receipt.taxAmount));
    const [expenseCategoryId, setExpenseCategoryId] = useState(receipt.expenseCategoryId ?? '');
    const [paymentMethod, setPaymentMethod] = useState(receipt.paymentMethod ?? '');
    const [paidBy, setPaidBy] = useState(receipt.paidBy ?? '');
    const [notes, setNotes] = useState(receipt.notes ?? '');

    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [reopening, setReopening] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/master-data/expense-categories');
                if (res.ok) setCategories(await res.json());
            } catch (e) {
                logger.error('master fetch failed', e);
            }
        })();
    }, []);

    const buildBody = (nextStatus?: string): Record<string, unknown> => ({
        storeName: storeName || null,
        issueDate: issueDate || null,
        totalAmount: totalAmount || null,
        taxAmount: taxAmount || null,
        expenseCategoryId: expenseCategoryId || null,
        paymentMethod: paymentMethod || null,
        paidBy: paidBy || null,
        notes: notes || null,
        ...(nextStatus ? { status: nextStatus } : {}),
    });

    const patch = async (body: Record<string, unknown>): Promise<boolean> => {
        const res = await fetch(`/api/receipts/${receipt.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.ok) return true;
        const e = await res.json().catch(() => ({}));
        toast.error(e.error || '保存に失敗しました');
        return false;
    };

    const save = async () => {
        setSaving(true);
        try {
            if (await patch(buildBody())) {
                toast.success('保存しました');
                onSaved();
            }
        } finally {
            setSaving(false);
        }
    };

    const handleConfirm = async () => {
        setSaving(true);
        try {
            if (await patch(buildBody('confirmed'))) {
                toast.success('仕分けを確定しました');
                onSaved();
            }
        } finally {
            setSaving(false);
        }
    };

    const handleReopen = async () => {
        setReopening(true);
        try {
            if (await patch({ status: 'pending' })) {
                toast.success('再オープンしました');
                onSaved();
            }
        } finally {
            setReopening(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/receipts/${receipt.id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('削除しました');
                onSaved();
            } else {
                toast.error('削除に失敗しました');
            }
        } catch {
            toast.error('削除に失敗しました');
        } finally {
            setDeleting(false);
        }
    };

    const handleReextract = async () => {
        setExtracting(true);
        try {
            const res = await fetch(`/api/receipts/${receipt.id}/extract`, { method: 'POST' });
            if (res.ok) {
                const data: Receipt = await res.json();
                setStoreName(data.storeName ?? '');
                setIssueDate(toInputDate(data.issueDate));
                setTotalAmount(toAmountStr(data.totalAmount));
                setTaxAmount(toAmountStr(data.taxAmount));
                if (data.expenseCategoryId) setExpenseCategoryId(data.expenseCategoryId);
                toast.success('AIで再読み取りしました');
            } else {
                const e = await res.json().catch(() => ({}));
                toast.error(e.error || '再読み取りに失敗しました');
            }
        } catch {
            toast.error('再読み取りに失敗しました');
        } finally {
            setExtracting(false);
        }
    };

    const totalNum = Number(totalAmount) || 0;
    const canConfirm = !!issueDate && totalNum > 0 && !!expenseCategoryId;
    const confirmHint = !issueDate ? '日付を入力してください' : totalNum <= 0 ? '金額を入力してください' : !expenseCategoryId ? '費目を選択してください' : undefined;
    const storeWarn = canConfirm && !storeName.trim();

    const isImage = receipt.mimeType.startsWith('image/');
    const summary = summaryOf(receipt);
    const inputCls = `w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 ${readOnly ? 'bg-slate-50 text-slate-600' : ''}`;

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ（デスクトップのみ） */}
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            {/* モーダル本体 */}
            <div role="dialog" aria-modal="true" className="relative bg-white flex flex-col w-full h-full lg:h-[90vh] lg:rounded-lg lg:shadow-xl lg:max-w-5xl lg:mx-4">
                <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <h3 className="font-bold text-slate-900">領収書の仕分け{readOnly && <span className="ml-2 text-sm font-medium text-teal-700">（仕分け済み）</span>}</h3>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2">
                    {/* 左: プレビュー */}
                    <div className="bg-slate-100 p-3 lg:border-r border-slate-200 min-h-[240px] flex flex-col">
                        <div className="flex-1 flex items-center justify-center overflow-hidden">
                            {isImage && receipt.signedUrl ? (
                                <button type="button" onClick={() => setLightboxOpen(true)} className="relative group max-w-full max-h-[70vh]" title="クリックで拡大">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={receipt.signedUrl} alt="領収書" className="max-w-full max-h-[70vh] object-contain rounded" />
                                    <span className="absolute bottom-2 right-2 p-1.5 bg-black/50 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><ZoomIn className="w-4 h-4" /></span>
                                </button>
                            ) : receipt.signedUrl ? (
                                <iframe src={receipt.signedUrl} className="w-full h-[70vh] rounded" title="領収書PDF" />
                            ) : (
                                <p className="text-slate-400 text-sm">プレビューを表示できません</p>
                            )}
                        </div>
                        {receipt.signedUrl && (
                            <a
                                href={receipt.signedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                別タブで開く
                            </a>
                        )}
                    </div>

                    {/* 右: フォーム */}
                    <div className="p-4 space-y-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">店名・支払先</label>
                            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} disabled={readOnly} className={inputCls} placeholder="店名・支払先" />
                            {storeWarn && <p className="text-xs text-amber-600 mt-1">店名が未入力です（このまま確定もできます）</p>}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">日付</label>
                                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={readOnly} className={inputCls} />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">支払方法</label>
                                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={readOnly} className={inputCls}>
                                    <option value="">未設定</option>
                                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">税込金額</label>
                                <input inputMode="numeric" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value.replace(/[^0-9]/g, ''))} disabled={readOnly} className={inputCls} placeholder="0" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">うち消費税</label>
                                <input inputMode="numeric" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value.replace(/[^0-9]/g, ''))} disabled={readOnly} className={inputCls} placeholder="0" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">費目<span className="text-red-500 ml-0.5">*</span></label>
                            <select value={expenseCategoryId} onChange={(e) => setExpenseCategoryId(e.target.value)} disabled={readOnly} className={inputCls}>
                                <option value="">費目を選択</option>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            {summary && <p className="text-xs text-slate-400 mt-1">AI摘要: {summary}</p>}
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">支払者（立替者）</label>
                            <input value={paidBy} onChange={(e) => setPaidBy(e.target.value)} disabled={readOnly} className={inputCls} placeholder="例: 山田太郎（個人立替の場合）" />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">メモ</label>
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} rows={2} className={`${inputCls} resize-none`} />
                        </div>
                    </div>
                </div>

                <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2">
                        {viewerOnly ? null : confirmDelete ? (
                            <>
                                <button onClick={handleDelete} disabled={deleting} className="px-3 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50">{deleting ? '削除中…' : '本当に削除'}</button>
                                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-sm text-slate-600">キャンセル</button>
                            </>
                        ) : (
                            <>
                                <button onClick={() => setConfirmDelete(true)} className="p-2 text-slate-500 hover:bg-slate-200 rounded-xl" title="削除"><Trash2 className="w-4 h-4" /></button>
                                {!readOnly && (
                                    <button onClick={handleReextract} disabled={extracting} className="p-2 text-slate-500 hover:bg-slate-200 rounded-xl disabled:opacity-50" title="AIで再読み取り">
                                        {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {viewerOnly ? (
                            <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">
                                閉じる
                            </button>
                        ) : readOnly ? (
                            <button onClick={handleReopen} disabled={reopening} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium inline-flex items-center gap-2 disabled:opacity-50">
                                {reopening ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                再オープン
                            </button>
                        ) : (
                            <>
                                <button onClick={save} disabled={saving} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium inline-flex items-center gap-2 disabled:opacity-50">
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    保存
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={!canConfirm || saving}
                                    title={confirmHint}
                                    className="px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium inline-flex items-center gap-2 disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    仕分けを確定
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {lightboxOpen && isImage && receipt.signedUrl && (
                <ImageLightbox images={[{ src: receipt.signedUrl, alt: receipt.fileName }]} initialIndex={0} onClose={() => setLightboxOpen(false)} />
            )}
        </div>
    );
}
