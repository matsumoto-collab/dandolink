'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, Table2, CheckCircle2, XCircle, X, Trash2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { BankStatement } from '@/types/bank-statement';

// Vercel のリクエストボディ上限（約4.5MB）。圧縮後の画像・PDF・CSV がこれを超えたら送信前に弾く。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// 当月の 'YYYY-MM'（month input と同じ書式）
const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
// 'YYYY-MM' → 「2026年7月」
const fmtMonth = (m: string) => {
    const [y, mm] = m.split('-');
    return y && mm ? `${y}年${Number(mm)}月` : m;
};
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

type UploadStatus = 'compressing' | 'uploading' | 'done' | 'error';
interface UploadRow { name: string; status: UploadStatus; message?: string }

// クライアント側の前処理。画像は圧縮（失敗時は原本）、PDF・CSVは無加工。上限超過はエラーで返す。
async function prepareFile(file: File): Promise<{ blob: Blob; name: string } | { error: string }> {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    // CSV はブラウザによって MIME が application/vnd.ms-excel や空になるため拡張子でも判定する
    const isCsv = file.type === 'text/csv' || /\.csv$/i.test(file.name);
    const isImg = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);

    if (isPdf) {
        if (file.size > MAX_UPLOAD_BYTES) return { error: 'PDFは4MB以下にしてください' };
        return { blob: file, name: file.name };
    }
    if (isCsv) {
        if (file.size > MAX_UPLOAD_BYTES) return { error: 'CSVは4MB以下にしてください' };
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
    return { error: '対応していないファイル形式です（画像・PDF・CSV）' };
}

