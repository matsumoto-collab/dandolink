'use client';

import React, { useState } from 'react';
import { X, Loader2, Trash2, Save, ExternalLink, ZoomIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import type { CardReceipt } from '@/types/creditCard';
import type { ExpenseCategoryRef } from '@/types/receipt';
import { fmtDate, toInputDate } from './uploadPrep';

interface Props {
    receipt: CardReceipt;
    categories: ExpenseCategoryRef[];
    onClose: () => void;
    onSaved: () => void;
}

const toAmountStr = (n: number | string | null) => (n == null || n === '' ? '' : String(Number(n)));

// レシート受け箱の編集モーダル（ReceiptClassifyModal の縮小版・確定/精算の概念なし）。
export default function CardReceiptEditModal({ receipt, categories, onClose, onSaved }: Props) {
    const [storeName, setStoreName] = useState(receipt.storeName ?? '');
    const [issueDate, setIssueDate] = useState(toInputDate(receipt.issueDate));
    const [totalAmount, setTotalAmount] = useState(toAmountStr(receipt.totalAmount));
    const [taxAmount, setTaxAmount] = useState(toAmountStr(receipt.taxAmount));
    const [expenseCategoryId, setExpenseCategoryId] = useState(receipt.expenseCategoryId ?? '');
    const [cardLabel, setCardLabel] = useState(receipt.cardLabel ?? '');
    const [applicantName, setApplicantName] = useState(receipt.applicantName ?? '');
    const [notes, setNotes] = useState(receipt.notes ?? '');

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const linked = receipt.statementLine;

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/card-receipts/${receipt.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storeName: storeName || null,
                    issueDate: issueDate || null,
                    totalAmount: totalAmount || null,
                    taxAmount: taxAmount || null,
                    expenseCategoryId: expenseCategoryId || null,
                    cardLabel: cardLabel || null,
                    applicantName: applicantName || null,
                    notes: notes || null,
                }),
            });
            if (res.ok) {
                toast.success('保存しました');
                onSaved();
            } else {
                const e = await res.json().catch(() => ({}));
                toast.error(e.error || '保存に失敗しました');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/card-receipts/${receipt.id}`, { method: 'DELETE' });
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

    const isImage = receipt.mimeType.startsWith('image/');
    const summary = receipt.extractedData && typeof receipt.extractedData.summary === 'string' && receipt.extractedData.summary ? receipt.extractedData.summary : null;
    const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500';

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ（デスクトップのみ） */}
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            {/* モーダル本体 */}
            <div role="dialog" aria-modal="true" className="relative bg-white flex flex-col w-full h-full lg:h-[90vh] lg:rounded-lg lg:shadow-xl lg:max-w-5xl lg:mx-4">
                <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <h3 className="font-bold text-slate-900">カードレシート</h3>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2">
                    {/* 左: プレビュー */}
                    <div className="bg-slate-100 p-3 lg:border-r border-slate-200 min-h-[240px] flex flex-col">
                        <div className="flex-1 flex items-center justify-center overflow-hidden">
                            {isImage && receipt.signedUrl ? (
                                <button type="button" onClick={() => setLightboxOpen(true)} className="relative group max-w-full max-h-[70vh]" title="クリックで拡大">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={receipt.signedUrl} alt="レシート" className="max-w-full max-h-[70vh] object-contain rounded" />
                                    <span className="absolute bottom-2 right-2 p-1.5 bg-black/50 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><ZoomIn className="w-4 h-4" /></span>
                                </button>
                            ) : receipt.signedUrl ? (
                                <iframe src={receipt.signedUrl} className="w-full h-[70vh] rounded" title="レシートPDF" />
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
                        {linked?.statement && (
                            <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
                                照合済み: <strong>{linked.statement.cardLabel}</strong> {fmtDate(linked.statement.closingDate)}締めの明細行に紐付いています。
                                紐付けの解除は明細書の画面から行えます。
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">店名・支払先</label>
                            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={inputCls} placeholder="店名・支払先" />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">日付</label>
                                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">カード名</label>
                                <input value={cardLabel} onChange={(e) => setCardLabel(e.target.value)} className={inputCls} placeholder="例: AMEX" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">税込金額</label>
                                <input inputMode="numeric" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value.replace(/[^0-9]/g, ''))} className={inputCls} placeholder="0" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">うち消費税</label>
                                <input inputMode="numeric" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value.replace(/[^0-9]/g, ''))} className={inputCls} placeholder="0" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">費目</label>
                                <select value={expenseCategoryId} onChange={(e) => setExpenseCategoryId(e.target.value)} className={inputCls}>
                                    <option value="">費目を選択</option>
                                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">担当名</label>
                                <input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} className={inputCls} placeholder="例: 山田太郎" />
                            </div>
                        </div>
                        <div>
                            {summary && <p className="text-xs text-slate-400">AI摘要: {summary}</p>}
                            <p className="text-xs text-slate-400 mt-1">明細行への紐付け時、行の費目が未設定ならこの費目を引き継ぎます。</p>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">メモ</label>
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
                        </div>
                    </div>
                </div>

                <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2">
                        {confirmDelete ? (
                            <>
                                <button onClick={handleDelete} disabled={deleting} className="px-3 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50">{deleting ? '削除中…' : '本当に削除'}</button>
                                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-sm text-slate-600">キャンセル</button>
                            </>
                        ) : (
                            <button onClick={() => setConfirmDelete(true)} className="p-2 text-slate-500 hover:bg-slate-200 rounded-xl" title="削除"><Trash2 className="w-4 h-4" /></button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">閉じる</button>
                        <button onClick={save} disabled={saving} className="px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium inline-flex items-center gap-2 disabled:opacity-50">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            保存
                        </button>
                    </div>
                </div>
            </div>

            {lightboxOpen && isImage && receipt.signedUrl && (
                <ImageLightbox images={[{ src: receipt.signedUrl, alt: receipt.fileName }]} initialIndex={0} onClose={() => setLightboxOpen(false)} />
            )}
        </div>
    );
}
