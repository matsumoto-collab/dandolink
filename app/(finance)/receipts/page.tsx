'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, ChevronLeft, ChevronRight, Download, CheckCircle2, XCircle } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { Receipt, ExpenseCategoryRef } from '@/types/receipt';
import { PAYMENT_METHOD_LABELS } from '@/types/receipt';
import ReceiptClassifyModal from '@/components/Receipts/ReceiptClassifyModal';

const TABS = [
    { id: 'pending', label: '未仕分け' },
    { id: 'confirmed', label: '仕分け済み' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Vercel のリクエストボディ上限（約4.5MB）。圧縮後の画像・PDF がこれを超えたら送信前に弾く。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const yen = (n: number | string | null) => (n == null || n === '' ? '—' : `¥${Number(n).toLocaleString()}`);
const fmtDate = (s: string | null) => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const pmLabel = (m: string | null) => (m && m in PAYMENT_METHOD_LABELS ? PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] : '');
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

type UploadStatus = 'compressing' | 'uploading' | 'done' | 'error';
interface UploadRow { name: string; status: UploadStatus; message?: string }

// クライアント側の前処理。画像は圧縮（失敗時は原本）、PDFは無加工。上限超過はエラーで返す。
async function prepareFile(file: File): Promise<{ blob: Blob; name: string } | { error: string }> {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImg = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);

    if (isPdf) {
        if (file.size > MAX_UPLOAD_BYTES) return { error: 'PDFは4MB以下にしてください' };
        return { blob: file, name: file.name };
    }
    if (isImg) {
        let blob: Blob = file;
        if (file.size > 1024 * 1024) {
            try {
                blob = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 2000, useWebWorker: true, initialQuality: 0.8 });
            } catch {
                blob = file; // HEIC 等で圧縮に失敗したら原本を送る（サーバの sharp が変換）
            }
        }
        if (blob.size > MAX_UPLOAD_BYTES) return { error: '画像が大きすぎます（4MB以下にしてください）' };
        return { blob, name: file.name };
    }
    return { error: '対応していないファイル形式です（画像・PDF）' };
}

