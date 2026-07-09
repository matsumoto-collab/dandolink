'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { CardStatementSummary } from '@/types/creditCard';
import { prepareFile, fmtDate, yen } from './uploadPrep';

interface Props {
    onSelect: (id: string) => void;
}

// 明細書一覧＋アップロード。1PDF=1明細書。カード名は必須（複数カードの区別に使う）。
export default function CardStatementList({ onSelect }: Props) {
    const [statements, setStatements] = useState<CardStatementSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [cardLabel, setCardLabel] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchStatements = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/card-statements', { cache: 'no-store' });
            setStatements(res.ok ? await res.json() : []);
        } catch (e) {
            logger.error('Failed to fetch card statements:', e);
            setStatements([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatements();
    }, [fetchStatements]);

    const cardLabels = useMemo(() => Array.from(new Set(statements.map((s) => s.cardLabel).filter(Boolean))), [statements]);

    const handleFile = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        if (!cardLabel.trim()) {
            toast.error('カード名を入力してください（例: AMEX 今井）');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }
        const prepared = await prepareFile(files[0]);
        if ('error' in prepared) {
            toast.error(prepared.error);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', prepared.blob, prepared.name);
            fd.append('cardLabel', cardLabel.trim());
            const res = await fetch('/api/card-statements', { method: 'POST', body: fd });
            if (res.ok) {
                const created = await res.json().catch(() => null);
                const n = created?.lines?.length ?? 0;
                toast.success(n > 0 ? `明細書を取り込みました（${n}行を認識）` : '明細書を取り込みました（行の自動読み取りに失敗。手動で追加できます）');
                await fetchStatements();
                if (created?.id) onSelect(created.id);
            } else {
                const e = await res.json().catch(() => ({}));
                toast.error(e.error || '取り込みに失敗しました');
            }
        } catch {
            toast.error('取り込みに失敗しました');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // 照合進捗の集計
    const progress = (s: CardStatementSummary) => {
        const total = s.lines.length;
        const matched = s.lines.filter((l) => l.status === 'matched').length;
        const noReceipt = s.lines.filter((l) => l.status === 'no_receipt').length;
        return { total, matched, noReceipt, unmatched: total - matched - noReceipt };
    };

    // 検算（AI抽出時の行合計と明細書フッタの合計の不一致）
    const hasMismatch = (s: CardStatementSummary) => {
        const meta = s.extractedData;
        return meta != null && meta.reportedTotal != null && meta.computedTotal != null && Number(meta.reportedTotal) !== Number(meta.computedTotal);
    };

    return (
        <div>
            {/* アップロード（カード名必須） */}
            <div className="mb-4 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-1">「ご利用代金明細書」のPDF（または画像）を取り込みます</p>
                <p className="text-xs text-slate-400 mb-3">AIが全ページの明細行を読み取り、受け箱のレシートと照合できるようにします（1回=1明細書）。</p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
                    <div className="flex items-center gap-1.5 justify-center">
                        <span className="text-xs text-slate-500 whitespace-nowrap">カード名<span className="text-red-500">*</span></span>
                        <input
                            value={cardLabel}
                            onChange={(e) => setCardLabel(e.target.value)}
                            list="card-statement-labels"
                            placeholder="例: AMEX 今井"
                            className="w-44 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <datalist id="card-statement-labels">
                            {cardLabels.map((l) => <option key={l} value={l} />)}
                        </datalist>
                    </div>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="w-full sm:w-auto px-4 py-3 sm:py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? 'AI読み取り中…（1〜2分かかることがあります）' : '明細書を選択'}
                    </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files)} />
            </div>

            {/* 一覧 */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : statements.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                    <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p>明細書はまだありません</p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                                <th className="px-3 py-2.5">カード名</th>
                                <th className="px-3 py-2.5">締め日</th>
                                <th className="px-3 py-2.5 text-right">ご利用額合計</th>
                                <th className="px-3 py-2.5 text-center">行数</th>
                                <th className="px-3 py-2.5">照合の進み</th>
                                <th className="px-3 py-2.5">取込日</th>
                            </tr>
                        </thead>
                        <tbody>
                            {statements.map((s) => {
                                const p = progress(s);
                                return (
                                    <tr
                                        key={s.id}
                                        onClick={() => onSelect(s.id)}
                                        className="border-b border-slate-100 last:border-b-0 hover:bg-teal-50/40 cursor-pointer transition-colors"
                                    >
                                        <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                                            {s.cardLabel}
                                            {s.cardLast4 && <span className="ml-1.5 text-xs text-slate-400">…{s.cardLast4}</span>}
                                            {hasMismatch(s) && (
                                                <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200" title="AI読み取りの行合計が明細書の合計と一致していません。詳細画面で確認してください">
                                                    <AlertTriangle className="w-3 h-3" />合計不一致
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{fmtDate(s.closingDate)}</td>
                                        <td className="px-3 py-2.5 text-right font-semibold text-slate-900 whitespace-nowrap">{yen(s.totalAmount)}</td>
                                        <td className="px-3 py-2.5 text-center text-slate-600">{p.total}</td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1.5 text-xs">
                                                <span className="px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 font-semibold">照合済 {p.matched}</span>
                                                <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">不要 {p.noReceipt}</span>
                                                <span className={`px-1.5 py-0.5 rounded-full font-semibold border ${p.unmatched > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>未照合 {p.unmatched}</span>
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmtDate(s.createdAt)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
