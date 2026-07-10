'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, CheckCircle2, XCircle, Search, X, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { CardReceipt } from '@/types/creditCard';
import type { ExpenseCategoryRef } from '@/types/receipt';
import CardReceiptEditModal from './CardReceiptEditModal';
import { prepareFile, fmtDate, yen, money, type UploadRow, type UploadStatus } from './uploadPrep';

const normSearch = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

interface Props {
    categories: ExpenseCategoryRef[];
}

// レシート受け箱。日々のカード利用レシートをアップロード→AI読み取り→現金出納帳と同じテーブルでそのまま修正できる。
// 明細書取込後、明細書詳細の画面から照合（紐付け）する。
export default function CardReceiptInbox({ categories }: Props) {
    const [receipts, setReceipts] = useState<CardReceipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [selected, setSelected] = useState<CardReceipt | null>(null);
    const [lightbox, setLightbox] = useState<CardReceipt | null>(null);
    const [cardLabel, setCardLabel] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // 検索・絞り込み（ロード済みの行をクライアント側で絞る・現金出納帳と同方式）
    const [searchText, setSearchText] = useState('');
    const [filterApplicant, setFilterApplicant] = useState('');
    const [filterCategoryId, setFilterCategoryId] = useState('');
    const [filterLinked, setFilterLinked] = useState<'' | 'unlinked' | 'linked'>('');
    const hasActiveFilters = Boolean(searchText.trim() || filterApplicant || filterCategoryId || filterLinked);
    const clearFilters = () => {
        setSearchText('');
        setFilterApplicant('');
        setFilterCategoryId('');
        setFilterLinked('');
    };

    // 再取得中もテーブルを出したままにする（スピナーへの差し替えは初回のみ・現金出納帳と同じ考え方）
    const fetchReceipts = useCallback(async () => {
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

    // 氏名フィルタの選択肢（ロード済みの行から重複なしで生成）
    const applicantOptions = useMemo(() => {
        const set = new Set<string>();
        for (const r of receipts) if (r.applicantName) set.add(r.applicantName);
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
    }, [receipts]);

    // 表示順はレシートの日付順（古い順・日付未読取は末尾）。
    // API も同じ順で返すが、セル編集後の行差し替えでも正しい位置に並ぶようクライアントでも常にソートする（出納帳と同じ考え方）。
    const sortedReceipts = useMemo(() => {
        return [...receipts].sort((a, b) => {
            const ad = a.issueDate ? new Date(a.issueDate).getTime() : Infinity;
            const bd = b.issueDate ? new Date(b.issueDate).getTime() : Infinity;
            if (ad !== bd) return ad - bd;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
    }, [receipts]);

    const filtered = useMemo(() => {
        if (!hasActiveFilters) return sortedReceipts;
        const q = normSearch(searchText);
        return sortedReceipts.filter((r) => {
            if (q) {
                const hay = normSearch(`${r.storeName ?? ''} ${r.applicantName ?? ''} ${r.expenseCategory?.name ?? ''} ${r.cardLabel ?? ''} ${r.notes ?? ''}`);
                if (!hay.includes(q)) return false;
            }
            if (filterApplicant && (r.applicantName ?? '') !== filterApplicant) return false;
            if (filterCategoryId && r.expenseCategoryId !== filterCategoryId) return false;
            if (filterLinked === 'unlinked' && r.statementLine) return false;
            if (filterLinked === 'linked' && !r.statementLine) return false;
            return true;
        });
    }, [sortedReceipts, hasActiveFilters, searchText, filterApplicant, filterCategoryId, filterLinked]);

    // 合計は通貨別（円＋外貨ごと）。混ぜて合算はしない
    const totals = useMemo(() => {
        let jpy = 0;
        const fx = new Map<string, number>();
        for (const r of filtered) {
            const v = Number(r.totalAmount || 0);
            if (!r.currency) jpy += v;
            else fx.set(r.currency, (fx.get(r.currency) ?? 0) + v);
        }
        return { jpy, fx: Array.from(fx.entries()) };
    }, [filtered]);

    // セル編集のオートセーブ。成功したら該当行だけ差し替える（現金出納帳の applyPatch と同パターン）。
    const applyPatch = async (id: string, patch: Record<string, unknown>) => {
        setSavingId(id);
        try {
            const res = await fetch(`/api/card-receipts/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const updated: CardReceipt = await res.json();
            setReceipts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '保存に失敗しました');
            setReceipts((prev) => [...prev]); // 入力セルを保存済みの値に戻すための再レンダー
        } finally {
            setSavingId(null);
        }
    };

    const deleteRow = async (receipt: CardReceipt) => {
        const label = `${fmtDate(receipt.issueDate)} ${receipt.storeName ?? ''} ${money(receipt.totalAmount, receipt.currency)}`.trim();
        const warn = receipt.statementLine ? '\n※照合済みのレシートです。削除すると明細行は未照合に戻ります。' : '';
        if (!confirm(`このレシートを削除しますか？\n${label}${warn}`)) return;
        setSavingId(receipt.id);
        try {
            const res = await fetch(`/api/card-receipts/${receipt.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            toast.success('削除しました');
            await fetchReceipts();
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
        <div className="flex-1 min-h-0 flex flex-col">
            {/* アップロードゾーン */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                className={`shrink-0 mb-4 rounded-xl border-2 border-dashed p-4 sm:p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
            >
                <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-1">カード利用レシート（画像・PDF）を取り込むと、AIが読み取って行を自動で作成します</p>
                <p className="text-xs text-slate-400 mb-3">日付・金額・店名・費目は取り込み後にそのまま表で修正できます。担当名は取り込んだ人の名前が入ります。</p>
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
                                    {r.status === 'compressing' ? '準備中…' : r.status === 'uploading' ? 'AI読み取り中…' : r.status === 'done' ? (r.message ?? '完了') : r.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 検索・絞り込み（現金出納帳と同方式） */}
            <div className="shrink-0 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <div className="relative flex-1 min-w-[9rem]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="店名・担当名・費目・カード名で検索"
                        className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
                <select
                    value={filterApplicant}
                    onChange={(e) => setFilterApplicant(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    aria-label="担当名で絞り込み"
                >
                    <option value="">担当：すべて</option>
                    {applicantOptions.map((name) => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </select>
                <select
                    value={filterCategoryId}
                    onChange={(e) => setFilterCategoryId(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    aria-label="費目で絞り込み"
                >
                    <option value="">費目：すべて</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <select
                    value={filterLinked}
                    onChange={(e) => setFilterLinked(e.target.value as '' | 'unlinked' | 'linked')}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    aria-label="照合状態で絞り込み"
                >
                    <option value="">照合：すべて</option>
                    <option value="unlinked">未照合</option>
                    <option value="linked">照合済み</option>
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
            <p className="shrink-0 mb-3 px-1 text-xs text-slate-500">照合（明細行との紐付け）は「明細書」タブの詳細画面から行います。証憑をタップすると画像を拡大、鉛筆アイコンで税額・メモも編集できます。</p>

            {/* レシートテーブル（テーブル内スクロール方式: ヘッダーと合計行は常に見える） */}
            {isLoading ? (
                <div className="flex-1 min-h-[280px] flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : (
                <div className="flex-1 min-h-[280px] flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="flex-1 overflow-auto">
                        <table className="min-w-[1150px] w-full divide-y divide-slate-200">
                            <thead className="bg-slate-100 sticky top-0 z-10">
                                <tr>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[136px]">日付</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[130px]">費目</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700">店名</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[110px]">担当名</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[120px]">金額</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[110px]">カード名</th>
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-700 w-[96px]">照合</th>
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-700 w-[56px]">証憑</th>
                                    <th className="px-1 py-3 w-[44px]"><span className="sr-only">詳細</span></th>
                                    <th className="px-1 py-3 w-[44px]"><span className="sr-only">削除</span></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-100">
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                                            <FileText className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                            {hasActiveFilters
                                                ? '絞り込み条件に一致するレシートがありません。条件を変えるか「クリア」してください。'
                                                : 'レシートはまだありません。上のアップロードから取り込んでください。'}
                                        </td>
                                    </tr>
                                )}
                                {filtered.map((r) => (
                                    <InboxRow
                                        key={r.id}
                                        receipt={r}
                                        categories={categories}
                                        saving={savingId === r.id}
                                        onPatch={(patch) => applyPatch(r.id, patch)}
                                        onDelete={() => deleteRow(r)}
                                        onOpenModal={() => setSelected(r)}
                                        onOpenImage={() => setLightbox(r)}
                                    />
                                ))}
                            </tbody>
                            {filtered.length > 0 && (
                                <tfoot>
                                    {/* 合計行はテーブル下端に固定（スクロールせず常に見える）。
                                        border はsticky時に追従しないため inset shadow で線を引く */}
                                    <tr className="[&>td]:sticky [&>td]:bottom-0 [&>td]:bg-slate-50 [&>td]:shadow-[inset_0_2px_0_0_#e2e8f0]">
                                        <td colSpan={4} className="px-3 py-3 text-right text-sm font-semibold text-slate-600">
                                            {hasActiveFilters ? `絞り込み合計（${filtered.length}件）` : `合計（${filtered.length}件）`}
                                        </td>
                                        <td className="px-3 py-3 text-right whitespace-nowrap">
                                            <div className="text-sm font-bold text-slate-900">{yen(totals.jpy)}</div>
                                            {totals.fx.map(([cur, sum]) => (
                                                <div key={cur} className="text-[11px] text-blue-600" title={`${cur} のレシート合計（円とは別集計）`}>
                                                    {money(sum, cur)}
                                                </div>
                                            ))}
                                        </td>
                                        <td colSpan={5} />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            )}

            {/* 編集モーダル（税額・メモ・プレビュー拡大） */}
            {selected && (
                <CardReceiptEditModal
                    receipt={selected}
                    categories={categories}
                    onClose={() => setSelected(null)}
                    onSaved={() => { setSelected(null); fetchReceipts(); }}
                />
            )}

            {/* 証憑画像のライトボックス */}
            {lightbox?.signedUrl && (
                <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
                    <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="閉じる">
                        <X className="w-6 h-6" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightbox.signedUrl} alt={lightbox.fileName ?? 'レシート'} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

// 1行分。セルの blur / 選択でそのまま保存する（行単位オートセーブ・現金出納帳の CashbookRow と同パターン）。
function InboxRow({ receipt, categories, saving, onPatch, onDelete, onOpenModal, onOpenImage }: {
    receipt: CardReceipt;
    categories: ExpenseCategoryRef[];
    saving: boolean;
    onPatch: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
    onOpenModal: () => void;
    onOpenImage: () => void;
}) {
    const dateYmd = receipt.issueDate ? receipt.issueDate.slice(0, 10) : '';
    const isPdf = receipt.mimeType === 'application/pdf' || receipt.sourceType === 'pdf';
    const stmt = receipt.statementLine?.statement;

    return (
        <tr className={`hover:bg-slate-50 ${saving ? 'opacity-60' : ''}`}>
            {/* 日付（未読取は空欄。空にすると未設定に戻せる） */}
            <td className="px-2 py-1.5 whitespace-nowrap">
                <input
                    type="date"
                    key={`d-${receipt.id}-${dateYmd}`}
                    defaultValue={dateYmd}
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value;
                        if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== dateYmd) onPatch({ issueDate: v });
                        else if (!v && dateYmd) onPatch({ issueDate: null });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 費目 */}
            <td className="px-2 py-1.5">
                <select
                    value={receipt.expenseCategoryId ?? ''}
                    disabled={saving}
                    onChange={(e) => onPatch({ expenseCategoryId: e.target.value || null })}
                    className="w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                    <option value="">—</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </td>
            {/* 店名 */}
            <td className="px-2 py-1.5">
                <input
                    type="text"
                    key={`t-${receipt.id}-${receipt.storeName ?? ''}`}
                    defaultValue={receipt.storeName ?? ''}
                    placeholder="店名を入力"
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (receipt.storeName ?? '')) onPatch({ storeName: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full min-w-[180px] rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-800 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 担当名 */}
            <td className="px-2 py-1.5">
                <input
                    type="text"
                    key={`a-${receipt.id}-${receipt.applicantName ?? ''}`}
                    defaultValue={receipt.applicantName ?? ''}
                    placeholder="担当名"
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (receipt.applicantName ?? '')) onPatch({ applicantName: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full min-w-[90px] rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-800 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 金額（¥⇄$バッジで通貨切替。外貨は小数入力可） */}
            <AmountCell
                amount={receipt.totalAmount}
                currency={receipt.currency}
                saving={saving}
                onCommit={(n) => onPatch({ totalAmount: n })}
                onToggleCurrency={() => onPatch({ currency: receipt.currency ? null : 'USD' })}
            />
            {/* カード名 */}
            <td className="px-2 py-1.5">
                <input
                    type="text"
                    key={`c-${receipt.id}-${receipt.cardLabel ?? ''}`}
                    defaultValue={receipt.cardLabel ?? ''}
                    placeholder="カード名"
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (receipt.cardLabel ?? '')) onPatch({ cardLabel: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full min-w-[90px] rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 照合状態（紐付けは明細書詳細の画面から） */}
            <td className="px-2 py-1.5 text-center">
                {stmt ? (
                    <span
                        className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-teal-600 text-white border border-teal-600 whitespace-nowrap"
                        title={`${stmt.cardLabel} ${fmtDate(stmt.closingDate)}締めの明細行に紐付いています`}
                    >
                        ✓ 照合済み
                    </span>
                ) : (
                    <span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap">
                        未照合
                    </span>
                )}
            </td>
            {/* 証憑 */}
            <td className="px-2 py-1.5 text-center">
                {isPdf ? (
                    receipt.signedUrl ? (
                        <a href={receipt.signedUrl} target="_blank" rel="noreferrer" title={receipt.fileName} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                            <FileText className="w-4 h-4" />
                        </a>
                    ) : (
                        <FileText className="w-4 h-4 text-slate-300 inline-block" />
                    )
                ) : (
                    <button onClick={onOpenImage} title={receipt.fileName ?? undefined} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 overflow-hidden hover:ring-2 hover:ring-teal-400">
                        {receipt.thumbnailSignedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={receipt.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                        )}
                    </button>
                )}
            </td>
            {/* 詳細（税額・メモ・プレビュー拡大） */}
            <td className="px-1 py-1.5 text-center">
                <button onClick={onOpenModal} title="詳細を開く（税額・メモの編集）" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                    <Pencil className="w-4 h-4" />
                </button>
            </td>
            {/* 削除 */}
            <td className="px-1 py-1.5 text-center">
                {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400 inline-block" />
                ) : (
                    <button onClick={onDelete} title="このレシートを削除" className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </td>
        </tr>
    );
}

// 金額セル。クリックで編集し、blur / Enter で確定（Escape で破棄）。レシートは正の金額のみ。
// ¥/$バッジのタップで円⇄ドルを切替。外貨は小数2桁まで入力できる。
function AmountCell({ amount, currency, saving, onCommit, onToggleCurrency }: {
    amount: number | string | null;
    currency: string | null;
    saving: boolean;
    onCommit: (n: number) => void;
    onToggleCurrency: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const value = amount == null || amount === '' ? null : Number(amount);

    const start = () => {
        if (saving) return;
        setDraft(value != null && value !== 0 ? String(value) : '');
        setEditing(true);
    };
    const commit = () => {
        setEditing(false);
        const cleaned = currency ? draft.replace(/[^\d.]/g, '') : draft.replace(/[^\d]/g, '');
        if (cleaned === '' || cleaned === '.') return; // 空のまま抜けたら変更なし
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n < 0) return;
        const rounded = currency ? Math.round(n * 100) / 100 : Math.round(n);
        if (value != null && rounded === value) return;
        onCommit(rounded);
    };

    return (
        <td className="px-2 py-1.5 text-right">
            <div className="flex items-center gap-1">
                <button
                    onClick={onToggleCurrency}
                    disabled={saving}
                    title={currency ? `${currency} 建て。タップで円に切替` : '円建て。タップでドル（USD）に切替'}
                    className={`shrink-0 px-1.5 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                        currency
                            ? 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                    }`}
                >
                    {currency ? (currency === 'USD' ? '$' : currency) : '¥'}
                </button>
                {editing ? (
                    <input
                        autoFocus
                        type="text"
                        inputMode={currency ? 'decimal' : 'numeric'}
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
                        disabled={saving}
                        className={`w-full min-w-0 min-h-[34px] rounded-lg px-2 py-1.5 text-sm text-right hover:bg-slate-100 ${value != null ? 'font-semibold text-slate-900' : 'text-slate-300'}`}
                    >
                        {value != null ? money(value, currency) : ''}
                    </button>
                )}
            </div>
        </td>
    );
}
