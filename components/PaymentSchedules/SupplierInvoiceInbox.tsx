'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, CheckCircle2, XCircle, Search, X, Trash2, Pencil, AlertTriangle, CalendarPlus, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { SupplierInvoice } from '@/types/supplierInvoice';
import { hasAccountMismatch } from '@/lib/accountMatch';
import { prepareFile, yen, toInputDate, type UploadRow, type UploadStatus } from '@/components/CreditCard/uploadPrep';
import SupplierInvoiceEditModal from './SupplierInvoiceEditModal';
import AddToScheduleModal from './AddToScheduleModal';

const normSearch = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

interface Props {
    canEdit: boolean;
    /** 支払予定への追加が成功した時（親が当月リストを再取得する） */
    onScheduleAdded?: () => void;
}

// 請求書受け箱。他社からの請求書をアップロード→AI読み取り→現金出納帳と同じテーブルでそのまま修正し、
// 「支払予定に追加」で振込先マスターと連携しつつ支払予定リストへ流し込む。
// 構造は components/CreditCard/CardReceiptInbox.tsx と同方式（照合先が明細行ではなく支払予定なだけ）。
export default function SupplierInvoiceInbox({ canEdit, onScheduleAdded }: Props) {
    const [rows, setRows] = useState<SupplierInvoice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [editTarget, setEditTarget] = useState<SupplierInvoice | null>(null);
    const [addTarget, setAddTarget] = useState<SupplierInvoice | null>(null);
    const [lightbox, setLightbox] = useState<SupplierInvoice | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // 検索・絞り込み（ロード済みの行をクライアント側で絞る・現金出納帳と同方式）
    const [searchText, setSearchText] = useState('');
    const [filterAdded, setFilterAdded] = useState<'' | 'pending' | 'added'>('');
    const hasActiveFilters = Boolean(searchText.trim() || filterAdded);
    const clearFilters = () => {
        setSearchText('');
        setFilterAdded('');
    };

    const fetchRows = useCallback(async () => {
        try {
            const res = await fetch('/api/supplier-invoices', { cache: 'no-store' });
            setRows(res.ok ? await res.json() : []);
        } catch (e) {
            logger.error('Failed to fetch supplier invoices:', e);
            setRows([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    // 支払期日が近い順（期日未読取は末尾）。API と同じ順だが、セル編集後の行差し替えでも正しく並ぶようクライアントでも常にソート
    const sortedRows = useMemo(() => {
        return [...rows].sort((a, b) => {
            const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            if (ad !== bd) return ad - bd;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [rows]);

    // 二重取込検知: 請求元×金額×支払期日が同じ行が2件以上あれば警告（追加済みも含めて比較する）
    const duplicateIds = useMemo(() => {
        const groups = new Map<string, string[]>();
        for (const r of rows) {
            if (!r.payeeName || r.totalAmount == null) continue;
            const key = `${normSearch(r.payeeName)}|${Number(r.totalAmount)}|${r.dueDate?.slice(0, 10) ?? ''}`;
            const g = groups.get(key) ?? [];
            g.push(r.id);
            groups.set(key, g);
        }
        const ids = new Set<string>();
        for (const g of groups.values()) if (g.length > 1) g.forEach((id) => ids.add(id));
        return ids;
    }, [rows]);

    const filtered = useMemo(() => {
        if (!hasActiveFilters) return sortedRows;
        const q = normSearch(searchText);
        return sortedRows.filter((r) => {
            if (q) {
                const hay = normSearch(`${r.payeeName ?? ''} ${r.payee?.name ?? ''} ${r.bankName ?? ''} ${r.accountNumber ?? ''} ${r.notes ?? ''}`);
                if (!hay.includes(q)) return false;
            }
            if (filterAdded === 'pending' && r.paymentScheduleId) return false;
            if (filterAdded === 'added' && !r.paymentScheduleId) return false;
            return true;
        });
    }, [sortedRows, hasActiveFilters, searchText, filterAdded]);

    const totals = useMemo(() => {
        let all = 0;
        let pending = 0;
        for (const r of filtered) {
            const v = Number(r.totalAmount || 0);
            all += v;
            if (!r.paymentScheduleId) pending += v;
        }
        return { all, pending };
    }, [filtered]);

    // セル編集のオートセーブ。成功したら該当行だけ差し替える（現金出納帳の applyPatch と同パターン）
    const applyPatch = async (id: string, patch: Record<string, unknown>) => {
        setSavingId(id);
        try {
            const res = await fetch(`/api/supplier-invoices/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const updated: SupplierInvoice = await res.json();
            setRows((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '保存に失敗しました');
            setRows((prev) => [...prev]); // 入力セルを保存済みの値に戻すための再レンダー
        } finally {
            setSavingId(null);
        }
    };

    const deleteRow = async (invoice: SupplierInvoice) => {
        const label = `${invoice.payeeName ?? '（請求元未設定）'} ${yen(invoice.totalAmount)}`.trim();
        const warn = invoice.paymentScheduleId ? '\n※支払予定に追加済みです。支払予定側の行は残ります。' : '';
        if (!confirm(`この請求書を削除しますか？\n${label}${warn}`)) return;
        setSavingId(invoice.id);
        try {
            const res = await fetch(`/api/supplier-invoices/${invoice.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            toast.success('削除しました');
            await fetchRows();
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
                    const res = await fetch('/api/supplier-invoices', { method: 'POST', body: fd });
                    if (res.ok) {
                        ok += 1;
                        updateRow(i, { status: 'done' });
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
            toast.success(`${ok}件の請求書を取り込みました`);
            fetchRows();
        }
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* アップロードゾーン */}
            {canEdit && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                    className={`shrink-0 mb-4 rounded-xl border-2 border-dashed p-4 sm:p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
                >
                    <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2" />
                    <p className="text-sm text-slate-600 mb-1">取引先からの請求書（画像・PDF）を取り込むと、AIが読み取って行を自動で作成します</p>
                    <p className="text-xs text-slate-400 mb-3">金額・期日・振込先口座は取り込み後にそのまま表で修正できます。振込先マスターと自動照合します。</p>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
                        {/* スマホでは撮影を主ボタンに */}
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
            )}

            {/* アップロード進捗 */}
            {uploadRows.length > 0 && (
                <div className="shrink-0 mb-4 rounded-xl border border-slate-200 bg-white p-3">
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
                                    {r.status === 'compressing' ? '準備中…' : r.status === 'uploading' ? 'AI読み取り中…' : r.status === 'done' ? '完了' : r.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 検索・絞り込み */}
            <div className="shrink-0 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <div className="relative flex-1 min-w-[9rem]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="請求元・銀行・口座番号で検索"
                        className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
                <select
                    value={filterAdded}
                    onChange={(e) => setFilterAdded(e.target.value as '' | 'pending' | 'added')}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    aria-label="追加状態で絞り込み"
                >
                    <option value="">状態：すべて</option>
                    <option value="pending">未追加</option>
                    <option value="added">追加済み</option>
                </select>
                {hasActiveFilters && (
                    <button
                        type="button"
                        onClick={clearFilters}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                    >
                        <X className="w-3.5 h-3.5" />クリア（{filtered.length}件表示中）
                    </button>
                )}
            </div>
            <p className="shrink-0 mb-3 px-1 text-xs text-slate-500">
                「支払予定に追加」で支払日リストへ流し込みます。マスター未登録の振込先は追加時に自動で登録されます。証憑をタップすると拡大、鉛筆アイコンで口座情報も編集できます。
            </p>

            {/* 請求書テーブル（テーブル内スクロール方式: ヘッダーと合計行は常に見える） */}
            {isLoading ? (
                <div className="flex-1 min-h-[280px] flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : (
                <div className="flex-1 min-h-[280px] flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="flex-1 overflow-auto">
                        <table className="min-w-[1250px] w-full divide-y divide-slate-200">
                            <thead className="bg-slate-100 sticky top-0 z-10">
                                <tr>
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-700 w-[56px]">証憑</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[136px]">支払期日</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700">請求元</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[120px]">金額（税込）</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[230px]">振込先口座</th>
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-700 w-[150px]">マスター照合</th>
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-700 w-[160px]">支払予定</th>
                                    <th className="px-1 py-3 w-[44px]"><span className="sr-only">詳細</span></th>
                                    <th className="px-1 py-3 w-[44px]"><span className="sr-only">削除</span></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-100">
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                                            <FileText className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                            {hasActiveFilters
                                                ? '絞り込み条件に一致する請求書がありません。条件を変えるか「クリア」してください。'
                                                : '請求書はまだありません。上のアップロードから取り込んでください。'}
                                        </td>
                                    </tr>
                                )}
                                {filtered.map((r) => (
                                    <InboxRow
                                        key={r.id}
                                        invoice={r}
                                        canEdit={canEdit}
                                        saving={savingId === r.id}
                                        isDuplicate={duplicateIds.has(r.id)}
                                        onPatch={(patch) => applyPatch(r.id, patch)}
                                        onDelete={() => deleteRow(r)}
                                        onOpenModal={() => setEditTarget(r)}
                                        onOpenImage={() => setLightbox(r)}
                                        onAddToSchedule={() => setAddTarget(r)}
                                    />
                                ))}
                            </tbody>
                            {filtered.length > 0 && (
                                <tfoot>
                                    <tr className="[&>td]:sticky [&>td]:bottom-0 [&>td]:bg-slate-50 [&>td]:shadow-[inset_0_2px_0_0_#e2e8f0]">
                                        <td colSpan={3} className="px-3 py-3 text-right text-sm font-semibold text-slate-600">
                                            {hasActiveFilters ? `絞り込み合計（${filtered.length}件）` : `合計（${filtered.length}件）`}
                                        </td>
                                        <td className="px-3 py-3 text-right whitespace-nowrap">
                                            <div className="text-sm font-bold text-slate-900">{yen(totals.all)}</div>
                                            {totals.pending !== totals.all && (
                                                <div className="text-[11px] text-amber-700" title="支払予定に未追加の請求書の合計">未追加 {yen(totals.pending)}</div>
                                            )}
                                        </td>
                                        <td colSpan={5} />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            )}

            {/* 詳細編集モーダル（口座情報・マスター照合・再読取） */}
            {editTarget && (
                <SupplierInvoiceEditModal
                    invoice={editTarget}
                    canEdit={canEdit}
                    onClose={() => setEditTarget(null)}
                    onSaved={() => { setEditTarget(null); fetchRows(); }}
                />
            )}

            {/* 支払予定への追加モーダル */}
            {addTarget && (
                <AddToScheduleModal
                    invoice={addTarget}
                    onClose={() => setAddTarget(null)}
                    onAdded={() => {
                        setAddTarget(null);
                        fetchRows();
                        onScheduleAdded?.();
                    }}
                />
            )}

            {/* 証憑画像のライトボックス */}
            {lightbox?.signedUrl && (
                <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
                    <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="閉じる">
                        <X className="w-6 h-6" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightbox.signedUrl} alt={lightbox.fileName ?? '請求書'} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

// 1行分。セルの blur でそのまま保存する（行単位オートセーブ・現金出納帳の CashbookRow と同パターン）。
function InboxRow({ invoice, canEdit, saving, isDuplicate, onPatch, onDelete, onOpenModal, onOpenImage, onAddToSchedule }: {
    invoice: SupplierInvoice;
    canEdit: boolean;
    saving: boolean;
    isDuplicate: boolean;
    onPatch: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
    onOpenModal: () => void;
    onOpenImage: () => void;
    onAddToSchedule: () => void;
}) {
    const dueYmd = toInputDate(invoice.dueDate);
    const isPdf = invoice.mimeType === 'application/pdf' || invoice.sourceType === 'pdf';
    const added = Boolean(invoice.paymentScheduleId);
    const mismatch = hasAccountMismatch(invoice.payee, invoice);
    const editable = canEdit && !saving;

    return (
        <tr className={`hover:bg-slate-50 ${saving ? 'opacity-60' : ''}`}>
            {/* 証憑 */}
            <td className="px-2 py-1.5 text-center">
                {isPdf ? (
                    invoice.signedUrl ? (
                        <a href={invoice.signedUrl} target="_blank" rel="noreferrer" title={invoice.fileName} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                            <FileText className="w-4 h-4" />
                        </a>
                    ) : (
                        <FileText className="w-4 h-4 text-slate-300 inline-block" />
                    )
                ) : (
                    <button onClick={onOpenImage} title={invoice.fileName ?? undefined} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 overflow-hidden hover:ring-2 hover:ring-teal-400">
                        {invoice.thumbnailSignedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={invoice.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                        )}
                    </button>
                )}
            </td>
            {/* 支払期日 */}
            <td className="px-2 py-1.5 whitespace-nowrap">
                <input
                    type="date"
                    key={`d-${invoice.id}-${dueYmd}`}
                    defaultValue={dueYmd}
                    disabled={!editable}
                    onBlur={(e) => {
                        const v = e.target.value;
                        if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== dueYmd) onPatch({ dueDate: v });
                        else if (!v && dueYmd) onPatch({ dueDate: null });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 請求元（＋二重取込警告） */}
            <td className="px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                    <input
                        type="text"
                        key={`n-${invoice.id}-${invoice.payeeName ?? ''}`}
                        defaultValue={invoice.payeeName ?? ''}
                        placeholder="請求元を入力"
                        disabled={!editable}
                        onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (invoice.payeeName ?? '')) onPatch({ payeeName: v });
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-full min-w-[160px] rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-800 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    {isDuplicate && (
                        <span
                            className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-300 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                            title="同じ請求元・金額・期日の取込が他にもあります（二重取込の可能性）"
                        >
                            <Copy className="w-3 h-3" />重複?
                        </span>
                    )}
                </div>
            </td>
            {/* 金額 */}
            <AmountCell amount={invoice.totalAmount} disabled={!editable} onCommit={(n) => onPatch({ totalAmount: n })} />
            {/* 振込先口座（表示のみ。編集は詳細モーダル） */}
            <td className="px-2 py-1.5">
                <div className={`text-xs leading-snug ${mismatch ? 'text-red-700' : 'text-slate-600'}`}>
                    {invoice.bankName || invoice.accountNumber ? (
                        <>
                            <div className="whitespace-nowrap">
                                {invoice.bankName} {invoice.branchName}
                            </div>
                            <div className="whitespace-nowrap">
                                {invoice.accountType && `${invoice.accountType} `}{invoice.accountNumber}
                                {invoice.accountHolder && ` ${invoice.accountHolder}`}
                            </div>
                        </>
                    ) : (
                        <span className="text-slate-300">—</span>
                    )}
                </div>
            </td>
            {/* マスター照合（＋口座変更検知） */}
            <td className="px-2 py-1.5 text-center">
                {invoice.payee ? (
                    mismatch ? (
                        <span
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-700 border border-red-300 whitespace-nowrap"
                            title={`マスター「${invoice.payee.name}」の口座（${invoice.payee.accountNumber ?? '未登録'}）と請求書の口座（${invoice.accountNumber ?? '—'}）が一致しません。口座変更か、請求書の口座差し替えの可能性があります。詳細から確認してください。`}
                        >
                            <AlertTriangle className="w-3.5 h-3.5" />口座不一致
                        </span>
                    ) : (
                        <span
                            className="inline-block max-w-[140px] truncate px-2 py-1 text-xs font-semibold rounded-full bg-teal-600 text-white border border-teal-600 whitespace-nowrap align-middle"
                            title={`振込先マスター「${invoice.payee.name}」と照合済み`}
                        >
                            ✓ {invoice.payee.name}
                        </span>
                    )
                ) : (
                    <span
                        className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap"
                        title="振込先マスターに一致がありません。支払予定への追加時に新規登録されます（詳細から既存マスターを選ぶこともできます）"
                    >
                        未登録
                    </span>
                )}
            </td>
            {/* 支払予定（追加済み / 追加ボタン） */}
            <td className="px-2 py-1.5 text-center">
                {added ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300 whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5" />追加済み
                    </span>
                ) : canEdit ? (
                    <button
                        onClick={onAddToSchedule}
                        disabled={saving}
                        className="inline-flex items-center gap-1 rounded-lg bg-teal-600 text-white px-2.5 py-1.5 text-xs font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                        <CalendarPlus className="w-3.5 h-3.5" />支払予定に追加
                    </button>
                ) : (
                    <span className="inline-block px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">未追加</span>
                )}
            </td>
            {/* 詳細（口座情報・マスター照合・再読取） */}
            <td className="px-1 py-1.5 text-center">
                <button onClick={onOpenModal} title="詳細を開く（口座情報・マスター照合の編集）" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                    <Pencil className="w-4 h-4" />
                </button>
            </td>
            {/* 削除 */}
            <td className="px-1 py-1.5 text-center">
                {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400 inline-block" />
                ) : canEdit ? (
                    <button onClick={onDelete} title="この請求書を削除" className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                    </button>
                ) : null}
            </td>
        </tr>
    );
}

// 金額セル。クリックで編集し、blur / Enter で確定（Escape で破棄）。円・正の整数のみ。
function AmountCell({ amount, disabled, onCommit }: {
    amount: number | string | null;
    disabled: boolean;
    onCommit: (n: number) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const value = amount == null || amount === '' ? null : Number(amount);

    const start = () => {
        if (disabled) return;
        setDraft(value != null && value !== 0 ? String(value) : '');
        setEditing(true);
    };
    const commit = () => {
        setEditing(false);
        const cleaned = draft.replace(/[^\d]/g, '');
        if (cleaned === '') return; // 空のまま抜けたら変更なし
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n < 0) return;
        if (value != null && n === value) return;
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
                    className="w-full min-w-0 rounded-lg border border-teal-400 bg-white px-2 py-1.5 text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            ) : (
                <button
                    onClick={start}
                    disabled={disabled}
                    className={`w-full min-w-0 min-h-[34px] rounded-lg px-2 py-1.5 text-sm text-right hover:bg-slate-100 ${value != null ? 'font-semibold text-slate-900' : 'text-slate-300'}`}
                >
                    {value != null ? yen(value) : ''}
                </button>
            )}
        </td>
    );
}
