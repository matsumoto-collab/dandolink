'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, ChevronLeft, ChevronRight, Download, CheckCircle2, XCircle, Trash2, Plus, X } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { CashbookEntry, CashbookListResponse } from '@/types/cashbook';
import type { ExpenseCategoryRef } from '@/types/receipt';

// Vercel のリクエストボディ上限（約4.5MB）。圧縮後の画像・PDF がこれを超えたら送信前に弾く。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// 残高はマイナスになり得るため符号を前に出して表示する
const yen = (n: number) => (n < 0 ? `-¥${Math.abs(n).toLocaleString()}` : `¥${n.toLocaleString()}`);
const fmtDate = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
// ローカル(JST)の 'YYYY-MM-DD'（date input と同じ書式）
const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export default function CashbookPage() {
    const [entries, setEntries] = useState<CashbookEntry[]>([]);
    const [openingBalance, setOpeningBalance] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<CashbookEntry | null>(null);
    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const today = new Date();
    const [scope, setScope] = useState<'month' | 'all'>('month');
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);

    const fetchEntries = useCallback(async () => {
        setIsLoading(true);
        try {
            const url = scope === 'all' ? '/api/cashbook?scope=all' : `/api/cashbook?scope=month&year=${year}&month=${month}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) {
                const data: CashbookListResponse = await res.json();
                setEntries(data.entries);
                setOpeningBalance(Number(data.openingBalance || 0));
            } else {
                setEntries([]);
                setOpeningBalance(0);
            }
        } catch (e) {
            logger.error('Failed to fetch cashbook:', e);
            setEntries([]);
            setOpeningBalance(0);
        } finally {
            setIsLoading(false);
        }
    }, [scope, year, month]);

    useEffect(() => {
        fetchEntries();
    }, [fetchEntries]);

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

    // 行追加の既定日付: 表示中の月が今月なら今日、過去/未来の月ならその月の1日
    const defaultDateForNew = () => {
        const t = new Date();
        if (scope === 'all' || (t.getFullYear() === year && t.getMonth() + 1 === month)) return toYmd(t);
        return `${year}-${String(month).padStart(2, '0')}-01`;
    };

    const addRow = async (entryType: 'in' | 'out') => {
        try {
            const res = await fetch('/api/cashbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: defaultDateForNew(), entryType }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            await fetchEntries();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '行の追加に失敗しました');
        }
    };

    // セル編集のオートセーブ。成功したら該当行だけ差し替え、日付が表示月の外に出たときは再取得する。
    const applyPatch = async (id: string, patch: Record<string, unknown>) => {
        setSavingId(id);
        try {
            const res = await fetch(`/api/cashbook/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const updated: CashbookEntry = await res.json();
            if (scope === 'month' && 'date' in patch) {
                const d = new Date(updated.date);
                if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month) {
                    toast.success(`${fmtDate(updated.date)} へ移動しました（表示中の月の外）`);
                    await fetchEntries();
                    return;
                }
            }
            setEntries((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '保存に失敗しました');
            setEntries((prev) => [...prev]); // 入力セルを保存済みの値に戻すための再レンダー
        } finally {
            setSavingId(null);
        }
    };

    const deleteRow = async (entry: CashbookEntry) => {
        const label = `${fmtDate(entry.date)} ${entry.description ?? ''} ${yen(Number(entry.amount || 0))}`.trim();
        if (!confirm(`この行を削除しますか？\n${label}`)) return;
        setSavingId(entry.id);
        try {
            const res = await fetch(`/api/cashbook/${entry.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            toast.success('削除しました');
            await fetchEntries();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '削除に失敗しました');
        } finally {
            setSavingId(null);
        }
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
                    const res = await fetch('/api/cashbook/upload', { method: 'POST', body: fd });
                    if (res.ok) {
                        // 1枚の画像から複数の領収書が分割されることがある（返り値は作成された出金行の配列）
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
            toast.success(`${ok}件の出金行を作成しました`);
            fetchEntries();
        }
    };

    // 差引残高つきの表示行（並びは API の date asc, seq asc をそのまま使う）
    const rowsWithBalance = useMemo(() => {
        let bal = scope === 'month' ? openingBalance : 0;
        return entries.map((entry) => {
            const amt = Number(entry.amount || 0);
            bal += entry.entryType === 'in' ? amt : -amt;
            return { entry, balance: bal };
        });
    }, [entries, openingBalance, scope]);

    const totalIn = useMemo(() => entries.reduce((s, e) => s + (e.entryType === 'in' ? Number(e.amount || 0) : 0), 0), [entries]);
    const totalOut = useMemo(() => entries.reduce((s, e) => s + (e.entryType === 'out' ? Number(e.amount || 0) : 0), 0), [entries]);
    const closingBalance = (scope === 'month' ? openingBalance : 0) + totalIn - totalOut;

    const exportCsv = () => {
        const header = ['日付', '費目', '摘要', '入金額', '出金額', '差引残高'];
        const rows: string[][] = [];
        if (scope === 'month') {
            rows.push(['', '', '前月繰越', '', '', String(openingBalance)]);
        }
        for (const { entry, balance } of rowsWithBalance) {
            rows.push([
                fmtDate(entry.date),
                entry.expenseCategory?.name ?? '',
                entry.description ?? '',
                entry.entryType === 'in' ? String(Number(entry.amount || 0)) : '',
                entry.entryType === 'out' ? String(Number(entry.amount || 0)) : '',
                String(balance),
            ]);
        }
        const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = scope === 'all' ? '現金出納帳_全期間.csv' : `現金出納帳_${year}-${String(month).padStart(2, '0')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="max-w-[1500px] mx-auto w-full min-w-0">
            <div className="mb-4">
                <h2 className="text-xl font-bold text-slate-900">現金出納帳</h2>
                <p className="text-sm text-slate-500 mt-1">入金・出金を記帳して残高を管理します。出金は領収書（画像・PDF）の取り込みでも作成できます。</p>
            </div>

            {/* アップロードゾーン（出金行の作成） */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                className={`mb-4 rounded-xl border-2 border-dashed p-4 sm:p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
            >
                <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-1">領収書（画像・PDF）を取り込むと、AIが読み取って出金行を自動で作成します</p>
                <p className="text-xs text-slate-400 mb-3">日付・金額・摘要・費目は取り込み後にそのまま表で修正できます。</p>
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
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
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

            {/* ツールバー: 表示範囲＋行追加＋CSV */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm shrink-0">
                    <button onClick={() => setScope('month')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${scope === 'month' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>月別</button>
                    <button onClick={() => setScope('all')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${scope === 'all' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>全期間</button>
                </div>
                {scope === 'month' ? (
                    <div className="flex items-center gap-2">
                        <button onClick={goPrev} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="前月"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
                        <div className="min-w-[110px] px-1 text-center text-base sm:text-lg font-semibold text-slate-800 whitespace-nowrap">{year}年{month}月</div>
                        <button onClick={goNext} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="翌月"><ChevronRight className="w-5 h-5 text-slate-600" /></button>
                        <button onClick={goToday} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">今月</button>
                    </div>
                ) : (
                    <span className="text-sm text-slate-500">すべての期間を表示中</span>
                )}
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
                    <button onClick={() => addRow('in')} className="flex-1 sm:flex-none justify-center rounded-xl bg-teal-600 text-white px-3 py-2 text-sm font-medium hover:bg-teal-700 inline-flex items-center gap-1.5">
                        <Plus className="w-4 h-4" />入金行を追加
                    </button>
                    <button onClick={() => addRow('out')} className="flex-1 sm:flex-none justify-center rounded-xl bg-teal-600 text-white px-3 py-2 text-sm font-medium hover:bg-teal-700 inline-flex items-center gap-1.5">
                        <Plus className="w-4 h-4" />出金行を追加
                    </button>
                    <button onClick={exportCsv} disabled={entries.length === 0} className="w-full sm:w-auto justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
                        <Download className="w-4 h-4" />CSV出力
                    </button>
                </div>
            </div>

            {/* 帳簿テーブル */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-[900px] w-full divide-y divide-slate-200">
                            <thead className="bg-slate-100">
                                <tr>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[140px]">日付</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[150px]">費目</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700">摘要</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[130px]">入金額</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[130px]">出金額</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[140px]">差引残高</th>
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-700 w-[64px]">証憑</th>
                                    <th className="px-3 py-3 w-[48px]"><span className="sr-only">削除</span></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-100">
                                {scope === 'month' && (
                                    <tr className="bg-slate-50">
                                        <td className="px-3 py-2.5 text-sm text-slate-500 whitespace-nowrap">—</td>
                                        <td className="px-3 py-2.5" />
                                        <td className="px-3 py-2.5 text-sm font-medium text-slate-600">前月繰越</td>
                                        <td className="px-3 py-2.5" />
                                        <td className="px-3 py-2.5" />
                                        <td className={`px-3 py-2.5 text-right text-sm font-semibold whitespace-nowrap ${openingBalance < 0 ? 'text-red-600' : 'text-slate-700'}`}>{yen(openingBalance)}</td>
                                        <td className="px-3 py-2.5" />
                                        <td className="px-3 py-2.5" />
                                    </tr>
                                )}
                                {rowsWithBalance.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                                            <FileText className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                            {scope === 'month' ? 'この月の記帳はまだありません。' : 'まだ記帳がありません。'}「入金行を追加」または領収書の取り込みから始めてください。
                                        </td>
                                    </tr>
                                )}
                                {rowsWithBalance.map(({ entry, balance }) => (
                                    <CashbookRow
                                        key={entry.id}
                                        entry={entry}
                                        balance={balance}
                                        categories={categories}
                                        saving={savingId === entry.id}
                                        onPatch={(patch) => applyPatch(entry.id, patch)}
                                        onDelete={() => deleteRow(entry)}
                                        onOpenImage={() => setLightbox(entry)}
                                    />
                                ))}
                            </tbody>
                            {rowsWithBalance.length > 0 && (
                                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                                    <tr>
                                        <td colSpan={3} className="px-3 py-3 text-right text-sm font-semibold text-slate-600">{scope === 'month' ? `${month}月合計` : '合計'}</td>
                                        <td className="px-3 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">{yen(totalIn)}</td>
                                        <td className="px-3 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">{yen(totalOut)}</td>
                                        <td className={`px-3 py-3 text-right text-sm font-bold whitespace-nowrap ${closingBalance < 0 ? 'text-red-600' : 'text-slate-900'}`}>{yen(closingBalance)}</td>
                                        <td colSpan={2} />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            )}

            {/* 証憑画像のライトボックス */}
            {lightbox?.signedUrl && (
                <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
                    <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="閉じる">
                        <X className="w-6 h-6" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightbox.signedUrl} alt={lightbox.fileName ?? '証憑'} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

// 1行分。セルの blur / 選択でそのまま保存する（行単位オートセーブ）。
function CashbookRow({ entry, balance, categories, saving, onPatch, onDelete, onOpenImage }: {
    entry: CashbookEntry;
    balance: number;
    categories: ExpenseCategoryRef[];
    saving: boolean;
    onPatch: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
    onOpenImage: () => void;
}) {
    const amount = Number(entry.amount || 0);
    const dateYmd = entry.date.slice(0, 10);
    const isPdf = entry.mimeType === 'application/pdf' || entry.sourceType === 'pdf';

    return (
        <tr className={`hover:bg-slate-50 ${saving ? 'opacity-60' : ''}`}>
            {/* 日付 */}
            <td className="px-2 py-1.5 whitespace-nowrap">
                <input
                    type="date"
                    key={`d-${entry.id}-${dateYmd}`}
                    defaultValue={dateYmd}
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value;
                        if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== dateYmd) onPatch({ date: v });
                        else if (!v) e.target.value = dateYmd; // 空にされたら元へ戻す
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 費目 */}
            <td className="px-2 py-1.5">
                <select
                    value={entry.expenseCategoryId ?? ''}
                    disabled={saving}
                    onChange={(e) => onPatch({ expenseCategoryId: e.target.value || null })}
                    className="w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                    <option value="">—</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </td>
            {/* 摘要 */}
            <td className="px-2 py-1.5">
                <input
                    type="text"
                    key={`t-${entry.id}-${entry.description ?? ''}`}
                    defaultValue={entry.description ?? ''}
                    placeholder="摘要を入力"
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (entry.description ?? '')) onPatch({ description: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full min-w-[180px] rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-800 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 入金額 / 出金額（反対側に入力すると行の向きごと移す） */}
            <AmountCell
                active={entry.entryType === 'in'}
                amount={amount}
                saving={saving}
                onCommit={(n) => onPatch(entry.entryType === 'in' ? { amount: n } : { entryType: 'in', amount: n })}
            />
            <AmountCell
                active={entry.entryType === 'out'}
                amount={amount}
                saving={saving}
                onCommit={(n) => onPatch(entry.entryType === 'out' ? { amount: n } : { entryType: 'out', amount: n })}
            />
            {/* 差引残高 */}
            <td className={`px-3 py-1.5 text-right text-sm font-semibold whitespace-nowrap ${balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {yen(balance)}
            </td>
            {/* 証憑 */}
            <td className="px-2 py-1.5 text-center">
                {!entry.fileName ? (
                    <span className="text-slate-300 text-sm">—</span>
                ) : isPdf ? (
                    entry.signedUrl ? (
                        <a href={entry.signedUrl} target="_blank" rel="noreferrer" title={entry.fileName} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                            <FileText className="w-4 h-4" />
                        </a>
                    ) : (
                        <FileText className="w-4 h-4 text-slate-300 inline-block" />
                    )
                ) : (
                    <button onClick={onOpenImage} title={entry.fileName ?? undefined} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 overflow-hidden hover:ring-2 hover:ring-teal-400">
                        {entry.thumbnailSignedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={entry.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                        )}
                    </button>
                )}
            </td>
            {/* 削除 */}
            <td className="px-2 py-1.5 text-center">
                {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400 inline-block" />
                ) : (
                    <button onClick={onDelete} title="この行を削除" className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </td>
        </tr>
    );
}

// 金額セル。クリックで編集し、blur / Enter で確定（Escape で破棄）。
// active=false（反対側）のセルに入力すると、onCommit 側で entryType ごと入れ替える。
function AmountCell({ active, amount, saving, onCommit }: {
    active: boolean;
    amount: number;
    saving: boolean;
    onCommit: (n: number) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');

    const start = () => {
        if (saving) return;
        setDraft(active && amount !== 0 ? String(amount) : '');
        setEditing(true);
    };
    const commit = () => {
        setEditing(false);
        const cleaned = draft.replace(/[^\d]/g, '');
        if (cleaned === '') return; // 空のまま抜けたら変更なし
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n < 0) return;
        if (active && n === amount) return;
        onCommit(n);
    };

    return (
        <td className="px-2 py-1.5 text-right">
            {editing ? (
                <input
                    autoFocus
                    type="text"
                    inputMode="numeric"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') { setDraft(''); setEditing(false); }
                    }}
                    className="w-full rounded-lg border border-teal-400 bg-white px-2 py-1.5 text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            ) : (
                <button
                    onClick={start}
                    disabled={saving}
                    className={`w-full min-h-[34px] rounded-lg px-2 py-1.5 text-sm text-right hover:bg-slate-100 ${active ? 'font-semibold text-slate-900' : 'text-slate-300'}`}
                >
                    {active ? `¥${amount.toLocaleString()}` : ''}
                </button>
            )}
        </td>
    );
}