// 銀行入金明細タブ。銀行から受け取った入金明細（画像・PDF・CSV）を対象年月ごとに保管するだけの置き場。
// AI読み取り・データ化はしない（現金出納帳・原価計算とは連携しない）。
export default function BankStatementsTab() {
    const [statements, setStatements] = useState<BankStatement[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<BankStatement | null>(null);
    // アップロード時の対象年月（既定=当月）とメモ。複数ファイルを続けて上げるため入力は保持する
    const [targetMonth, setTargetMonth] = useState(currentMonth);
    const [memo, setMemo] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 再取得中も一覧を出したままにする（スピナーへの差し替えは初回のみ・現金出納帳と同じ考え方）
    const fetchStatements = useCallback(async () => {
        try {
            const res = await fetch('/api/bank-statements', { cache: 'no-store' });
            setStatements(res.ok ? await res.json() : []);
        } catch (e) {
            logger.error('Failed to fetch bank statements:', e);
            setStatements([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatements();
    }, [fetchStatements]);

    // 対象年月の降順にグルーピング（同じ月の中は API の並び＝取り込んだ順の新しい順）
    const groups = useMemo(() => {
        const map = new Map<string, BankStatement[]>();
        for (const s of statements) {
            const list = map.get(s.targetMonth);
            if (list) list.push(s);
            else map.set(s.targetMonth, [s]);
        }
        return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    }, [statements]);

    const applyPatch = async (id: string, patch: Record<string, unknown>) => {
        setSavingId(id);
        try {
            const res = await fetch(`/api/bank-statements/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const updated: BankStatement = await res.json();
            setStatements((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '保存に失敗しました');
            setStatements((prev) => [...prev]); // 入力欄を保存済みの値に戻すための再レンダー
        } finally {
            setSavingId(null);
        }
    };

    const deleteRow = async (statement: BankStatement) => {
        if (!confirm(`この明細を削除しますか？\n${fmtMonth(statement.targetMonth)} ${statement.fileName}`)) return;
        setSavingId(statement.id);
        try {
            const res = await fetch(`/api/bank-statements/${statement.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            toast.success('削除しました');
            await fetchStatements();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '削除に失敗しました');
        } finally {
            setSavingId(null);
        }
    };

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) {
            toast.error('対象年月を選択してください');
            return;
        }
        const arr = Array.from(files);
        setUploading(true);
        setUploadRows(arr.map((f) => ({ name: f.name, status: 'compressing' as UploadStatus })));

        const updateRow = (i: number, patch: Partial<UploadRow>) => setUploadRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

        let ok = 0;
        // AI読み取りが無く1件が短時間で終わるため、順番どおりに1件ずつ送る
        for (let i = 0; i < arr.length; i++) {
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
                fd.append('targetMonth', targetMonth);
                if (memo.trim()) fd.append('memo', memo.trim());
                const res = await fetch('/api/bank-statements', { method: 'POST', body: fd });
                if (res.ok) {
                    ok++;
                    updateRow(i, { status: 'done' });
                } else {
                    const e = await res.json().catch(() => ({}));
                    updateRow(i, { status: 'error', message: e.error || '取り込みに失敗しました' });
                }
            } catch {
                updateRow(i, { status: 'error', message: '取り込みに失敗しました' });
            }
        }

        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (ok > 0) {
            toast.success(`${ok}件を保存しました`);
            fetchStatements();
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
                <p className="text-sm text-slate-600 mb-1">銀行の入金明細（画像・PDF・CSV）を対象年月ごとに保管します</p>
                <p className="text-xs text-slate-400 mb-3">読み取りはしません。保存したファイルはこの画面からいつでも開けます。</p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
                    <label className="inline-flex items-center justify-center gap-1.5 text-xs text-slate-500 whitespace-nowrap">
                        対象年月
                        <input
                            type="month"
                            value={targetMonth}
                            onChange={(e) => setTargetMonth(e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </label>
                    <input
                        type="text"
                        value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        placeholder="メモ（銀行名・口座など・任意）"
                        className="w-full sm:w-64 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl transition-colors font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 bg-teal-600 text-white hover:bg-teal-700"
                    >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? '保存中…' : 'ファイルを選択'}
                    </button>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.csv,text/csv"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                />
            </div>

            {/* アップロード進捗 */}
            {uploadRows.length > 0 && (
                <div className="shrink-0 mb-4 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600">保存状況</span>
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
                                    {r.status === 'compressing' ? '準備中…' : r.status === 'uploading' ? '保存中…' : r.status === 'done' ? '完了' : r.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 一覧（対象年月ごと） */}
            {isLoading ? (
                <div className="flex-1 min-h-[280px] flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : groups.length === 0 ? (
                <div className="flex-1 min-h-[280px] flex flex-col items-center justify-center py-16 text-slate-500">
                    <FileText className="w-8 h-8 text-slate-300 mb-2" />
                    入金明細はまだありません
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-auto space-y-5">
                    {groups.map(([month, rows]) => (
                        <div key={month}>
                            <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur px-1 py-1.5 mb-2 flex items-baseline gap-2">
                                <h3 className="text-base font-bold text-slate-800">{fmtMonth(month)}</h3>
                                <span className="text-xs text-slate-400">{rows.length}件</span>
                            </div>
                            <div className="space-y-2">
                                {rows.map((s) => (
                                    <BankStatementRow
                                        key={s.id}
                                        statement={s}
                                        saving={savingId === s.id}
                                        onPatch={(patch) => applyPatch(s.id, patch)}
                                        onDelete={() => deleteRow(s)}
                                        onOpenImage={() => setLightbox(s)}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 明細画像のライトボックス */}
            {lightbox?.signedUrl && (
                <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
                    <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="閉じる">
                        <X className="w-6 h-6" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightbox.signedUrl} alt={lightbox.fileName} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

// 1件分のカード。メモ・対象年月はその場で編集して blur / 選択で保存する。
function BankStatementRow({ statement, saving, onPatch, onDelete, onOpenImage }: {
    statement: BankStatement;
    saving: boolean;
    onPatch: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
    onOpenImage: () => void;
}) {
    const isPdf = statement.mimeType === 'application/pdf';
    const isCsv = statement.mimeType === 'text/csv';
    const isImage = !isPdf && !isCsv;

    return (
        <div className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm ${saving ? 'opacity-60' : ''}`}>
            {/* サムネイル（画像）またはファイル種別アイコン（PDF/CSVは署名URLを新規タブで開く） */}
            {isImage ? (
                <button onClick={onOpenImage} title={statement.fileName} className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-lg border border-slate-200 overflow-hidden hover:ring-2 hover:ring-teal-400">
                    {statement.thumbnailSignedUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={statement.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <ImageIcon className="w-5 h-5 text-slate-400" />
                    )}
                </button>
            ) : statement.signedUrl ? (
                <a href={statement.signedUrl} target="_blank" rel="noreferrer" title={statement.fileName} className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                    {isCsv ? <Table2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </a>
            ) : (
                <span className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-lg border border-slate-200 text-slate-300">
                    {isCsv ? <Table2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </span>
            )}

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    {isImage ? (
                        <button onClick={onOpenImage} className="truncate text-sm font-medium text-slate-800 hover:text-teal-700">{statement.fileName}</button>
                    ) : statement.signedUrl ? (
                        <a href={statement.signedUrl} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-slate-800 hover:text-teal-700">{statement.fileName}</a>
                    ) : (
                        <span className="truncate text-sm font-medium text-slate-800">{statement.fileName}</span>
                    )}
                    <span className="shrink-0 text-xs text-slate-400">{fmtSize(statement.fileSize)}</span>
                </div>
                <input
                    type="text"
                    key={`m-${statement.id}-${statement.memo ?? ''}`}
                    defaultValue={statement.memo ?? ''}
                    placeholder="メモを入力"
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (statement.memo ?? '')) onPatch({ memo: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="mt-0.5 w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1 text-sm text-slate-700 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </div>

            {/* 対象年月（変更するとその月のグループへ移動する） */}
            <input
                type="month"
                key={`t-${statement.id}-${statement.targetMonth}`}
                defaultValue={statement.targetMonth}
                disabled={saving}
                title="対象年月（変更するとその月へ移動します）"
                onBlur={(e) => {
                    const v = e.target.value;
                    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v) && v !== statement.targetMonth) onPatch({ targetMonth: v });
                    else if (!v) e.target.value = statement.targetMonth; // 空にされたら元へ戻す
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="shrink-0 rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />

            {saving ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />
            ) : (
                <button onClick={onDelete} title="この明細を削除" className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
