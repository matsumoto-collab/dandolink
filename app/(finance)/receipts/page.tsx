'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, ChevronLeft, ChevronRight, Download, CheckCircle2, XCircle } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { Receipt, ExpenseCategoryRef } from '@/types/receipt';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/types/receipt';
import ReceiptClassifyModal from '@/components/Receipts/ReceiptClassifyModal';

const TABS = [
    { id: 'pending', label: '未仕分け' },
    { id: 'confirmed', label: '仕分け済み' },
] as const;
type TabId = (typeof TABS)[number]['id'];
type SortKey = 'date' | 'amount' | 'store' | 'settled';

// Vercel のリクエストボディ上限（約4.5MB）。圧縮後の画像・PDF がこれを超えたら送信前に弾く。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const yen = (n: number | string | null) => (n == null || n === '' ? '—' : `¥${Number(n).toLocaleString()}`);
const fmtDate = (s: string | null) => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
// 精算日時は実時刻（タイムスタンプ）なので端末のローカル時刻（JST）で日付表示する。
const fmtLocalDate = (s: string | null) => {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
// ローカル(JST)の 'YYYY-MM-DD'。精算日の登録・フィルタ・比較に使う（date input と同じ書式）。
const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localYmd = (s: string | null) => {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '' : toYmd(d);
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
    const [scope, setScope] = useState<'month' | 'all'>('month'); // 発生日の月別 / 全期間
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [paymentFilter, setPaymentFilter] = useState('');
    const [settledFilter, setSettledFilter] = useState<'' | 'unsettled' | 'settled'>('');
    const [settledFrom, setSettledFrom] = useState(''); // 精算日で絞り込み（'YYYY-MM-DD'・空=無制限）
    const [settledTo, setSettledTo] = useState('');
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);
    // 「精算済み」を登録するときに使う精算日（既定=今日）。固定なので同じ日付を続けて使える。
    const [settleDate, setSettleDate] = useState(() => toYmd(new Date()));

    const fetchReceipts = useCallback(async () => {
        setIsLoading(true);
        try {
            const url =
                activeTab === 'confirmed'
                    ? scope === 'all'
                        ? '/api/receipts?status=confirmed'
                        : `/api/receipts?status=confirmed&year=${year}&month=${month}`
                    : '/api/receipts?status=pending';
            const res = await fetch(url, { cache: 'no-store' });
            setReceipts(res.ok ? await res.json() : []);
        } catch (e) {
            logger.error('Failed to fetch receipts:', e);
            setReceipts([]);
        } finally {
            setIsLoading(false);
        }
    }, [activeTab, scope, year, month]);

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

    // 仕分け済みタブのクライアント絞り込み（複数条件をANDで適用）
    const filtered = useMemo(() => {
        if (activeTab !== 'confirmed') return receipts;
        const q = search.trim().toLowerCase();
        return receipts.filter((r) => {
            if (categoryFilter && r.expenseCategoryId !== categoryFilter) return false;
            if (paymentFilter && r.paymentMethod !== paymentFilter) return false;
            if (settledFilter === 'settled' && !r.settled) return false;
            if (settledFilter === 'unsettled' && r.settled) return false;
            // 精算日での絞り込み（範囲指定があれば、その期間に精算されたものだけ・未精算は除外）
            if (settledFrom || settledTo) {
                const sy = localYmd(r.settledAt);
                if (!sy) return false;
                if (settledFrom && sy < settledFrom) return false;
                if (settledTo && sy > settledTo) return false;
            }
            if (q) {
                const hay = `${r.storeName ?? ''} ${r.notes ?? ''} ${r.paidBy ?? ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [activeTab, receipts, categoryFilter, paymentFilter, settledFilter, settledFrom, settledTo, search]);

    // 並び替え（仕分け済みのみ）
    const sorted = useMemo(() => {
        if (activeTab !== 'confirmed') return filtered;
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...filtered].sort((a, b) => {
            if (sortKey === 'amount') return (Number(a.totalAmount || 0) - Number(b.totalAmount || 0)) * dir;
            if (sortKey === 'store') return (a.storeName || '').localeCompare(b.storeName || '', 'ja') * dir;
            if (sortKey === 'settled') {
                // 精算日で並べ替え。未精算（精算日なし）は方向に関わらず末尾へ。
                const at = a.settledAt ? new Date(a.settledAt).getTime() : null;
                const bt = b.settledAt ? new Date(b.settledAt).getTime() : null;
                if (at == null && bt == null) return 0;
                if (at == null) return 1;
                if (bt == null) return -1;
                return (at - bt) * dir;
            }
            const ad = a.issueDate ? new Date(a.issueDate).getTime() : 0;
            const bd = b.issueDate ? new Date(b.issueDate).getTime() : 0;
            return (ad - bd) * dir;
        });
    }, [activeTab, filtered, sortKey, sortDir]);

    const changeSort = (key: SortKey) => {
        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir(key === 'date' ? 'asc' : 'desc'); }
    };

    // 精算済みフラグの切替（楽観更新・失敗時は戻す）。
    // 精算登録時は固定の「精算日として登録」の日付を使う（既定=今日・同じ日付を続けて使える）。
    const toggleSettled = async (r: Receipt) => {
        const next = !r.settled;
        const applied = next ? (settleDate || toYmd(new Date())) : '';
        // 楽観表示: 登録日は UTC 0時（保存値と同じ）にして fmtLocalDate で同じ日付を出す
        const optimisticAt = next ? `${applied}T00:00:00.000Z` : null;
        setReceipts((prev) => prev.map((x) => (x.id === r.id ? { ...x, settled: next, settledAt: optimisticAt } : x)));
        try {
            const res = await fetch(`/api/receipts/${r.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next ? { settled: true, settledAt: applied } : { settled: false }),
            });
            if (!res.ok) throw new Error();
            const updated = await res.json().catch(() => null);
            if (updated && updated.id) {
                setReceipts((prev) => prev.map((x) => (x.id === r.id ? { ...x, settled: updated.settled, settledAt: updated.settledAt } : x)));
            }
        } catch {
            setReceipts((prev) => prev.map((x) => (x.id === r.id ? { ...x, settled: r.settled, settledAt: r.settledAt } : x)));
            toast.error('精算状況の更新に失敗しました');
        }
    };

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
        const header = ['日付', '店名・支払先', '支払方法', '税込金額', '消費税', '費目', '支払者', '精算', '精算日', 'メモ'];
        const rows = sorted.map((r) => [
            fmtDate(r.issueDate),
            r.storeName ?? '',
            pmLabel(r.paymentMethod),
            String(Number(r.totalAmount || 0)),
            String(Number(r.taxAmount || 0)),
            r.expenseCategory?.name ?? '',
            r.paidBy ?? '',
            r.settled ? '精算済み' : '未精算',
            r.settled ? fmtLocalDate(r.settledAt) : '',
            (r.notes ?? '').replace(/[\r\n]+/g, ' '),
        ]);
        const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = scope === 'all' ? '領収書_全期間.csv' : `領収書_${year}-${String(month).padStart(2, '0')}.csv`;
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
                    {/* 表示範囲（発生日の月別 / 全期間）＋月切替 */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm shrink-0">
                            <button onClick={() => setScope('month')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${scope === 'month' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>月別</button>
                            <button onClick={() => setScope('all')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${scope === 'all' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>全期間</button>
                        </div>
                        {scope === 'month' ? (
                            <div className="flex items-center gap-2 flex-1 sm:flex-none">
                                <button onClick={goPrev} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="前月"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
                                <div className="flex-1 sm:flex-none sm:min-w-[120px] px-1 text-center text-base sm:text-lg font-semibold text-slate-800 whitespace-nowrap">{year}年{month}月</div>
                                <button onClick={goNext} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="翌月"><ChevronRight className="w-5 h-5 text-slate-600" /></button>
                                <button onClick={goToday} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">今月</button>
                            </div>
                        ) : (
                            <span className="text-sm text-slate-500">すべての期間（発生日）を表示中</span>
                        )}
                    </div>
                    {/* 精算日として登録（未精算バッジのタップ時に使う日付・固定なので同じ日付を続けて使える） */}
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <span className="text-xs font-semibold text-emerald-800 whitespace-nowrap">精算日として登録</span>
                        <input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        <button type="button" onClick={() => setSettleDate(toYmd(new Date()))} className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100">今日</button>
                        <span className="text-xs text-emerald-700/80 w-full sm:w-auto">この日付で「未精算」→「精算済み」を登録します（同じ日付を続けて使えます）。</span>
                    </div>
                    {/* 絞り込み・並び替え・CSV（スマホは縦積み） */}
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full sm:w-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500">
                            <option value="">すべての費目</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="w-full sm:w-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500">
                            <option value="">すべての支払方法</option>
                            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                        </select>
                        <select value={settledFilter} onChange={(e) => setSettledFilter(e.target.value as '' | 'unsettled' | 'settled')} className="w-full sm:w-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500">
                            <option value="">精算：すべて</option>
                            <option value="unsettled">未精算のみ</option>
                            <option value="settled">精算済みのみ</option>
                        </select>
                        {/* 精算日で絞り込み（範囲・空欄は無制限） */}
                        <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 w-full sm:w-auto">
                            <span className="text-xs text-slate-500 whitespace-nowrap">精算日</span>
                            <input type="date" value={settledFrom} onChange={(e) => setSettledFrom(e.target.value)} title="精算日（開始）" className="min-w-0 flex-1 sm:w-[132px] rounded-lg border border-slate-200 px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500" />
                            <span className="text-slate-400 shrink-0">〜</span>
                            <input type="date" value={settledTo} onChange={(e) => setSettledTo(e.target.value)} title="精算日（終了）" className="min-w-0 flex-1 sm:w-[132px] rounded-lg border border-slate-200 px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500" />
                            {(settledFrom || settledTo) && (
                                <button onClick={() => { setSettledFrom(''); setSettledTo(''); }} title="精算日フィルタを解除" className="shrink-0 px-1 text-slate-400 hover:text-slate-600">✕</button>
                            )}
                        </div>
                        <select value={`${sortKey}:${sortDir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSortKey(k as SortKey); setSortDir(d as 'asc' | 'desc'); }} className="w-full sm:w-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500">
                            <option value="date:asc">日付（古い順）</option>
                            <option value="date:desc">日付（新しい順）</option>
                            <option value="amount:desc">金額（高い順）</option>
                            <option value="amount:asc">金額（安い順）</option>
                            <option value="store:asc">店名（あ→わ）</option>
                            <option value="settled:desc">精算日（新しい順）</option>
                            <option value="settled:asc">精算日（古い順）</option>
                        </select>
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="店名・メモ・支払者で検索" className="w-full sm:flex-1 sm:min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500" />
                        <button onClick={exportCsv} disabled={sorted.length === 0} className="w-full sm:w-auto justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
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
            ) : sorted.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                    <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p>{activeTab === 'pending' ? '未仕分けの領収書はありません' : 'この条件の仕分け済み領収書はありません'}</p>
                </div>
            ) : activeTab === 'confirmed' ? (
                <ConfirmedReceiptList rows={sorted} onSelect={setSelected} onToggleSettled={toggleSettled} sortKey={sortKey} sortDir={sortDir} onSort={changeSort} />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {sorted.map((r) => (
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
// 見出しクリックで並び替え、精算バッジのタップで精算済み/未精算を切替。
function ConfirmedReceiptList({ rows, onSelect, onToggleSettled, sortKey, sortDir, onSort }: {
    rows: Receipt[];
    onSelect: (r: Receipt) => void;
    onToggleSettled: (r: Receipt) => void;
    sortKey: SortKey;
    sortDir: 'asc' | 'desc';
    onSort: (key: SortKey) => void;
}) {
    const mark = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
    const settledPill = (r: Receipt) => (
        <button
            onClick={(e) => { e.stopPropagation(); onToggleSettled(r); }}
            title="タップで精算済み/未精算を切替"
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${r.settled ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}
        >
            {r.settled ? '✓ 精算済み' : '未精算'}
        </button>
    );
    return (
        <>
            {/* デスクトップ: テーブル（見出しクリックで並び替え） */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 whitespace-nowrap"><button onClick={() => onSort('date')} className="hover:text-slate-900">日付{mark('date')}</button></th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700"><button onClick={() => onSort('store')} className="hover:text-slate-900">店名・支払先{mark('store')}</button></th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 whitespace-nowrap">支払方法</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-700 whitespace-nowrap"><button onClick={() => onSort('amount')} className="hover:text-slate-900">税込金額{mark('amount')}</button></th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700">費目</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 whitespace-nowrap">支払者</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-700 whitespace-nowrap"><button onClick={() => onSort('settled')} className="hover:text-slate-900">精算{mark('settled')}</button></th>
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
                                    <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                        {settledPill(r)}
                                        {r.settled && r.settledAt && <div className="text-[11px] text-slate-400 mt-0.5">{fmtLocalDate(r.settledAt)}</div>}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-500 max-w-[220px] truncate">{r.notes || '−'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* モバイル: コンパクトなリスト（タップで画像プレビュー・精算トグル付き） */}
            <div className="md:hidden space-y-2">
                {rows.map((r) => (
                    <div key={r.id} role="button" tabIndex={0} onClick={() => onSelect(r)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 hover:shadow-sm transition-shadow cursor-pointer">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-900 truncate">{r.storeName || '（店名 未取得）'}</span>
                            <span className="font-bold text-slate-900 shrink-0">{yen(r.totalAmount)}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                            {fmtDate(r.issueDate)}
                            {r.paymentMethod ? ` ・ ${pmLabel(r.paymentMethod)}` : ''}
                            {r.paidBy ? ` ・ ${r.paidBy}` : ''}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {r.expenseCategory ? (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700 border border-amber-200">{r.expenseCategory.name}</span>
                            ) : (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-slate-50 text-slate-500 border border-slate-200">費目 未選択</span>
                            )}
                            {settledPill(r)}
                            {r.settled && r.settledAt && <span className="text-[11px] text-slate-400">精算 {fmtLocalDate(r.settledAt)}</span>}
                        </div>
                        {r.notes && <div className="text-xs text-slate-500 mt-1 truncate">{r.notes}</div>}
                    </div>
                ))}
            </div>
        </>
    );
}
