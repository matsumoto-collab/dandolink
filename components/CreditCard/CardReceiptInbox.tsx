'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { CardReceipt } from '@/types/creditCard';
import type { ExpenseCategoryRef } from '@/types/receipt';
import CardReceiptEditModal from './CardReceiptEditModal';
import { prepareFile, fmtDate, yen, type UploadRow, type UploadStatus } from './uploadPrep';

const normSearch = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

interface Props {
    categories: ExpenseCategoryRef[];
}

// レシート受け箱。日々のカード利用レシートをアップロード→AI読み取り→明細書取込後に照合する。
export default function CardReceiptInbox({ categories }: Props) {
    const [receipts, setReceipts] = useState<CardReceipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [selected, setSelected] = useState<CardReceipt | null>(null);
    const [cardLabel, setCardLabel] = useState('');
    const [linkedFilter, setLinkedFilter] = useState<'' | 'unlinked' | 'linked'>('');
    const [search, setSearch] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const fetchReceipts = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/card-receipts', { cache: 'no-store' });
            setReceipts(res.ok ? await res.json() : []);
        } catch (e) {
            logger.error('Failed to fetch card receipts:', e);
            setReceipts([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchReceipts();
    }, [fetchReceipts]);

    // アップロード時のカード名候補（既存レシートのラベルから）
    const cardLabels = useMemo(
        () => Array.from(new Set(receipts.map((r) => r.cardLabel).filter(Boolean))) as string[],
        [receipts],
    );

    const filtered = useMemo(() => {
        const q = normSearch(search.trim());
        return receipts.filter((r) => {
            if (linkedFilter === 'unlinked' && r.statementLine) return false;
            if (linkedFilter === 'linked' && !r.statementLine) return false;
            if (q) {
                const hay = normSearch([r.storeName ?? '', r.cardLabel ?? '', r.notes ?? '', r.expenseCategory?.name ?? ''].join(' '));
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [receipts, linkedFilter, search]);

    const unlinkedCount = useMemo(() => receipts.filter((r) => !r.statementLine).length, [receipts]);

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const arr = Array.from(files);
        setUploading(true);
        setUploadRows(arr.map((f) => ({ name: f.name, status: 'compressing' as UploadStatus })));

        const updateRow = (i: number, patch: Partial<UploadRow>) => setUploadRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

        let ok = 0;
        let cursor = 0;
        // 並列度2のワーカープール（抽出込みで1件5〜15秒かかるため）
        const worker = async () => {
            for (;;) {
                const i = cursor++;
                if (i >= arr.length) return;
                const file = arr[i];
                updateRow(i, { status: 'compressing' });
                const prepared = await prepareFile(file);
                if ('error' in prepared) {
                    updateRow(i, { status: 'error', message: prepared.error });
                    continue;
                }
                updateRow(i, { status: 'uploading' });
                try {
                    const fd = new FormData();
                    fd.append('file', prepared.blob, prepared.name);
                    if (cardLabel.trim()) fd.append('cardLabel', cardLabel.trim());
                    const res = await fetch('/api/card-receipts', { method: 'POST', body: fd });
                    if (res.ok) {
                        // 1枚の画像から複数のレシートが分割されることがある（返り値は作成されたレシートの配列）
                        const data = await res.json().catch(() => null);
                        const n = Array.isArray(data) ? data.length : 1;
                        ok += n;
                        updateRow(i, { status: 'done', message: n > 1 ? `${n}件を認識` : undefined });
                    } else {
                        const e = await res.json().catch(() => ({}));
                        updateRow(i, { status: 'error', message: e.error || '取り込みに失敗しました' });
                    }
                } catch {
                    updateRow(i, { status: 'error', message: '取り込みに失敗しました' });
                }
            }
        };
        await Promise.all([worker(), worker()]);

        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        if (ok > 0) {
            toast.success(`${ok}件のレシートを取り込みました`);
            fetchReceipts();
        }
    };

    return (
        <div>
            {/* アップロードゾーン */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                className={`mb-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
            >
                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-1">カード利用レシート（画像・PDF）をドラッグ＆ドロップ、または選択してください</p>
                <p className="text-xs text-slate-400 mb-3">明細書の取り込み後、金額・日付の近いレシートを候補として照合できます。</p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
                    <div className="flex items-center gap-1.5 justify-center">
                        <span className="text-xs text-slate-500 whitespace-nowrap">カード名</span>
                        <input
                            value={cardLabel}
                            onChange={(e) => setCardLabel(e.target.value)}
                            list="card-receipt-labels"
                            placeholder="例: AMEX（任意）"
                            className="w-44 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <datalist id="card-receipt-labels">
                            {cardLabels.map((l) => <option key={l} value={l} />)}
                        </datalist>
                    </div>
                    {/* スマホでは撮影を主ボタンに（基本はスマホで撮影するため） */}
                    <button
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={uploading}
                        className="sm:hidden w-full px-4 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                        {uploading ? '取り込み中…' : '写真を撮影'}
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl transition-colors font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 sm:bg-teal-600 sm:text-white sm:border-transparent sm:hover:bg-teal-700"
                    >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? '取り込み中…' : 'ファイルを選択'}
                    </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            </div>

            {/* アップロード進捗 */}
            {uploadRows.length > 0 && (
                <div className="mb-6 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600">取り込み状況</span>
                        {!uploading && (
                            <button onClick={() => setUploadRows([])} className="text-xs text-slate-400 hover:text-slate-600">閉じる</button>
                        )}
                    </div>
                    <div className="space-y-1 max-h-40 overflow-auto">
                        {uploadRows.map((r, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                                {r.status === 'done' ? (
                                    <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                                ) : r.status === 'error' ? (
                                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                ) : (
                                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
                                )}
                                <span className="truncate text-slate-700">{r.name}</span>
                                <span className={`ml-auto shrink-0 text-xs ${r.status === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                                    {r.status === 'compressing' ? '準備中…' : r.status === 'uploading' ? 'AI読み取り中…' : r.status === 'done' ? (r.message ?? '完了') : r.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 絞り込み */}
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm shrink-0">
                    <button onClick={() => setLinkedFilter('')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${linkedFilter === '' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>すべて</button>
                    <button onClick={() => setLinkedFilter('unlinked')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${linkedFilter === 'unlinked' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>未照合 {unlinkedCount > 0 && `(${unlinkedCount})`}</button>
                    <button onClick={() => setLinkedFilter('linked')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${linkedFilter === 'linked' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>照合済み</button>
                </div>
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="店名・カード名・費目・メモで検索"
                    className="w-full sm:flex-1 sm:max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
            </div>

            {/* 一覧 */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                    <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p>{receipts.length === 0 ? 'レシートはまだありません' : 'この条件のレシートはありません'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filtered.map((r) => {
                        const isPdf = r.mimeType === 'application/pdf' || r.sourceType === 'pdf';
                        return (
                            <button
                                key={r.id}
                                onClick={() => setSelected(r)}
                                className="text-left bg-white rounded-xl border border-slate-200 hover:border-teal-300 hover:shadow-md transition-all overflow-hidden"
                            >
                                <div className="aspect-[4/3] bg-slate-100 flex items-center justify-center overflow-hidden">
                                    {isPdf ? (
                                        <FileText className="w-10 h-10 text-slate-300" />
                                    ) : r.thumbnailSignedUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={r.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                        <ImageIcon className="w-10 h-10 text-slate-300" />
                                    )}
                                </div>
                                <div className="p-3">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <span className="truncate text-sm font-medium text-slate-800">{r.storeName || '（店名未読取）'}</span>
                                        <span className="shrink-0 text-sm font-semibold text-slate-900">{yen(r.totalAmount)}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                                        <span>{fmtDate(r.issueDate)}{r.cardLabel ? ` ・ ${r.cardLabel}` : ''}</span>
                                        {r.statementLine ? (
                                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 font-semibold">
                                                照合済み
                                            </span>
                                        ) : (
                                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">
                                                未照合
                                            </span>
                                        )}
                                    </div>
                                    {(r.expenseCategory || r.statementLine?.statement) && (
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                            {r.expenseCategory && (
                                                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-slate-50 text-slate-600 border border-slate-200">{r.expenseCategory.name}</span>
                                            )}
                                            {r.statementLine?.statement && (
                                                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-teal-50 text-teal-700 border border-teal-100">
                                                    {r.statementLine.statement.cardLabel} {fmtDate(r.statementLine.statement.closingDate)}締め
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* 編集モーダル */}
            {selected && (
                <CardReceiptEditModal
                    receipt={selected}
                    categories={categories}
                    onClose={() => setSelected(null)}
                    onSaved={() => { setSelected(null); fetchReceipts(); }}
                />
            )}
        </div>
    );
}