export default function ReceiptsPage() {
    const [activeTab, setActiveTab] = useState<TabId>('pending');
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [selected, setSelected] = useState<Receipt | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // 仕分け済みタブの絞り込み
    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [search, setSearch] = useState('');
    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);

    const fetchReceipts = useCallback(async () => {
        setIsLoading(true);
        try {
            const url =
                activeTab === 'confirmed' ? `/api/receipts?status=confirmed&year=${year}&month=${month}` : '/api/receipts?status=pending';
            const res = await fetch(url, { cache: 'no-store' });
            setReceipts(res.ok ? await res.json() : []);
        } catch (e) {
            logger.error('Failed to fetch receipts:', e);
            setReceipts([]);
        } finally {
            setIsLoading(false);
        }
    }, [activeTab, year, month]);

    useEffect(() => {
        fetchReceipts();
    }, [fetchReceipts]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/master-data/expense-categories');
                if (res.ok) setCategories(await res.json());
            } catch (e) {
                logger.error('category fetch failed', e);
            }
        })();
    }, []);

    const goPrev = () => {
        if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
    };
    const goNext = () => {
        if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
    };
    const goToday = () => {
        const t = new Date();
        setYear(t.getFullYear());
        setMonth(t.getMonth() + 1);
    };

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
                    const res = await fetch('/api/receipts', { method: 'POST', body: fd });
                    if (res.ok) {
                        // 1枚の画像から複数の領収書が分割されることがある（返り値は作成された領収書の配列）
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
            toast.success(`${ok}件の領収書を取り込みました`);
            if (activeTab !== 'pending') setActiveTab('pending');
            else fetchReceipts();
        }
    };

    // 仕分け済みタブのクライアント絞り込み
    const filtered = useMemo(() => {
        if (activeTab !== 'confirmed') return receipts;
        const q = search.trim().toLowerCase();
        return receipts.filter((r) => {
            if (categoryFilter && r.expenseCategoryId !== categoryFilter) return false;
            if (q) {
                const hay = `${r.storeName ?? ''} ${r.notes ?? ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [activeTab, receipts, categoryFilter, search]);

    const categoryTotals = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of filtered) {
            const name = r.expenseCategory?.name ?? '未分類';
            map.set(name, (map.get(name) ?? 0) + Number(r.totalAmount || 0));
        }
        return Array.from(map.entries());
    }, [filtered]);
    const grandTotal = useMemo(() => filtered.reduce((s, r) => s + Number(r.totalAmount || 0), 0), [filtered]);

    const exportCsv = () => {
        const header = ['日付', '店名・支払先', '支払方法', '税込金額', '消費税', '費目', '支払者', 'メモ'];
        const rows = filtered.map((r) => [
            fmtDate(r.issueDate),
            r.storeName ?? '',
            pmLabel(r.paymentMethod),
            String(Number(r.totalAmount || 0)),
            String(Number(r.taxAmount || 0)),
            r.expenseCategory?.name ?? '',
            r.paidBy ?? '',
            (r.notes ?? '').replace(/[\r\n]+/g, ' '),
        ]);
        const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `領収書_${year}-${String(month).padStart(2, '0')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="max-w-[1800px] mx-auto w-full min-w-0">
            <div className="mb-4">
                <h2 className="text-xl font-bold text-slate-900">領収書</h2>
                <p className="text-sm text-slate-500 mt-1">領収書・レシートを取り込み、AIが読み取った内容を確認して費目で仕分け・保管します。</p>
            </div>

            {/* アップロードゾーン */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                className={`mb-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
            >
                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-1">領収書（画像・PDF）をドラッグ＆ドロップ、または選択してください</p>
                <p className="text-xs text-slate-400 mb-3">複数の領収書を1枚に並べて撮ってもOK。AIが自動で分けて費目まで仕分けます。</p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
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

            {/* タブ */}
            <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-full sm:w-fit">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={`flex-1 sm:flex-none px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* 仕分け済みタブのツールバー */}
            {activeTab === 'confirmed' && (
                <div className="mb-4 space-y-2">
                    {/* 月切替 */}
                    <div className="flex items-center gap-2">
                        <button onClick={goPrev} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="前月"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
                        <div className="flex-1 sm:flex-none sm:min-w-[120px] px-1 text-center text-base sm:text-lg font-semibold text-slate-800 whitespace-nowrap">{year}年{month}月</div>
                        <button onClick={goNext} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="翌月"><ChevronRight className="w-5 h-5 text-slate-600" /></button>
                        <button onClick={goToday} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">今月</button>
                    </div>
                    {/* 費目フィルタ・検索・CSV（スマホは縦積み） */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full sm:w-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500">
                            <option value="">すべての費目</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="店名・メモで検索" className="w-full sm:flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500" />
                        <button onClick={exportCsv} disabled={filtered.length === 0} className="w-full sm:w-auto justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
                            <Download className="w-4 h-4" />CSV出力
                        </button>
                    </div>
                    {/* 費目別合計 */}
                    {filtered.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            {categoryTotals.map(([name, sum]) => (
                                <span key={name} className="px-2.5 py-1 text-xs rounded-full bg-white border border-slate-200 text-slate-700">
                                    {name} <strong>¥{sum.toLocaleString()}</strong>
                                </span>
                            ))}
                            <span className="w-full sm:w-auto sm:ml-auto text-right text-sm font-semibold text-slate-800">合計 ¥{grandTotal.toLocaleString()}</span>
                        </div>
                    )}
                </div>
            )}

            {/* 一覧 */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                    <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p>{activeTab === 'pending' ? '未仕分けの領収書はありません' : 'この月の仕分け済み領収書はありません'}</p>
                </div>
            ) : activeTab === 'confirmed' ? (
                <ConfirmedReceiptList rows={filtered} onSelect={setSelected} />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filtered.map((r) => (
                        <button
                            key={r.id}
                            onClick={() => setSelected(r)}
                            className="text-left bg-white rounded-xl border border-slate-200 hover:border-teal-300 hover:shadow-md transition-all overflow-hidden"
                        >
                            <div className="aspect-[4/3] bg-slate-100 flex items-center justify-center overflow-hidden">
                                {r.thumbnailSignedUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={r.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                                ) : r.mimeType !== 'application/pdf' && r.signedUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={r.signedUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <FileText className="w-10 h-10 text-slate-300" />
                                )}
                            </div>
                            <div className="p-3">
                                <div className="font-medium text-slate-900 truncate">{r.storeName || '（店名 未取得）'}</div>
                                <div className="text-lg font-bold text-slate-900 mt-0.5">{yen(r.totalAmount)}</div>
                                <div className="text-xs text-slate-500 mt-1">{fmtDate(r.issueDate)}</div>
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {r.expenseCategory ? (
                                        <span className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700 border border-amber-200 truncate max-w-full">{r.expenseCategory.name}</span>
                                    ) : (
                                        <span className="px-2 py-0.5 text-xs rounded-full bg-slate-50 text-slate-500 border border-slate-200">費目 未選択</span>
                                    )}
                                    {r.paymentMethod && (
                                        <span className="px-2 py-0.5 text-xs rounded-full bg-slate-50 text-slate-600 border border-slate-200">{pmLabel(r.paymentMethod)}</span>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {selected && (
                <ReceiptClassifyModal
                    receipt={selected}
                    onClose={() => setSelected(null)}
                    onSaved={() => { setSelected(null); fetchReceipts(); }}
                />
            )}
        </div>
    );
}

// 仕分け済みの一覧。案件一覧・見積一覧と同じテーブル体裁（行クリックで画像プレビューのモーダル）。
// 一覧ではサムネイル画像を出さず容量を節約し、クリック時に初めて画像を読み込む。
function ConfirmedReceiptList({ rows, onSelect }: { rows: Receipt[]; onSelect: (r: Receipt) => void }) {
    return (
        <>
            {/* デスクトップ: テーブル */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 whitespace-nowrap">日付</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700">店名・支払先</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 whitespace-nowrap">支払方法</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 whitespace-nowrap">税込金額</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700">費目</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 whitespace-nowrap">支払者</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700">メモ</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {rows.map((r) => (
                                <tr key={r.id} onClick={() => onSelect(r)} className="hover:bg-slate-50 cursor-pointer">
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{fmtDate(r.issueDate)}</td>
                                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{r.storeName || '（店名 未取得）'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">{pmLabel(r.paymentMethod) || '−'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-semibold text-slate-900">{yen(r.totalAmount)}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                                        {r.expenseCategory ? (
                                            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700 border border-amber-200">{r.expenseCategory.name}</span>
                                        ) : (
                                            <span className="text-slate-400">−</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">{r.paidBy || '−'}</td>
                                    <td className="px-4 py-3 text-sm text-slate-500 max-w-[220px] truncate">{r.notes || '−'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* モバイル: コンパクトなリスト（タップで画像プレビュー） */}
            <div className="md:hidden space-y-2">
                {rows.map((r) => (
                    <button key={r.id} onClick={() => onSelect(r)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 hover:shadow-sm transition-shadow">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-900 truncate">{r.storeName || '（店名 未取得）'}</span>
                            <span className="font-bold text-slate-900 shrink-0">{yen(r.totalAmount)}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                            {fmtDate(r.issueDate)}
                            {r.paymentMethod ? ` ・ ${pmLabel(r.paymentMethod)}` : ''}
                            {r.paidBy ? ` ・ ${r.paidBy}` : ''}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {r.expenseCategory ? (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700 border border-amber-200">{r.expenseCategory.name}</span>
                            ) : (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-slate-50 text-slate-500 border border-slate-200">費目 未選択</span>
                            )}
                        </div>
                        {r.notes && <div className="text-xs text-slate-500 mt-1 truncate">{r.notes}</div>}
                    </button>
                ))}
            </div>
        </>
    );
}
