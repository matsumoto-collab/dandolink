'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Loader2, FileText, Image as ImageIcon, AlertTriangle, Trash2, Plus, X, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { CardStatement, CardStatementLine, CardReceipt } from '@/types/creditCard';
import type { ExpenseCategoryRef } from '@/types/receipt';
import { findCandidates } from '@/lib/cardMatching';
import { fmtDate, yen, toInputDate } from './uploadPrep';

interface Props {
    statementId: string;
    categories: ExpenseCategoryRef[];
    onBack: () => void;
}

// 明細書詳細。明細行の費目仕分けと、受け箱レシートとの照合（候補提示→ワンタップ紐付け）を行う。
export default function CardStatementDetail({ statementId, categories, onBack }: Props) {
    const [statement, setStatement] = useState<CardStatement | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [unlinked, setUnlinked] = useState<CardReceipt[]>([]);
    const [savingLineId, setSavingLineId] = useState<string | null>(null);
    const [openLineId, setOpenLineId] = useState<string | null>(null); // 候補パネルを開いている行
    const [showAllPicker, setShowAllPicker] = useState(false); // 候補パネル内「受け箱から選ぶ」
    const [showAddForm, setShowAddForm] = useState(false);
    const [addDate, setAddDate] = useState('');
    const [addStore, setAddStore] = useState('');
    const [addAmount, setAddAmount] = useState('');
    const [adding, setAdding] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const [sRes, rRes] = await Promise.all([
                fetch(`/api/card-statements/${statementId}`, { cache: 'no-store' }),
                fetch('/api/card-receipts?linked=unlinked', { cache: 'no-store' }),
            ]);
            setStatement(sRes.ok ? await sRes.json() : null);
            setUnlinked(rRes.ok ? await rRes.json() : []);
        } catch (e) {
            logger.error('Failed to fetch statement detail:', e);
            setStatement(null);
        } finally {
            setIsLoading(false);
        }
    }, [statementId]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const replaceLine = (updated: CardStatementLine) =>
        setStatement((prev) => (prev ? { ...prev, lines: prev.lines.map((l) => (l.id === updated.id ? updated : l)) } : prev));

    // 行の PATCH（オートセーブ）。成功したら該当行だけ差し替える。
    const patchLine = async (id: string, patch: Record<string, unknown>): Promise<CardStatementLine | null> => {
        setSavingLineId(id);
        try {
            const res = await fetch(`/api/card-statement-lines/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const updated: CardStatementLine = await res.json();
            replaceLine(updated);
            return updated;
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '保存に失敗しました');
            setStatement((prev) => (prev ? { ...prev } : prev)); // 入力セルを保存済みの値に戻すための再レンダー
            return null;
        } finally {
            setSavingLineId(null);
        }
    };

    // 紐付け（候補 or 受け箱からワンタップ）
    const linkReceipt = async (line: CardStatementLine, receipt: CardReceipt) => {
        const updated = await patchLine(line.id, { cardReceiptId: receipt.id });
        if (updated) {
            setUnlinked((prev) => prev.filter((r) => r.id !== receipt.id));
            setOpenLineId(null);
            setShowAllPicker(false);
            toast.success('レシートを紐付けました');
        }
    };

    // 紐付け解除（レシートは受け箱の未照合へ戻る）
    const unlinkReceipt = async (line: CardStatementLine) => {
        const receipt = line.cardReceipt;
        const updated = await patchLine(line.id, { cardReceiptId: null });
        if (updated && receipt) {
            setUnlinked((prev) => [{ ...receipt, statementLine: null }, ...prev]);
            toast.success('紐付けを解除しました');
        }
    };

    const deleteLine = async (line: CardStatementLine) => {
        if (!confirm(`この明細行を削除しますか？\n${fmtDate(line.useDate)} ${line.storeName} ${yen(line.amount)}`)) return;
        setSavingLineId(line.id);
        try {
            const res = await fetch(`/api/card-statement-lines/${line.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            setStatement((prev) => (prev ? { ...prev, lines: prev.lines.filter((l) => l.id !== line.id) } : prev));
            if (line.cardReceipt) setUnlinked((prev) => [{ ...line.cardReceipt!, statementLine: null }, ...prev]);
            toast.success('削除しました');
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '削除に失敗しました');
        } finally {
            setSavingLineId(null);
        }
    };

    // ヘッダ（カード名・締め日・合計）の手修正
    const patchHeader = async (patch: Record<string, unknown>) => {
        try {
            const res = await fetch(`/api/card-statements/${statementId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const updated: CardStatement = await res.json();
            setStatement(updated);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '保存に失敗しました');
            setStatement((prev) => (prev ? { ...prev } : prev));
        }
    };

    const addLine = async () => {
        setAdding(true);
        try {
            const res = await fetch(`/api/card-statements/${statementId}/lines`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ useDate: addDate, storeName: addStore, amount: addAmount }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const created: CardStatementLine = await res.json();
            setStatement((prev) => (prev ? { ...prev, lines: [...prev.lines, created] } : prev));
            setShowAddForm(false);
            setAddDate('');
            setAddStore('');
            setAddAmount('');
            toast.success('明細行を追加しました');
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '行の追加に失敗しました');
        } finally {
            setAdding(false);
        }
    };

    const deleteStatement = async () => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/card-statements/${statementId}`, { method: 'DELETE' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            toast.success('明細書を削除しました（レシートは受け箱に残ります）');
            onBack();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '削除に失敗しました');
            setDeleting(false);
        }
    };

    // 行合計（マイナス込み）と検算
    const computedTotal = useMemo(
        () => (statement ? statement.lines.reduce((sum, l) => sum + Number(l.amount || 0), 0) : 0),
        [statement],
    );
    const reportedTotal = statement?.totalAmount != null && statement.totalAmount !== '' ? Number(statement.totalAmount) : null;
    const mismatch = reportedTotal != null && reportedTotal !== computedTotal;

    const progress = useMemo(() => {
        const lines = statement?.lines ?? [];
        const matched = lines.filter((l) => l.status === 'matched').length;
        const noReceipt = lines.filter((l) => l.status === 'no_receipt').length;
        return { total: lines.length, matched, noReceipt, unmatched: lines.length - matched - noReceipt };
    }, [statement]);

    if (isLoading) {
        return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>;
    }
    if (!statement) {
        return (
            <div className="text-center py-16 text-slate-500">
                <p className="mb-3">明細書を読み込めませんでした</p>
                <button onClick={onBack} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">一覧へ戻る</button>
            </div>
        );
    }

    const closingYmd = toInputDate(statement.closingDate);
    const inputCls = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500';

    return (
        <div>
            {/* ヘッダ */}
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">
                        <ArrowLeft className="w-4 h-4" />一覧へ
                    </button>
                    <h3 className="text-lg font-bold text-slate-900">
                        {statement.cardLabel}
                        {statement.cardLast4 && <span className="ml-1.5 text-sm font-medium text-slate-400">…{statement.cardLast4}</span>}
                    </h3>
                    {statement.memberName && <span className="text-sm text-slate-500">{statement.memberName} 様</span>}
                    <div className="ml-auto flex items-center gap-2">
                        {statement.signedUrl && (
                            <a href={statement.signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
                                <ExternalLink className="w-4 h-4" />元の明細書
                            </a>
                        )}
                        {confirmDelete ? (
                            <>
                                <button onClick={deleteStatement} disabled={deleting} className="px-3 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50">{deleting ? '削除中…' : '本当に削除'}</button>
                                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-sm text-slate-600">キャンセル</button>
                            </>
                        ) : (
                            <button onClick={() => setConfirmDelete(true)} title="明細書を削除" className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <label className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">締め日</span>
                        <input
                            type="date"
                            key={`closing-${closingYmd}`}
                            defaultValue={closingYmd}
                            onBlur={(e) => {
                                const v = e.target.value;
                                if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== closingYmd) patchHeader({ closingDate: v });
                            }}
                            className={inputCls}
                        />
                    </label>
                    <label className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">ご利用額合計</span>
                        <input
                            inputMode="numeric"
                            key={`total-${statement.totalAmount ?? ''}`}
                            defaultValue={reportedTotal != null ? String(reportedTotal) : ''}
                            placeholder="未読取"
                            onBlur={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, '');
                                if (v !== (reportedTotal != null ? String(reportedTotal) : '')) patchHeader({ totalAmount: v || null });
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className={`${inputCls} w-32 text-right`}
                        />
                    </label>
                    <span className="text-slate-600">行合計 <strong className={mismatch ? 'text-amber-700' : 'text-slate-900'}>{yen(computedTotal)}</strong>（{progress.total}行）</span>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 font-semibold">照合済 {progress.matched}</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">不要 {progress.noReceipt}</span>
                        <span className={`px-1.5 py-0.5 rounded-full font-semibold border ${progress.unmatched > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>未照合 {progress.unmatched}</span>
                    </span>
                </div>
                {mismatch && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                            行合計（{yen(computedTotal)}）が明細書のご利用額合計（{yen(reportedTotal)}）と一致していません。
                            読み取り漏れの行は「行を追加」で、誤読は各行の修正で直せます（差額 {yen(reportedTotal! - computedTotal)}）。
                        </span>
                    </div>
                )}
            </div>

            {/* 明細行テーブル */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[860px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                            <th className="px-2 py-2.5 w-[140px]">利用日</th>
                            <th className="px-2 py-2.5">ご利用店名</th>
                            <th className="px-2 py-2.5 text-right w-[130px]">金額</th>
                            <th className="px-2 py-2.5 w-[170px]">費目</th>
                            <th className="px-2 py-2.5 w-[190px]">レシート照合</th>
                            <th className="px-1 py-2.5 w-[44px]"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {statement.lines.map((line) => (
                            <LineRow
                                key={line.id}
                                line={line}
                                categories={categories}
                                unlinked={unlinked}
                                saving={savingLineId === line.id}
                                isOpen={openLineId === line.id}
                                showAllPicker={showAllPicker}
                                onToggleOpen={() => {
                                    setOpenLineId((prev) => (prev === line.id ? null : line.id));
                                    setShowAllPicker(false);
                                }}
                                onToggleAllPicker={() => setShowAllPicker((v) => !v)}
                                onPatch={(patch) => patchLine(line.id, patch)}
                                onLink={(receipt) => linkReceipt(line, receipt)}
                                onUnlink={() => unlinkReceipt(line)}
                                onDelete={() => deleteLine(line)}
                                onOpenImage={(url) => setLightboxUrl(url)}
                            />
                        ))}
                        {statement.lines.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                                    明細行がありません。AIの読み取りに失敗した場合は「行を追加」で手入力できます。
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 行の手動追加 */}
            <div className="mt-3">
                {showAddForm ? (
                    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-slate-600">利用日</span>
                            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                            <span className="text-xs font-semibold text-slate-600">ご利用店名</span>
                            <input value={addStore} onChange={(e) => setAddStore(e.target.value)} placeholder="店名" className={`${inputCls} w-full`} />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-slate-600">金額（返金は −）</span>
                            <input inputMode="numeric" value={addAmount} onChange={(e) => setAddAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="0" className={`${inputCls} w-28 text-right`} />
                        </label>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={addLine}
                                disabled={adding || !addDate || !addStore.trim() || addAmount === '' || addAmount === '-'}
                                className="px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium inline-flex items-center gap-2 disabled:opacity-50"
                            >
                                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}追加
                            </button>
                            <button onClick={() => setShowAddForm(false)} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">キャンセル</button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => setShowAddForm(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">
                        <Plus className="w-4 h-4" />行を追加
                    </button>
                )}
            </div>

            {/* レシート画像のライトボックス */}
            {lightboxUrl && (
                <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
                    <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="閉じる">
                        <X className="w-6 h-6" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightboxUrl} alt="レシート" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

// 明細1行。セルの blur / 選択でそのまま保存する（行単位オートセーブ・CashbookRow と同パターン）。
function LineRow({ line, categories, unlinked, saving, isOpen, showAllPicker, onToggleOpen, onToggleAllPicker, onPatch, onLink, onUnlink, onDelete, onOpenImage }: {
    line: CardStatementLine;
    categories: ExpenseCategoryRef[];
    unlinked: CardReceipt[];
    saving: boolean;
    isOpen: boolean;
    showAllPicker: boolean;
    onToggleOpen: () => void;
    onToggleAllPicker: () => void;
    onPatch: (patch: Record<string, unknown>) => void;
    onLink: (receipt: CardReceipt) => void;
    onUnlink: () => void;
    onDelete: () => void;
    onOpenImage: (url: string) => void;
}) {
    const amount = Number(line.amount || 0);
    const dateYmd = line.useDate.slice(0, 10);
    const { exact, amountOnly } = useMemo(() => findCandidates(line, unlinked), [line, unlinked]);
    const candidateCount = exact.length + amountOnly.length;

    const cellInput = 'w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500';

    return (
        <>
            <tr className={`border-b border-slate-100 hover:bg-slate-50 ${saving ? 'opacity-60' : ''} ${isOpen ? 'bg-teal-50/40' : ''}`}>
                {/* 利用日 */}
                <td className="px-2 py-1.5 whitespace-nowrap">
                    <input
                        type="date"
                        key={`d-${line.id}-${dateYmd}`}
                        defaultValue={dateYmd}
                        disabled={saving}
                        onBlur={(e) => {
                            const v = e.target.value;
                            if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== dateYmd) onPatch({ useDate: v });
                            else if (!v) e.target.value = dateYmd; // 空にされたら元へ戻す
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className={`${cellInput} text-slate-700`}
                    />
                </td>
                {/* 店名（＋店舗カテゴリ・商品明細・外貨情報を小さく） */}
                <td className="px-2 py-1.5">
                    <input
                        type="text"
                        key={`s-${line.id}-${line.storeName}`}
                        defaultValue={line.storeName}
                        disabled={saving}
                        onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== line.storeName) onPatch({ storeName: v });
                            else if (!v) e.target.value = line.storeName;
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className={`${cellInput} min-w-[180px] text-slate-800 font-medium`}
                    />
                    {(line.storeCategory || line.foreignAmount != null || line.itemDetails) && (
                        <div className="px-2 text-[11px] text-slate-400 truncate max-w-[360px]">
                            {[
                                line.storeCategory,
                                line.foreignAmount != null ? `${Number(line.foreignAmount).toLocaleString()} ${line.currency ?? ''}${line.exchangeRate != null ? ` @${Number(line.exchangeRate)}` : ''}` : null,
                                line.itemDetails,
                            ].filter(Boolean).join(' ・ ')}
                        </div>
                    )}
                </td>
                {/* 金額（返金はマイナス・赤字表示） */}
                <AmountCell amount={amount} saving={saving} onCommit={(n) => onPatch({ amount: n })} />
                {/* 費目 */}
                <td className="px-2 py-1.5">
                    <select
                        value={line.expenseCategoryId ?? ''}
                        disabled={saving}
                        onChange={(e) => onPatch({ expenseCategoryId: e.target.value || null })}
                        className={`${cellInput} text-slate-700`}
                    >
                        <option value="">—</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </td>
                {/* 照合 */}
                <td className="px-2 py-1.5 whitespace-nowrap">
                    {line.status === 'matched' && line.cardReceipt ? (
                        <div className="flex items-center gap-1.5">
                            {line.cardReceipt.thumbnailSignedUrl ? (
                                <button
                                    onClick={() => line.cardReceipt?.signedUrl && onOpenImage(line.cardReceipt.signedUrl)}
                                    title={line.cardReceipt.storeName ?? 'レシート'}
                                    className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-teal-200 overflow-hidden hover:ring-2 hover:ring-teal-400"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={line.cardReceipt.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                                </button>
                            ) : line.cardReceipt.signedUrl ? (
                                <a href={line.cardReceipt.signedUrl} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-teal-200 text-teal-600 hover:bg-teal-50">
                                    <FileText className="w-4 h-4" />
                                </a>
                            ) : (
                                <ImageIcon className="w-4 h-4 text-slate-300 shrink-0" />
                            )}
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-teal-50 text-teal-700 border border-teal-200">照合済み</span>
                            <button onClick={onUnlink} disabled={saving} title="紐付けを解除する" className="px-1 text-slate-300 hover:text-slate-600">✕</button>
                        </div>
                    ) : line.status === 'no_receipt' ? (
                        <button
                            onClick={() => onPatch({ status: 'unmatched' })}
                            disabled={saving}
                            title="タップで未照合に戻す"
                            className="px-2 py-1 text-xs font-semibold rounded-full border bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200 transition-colors"
                        >
                            レシート不要
                        </button>
                    ) : (
                        <button
                            onClick={onToggleOpen}
                            disabled={saving}
                            className={`px-2 py-1 text-xs font-semibold rounded-full border transition-colors ${
                                candidateCount > 0
                                    ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                            }`}
                        >
                            {candidateCount > 0 ? `候補 ${candidateCount}件` : '未照合'}
                        </button>
                    )}
                </td>
                {/* 削除 */}
                <td className="px-1 py-1.5 text-center">
                    {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-400 inline-block" />
                    ) : (
                        <button onClick={onDelete} title="この行を削除" className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </td>
            </tr>

            {/* 候補パネル（未照合の行のみ・行の直下に展開） */}
            {isOpen && line.status === 'unmatched' && (
                <tr className="border-b border-slate-100 bg-teal-50/30">
                    <td colSpan={6} className="px-3 py-3">
                        <div className="space-y-2">
                            {exact.length + amountOnly.length > 0 && !showAllPicker ? (
                                <>
                                    <p className="text-xs font-semibold text-slate-600">金額・日付の近いレシート（タップで紐付け）</p>
                                    <CandidateList receipts={exact} onLink={onLink} onOpenImage={onOpenImage} />
                                    {amountOnly.length > 0 && (
                                        <>
                                            <p className="text-xs text-slate-500">金額のみ一致（日付が読み取れていないレシート）</p>
                                            <CandidateList receipts={amountOnly} onLink={onLink} onOpenImage={onOpenImage} />
                                        </>
                                    )}
                                </>
                            ) : showAllPicker ? (
                                <>
                                    <p className="text-xs font-semibold text-slate-600">受け箱の未照合レシート（タップで紐付け）</p>
                                    {unlinked.length > 0 ? (
                                        <CandidateList receipts={unlinked} onLink={onLink} onOpenImage={onOpenImage} />
                                    ) : (
                                        <p className="text-sm text-slate-400">未照合のレシートがありません</p>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm text-slate-500">金額・日付の近いレシートが受け箱に見つかりませんでした。</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button onClick={onToggleAllPicker} className="px-3 py-1.5 text-xs bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">
                                    {showAllPicker ? '候補に戻す' : '受け箱から選ぶ'}
                                </button>
                                <button
                                    onClick={() => onPatch({ status: 'no_receipt' })}
                                    className="px-3 py-1.5 text-xs bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium"
                                    title="サブスク・オンライン決済などレシートが存在しない利用"
                                >
                                    レシート不要にする
                                </button>
                                <button onClick={onToggleOpen} className="ml-auto px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700">閉じる</button>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// 候補レシートのリスト（サムネ＋店名＋日付＋金額＋紐付けボタン）
function CandidateList({ receipts, onLink, onOpenImage }: {
    receipts: CardReceipt[];
    onLink: (receipt: CardReceipt) => void;
    onOpenImage: (url: string) => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {receipts.map((r) => {
                const isPdf = r.mimeType === 'application/pdf' || r.sourceType === 'pdf';
                return (
                    <div key={r.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
                        {isPdf ? (
                            r.signedUrl ? (
                                <a href={r.signedUrl} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                                    <FileText className="w-4 h-4" />
                                </a>
                            ) : (
                                <FileText className="w-4 h-4 text-slate-300 shrink-0" />
                            )
                        ) : (
                            <button
                                onClick={() => r.signedUrl && onOpenImage(r.signedUrl)}
                                title="拡大表示"
                                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 overflow-hidden hover:ring-2 hover:ring-teal-400"
                            >
                                {r.thumbnailSignedUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={r.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <ImageIcon className="w-4 h-4 text-slate-400" />
                                )}
                            </button>
                        )}
                        <div className="text-xs leading-tight">
                            <div className="font-medium text-slate-800 max-w-[160px] truncate">{r.storeName || '（店名未読取）'}</div>
                            <div className="text-slate-500">{fmtDate(r.issueDate)} ・ {yen(r.totalAmount)}</div>
                        </div>
                        <button onClick={() => onLink(r)} className="ml-1 px-2.5 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium">
                            紐付け
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

// 金額セル。クリックで編集し、blur / Enter で確定（Escape で破棄）。返金行のマイナスを許容する。
function AmountCell({ amount, saving, onCommit }: {
    amount: number;
    saving: boolean;
    onCommit: (n: number) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');

    const start = () => {
        if (saving) return;
        setDraft(amount !== 0 ? String(amount) : '');
        setEditing(true);
    };
    const commit = () => {
        setEditing(false);
        const cleaned = draft.replace(/[^\d-]/g, '');
        if (cleaned === '' || cleaned === '-') return; // 空のまま抜けたら変更なし
        const n = Number(cleaned);
        if (!Number.isFinite(n)) return;
        if (n === amount) return;
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
                    className={`w-full min-h-[34px] rounded-lg px-2 py-1.5 text-sm text-right font-semibold hover:bg-slate-100 ${amount < 0 ? 'text-red-600' : 'text-slate-900'}`}
                >
                    {amount < 0 ? `-¥${Math.abs(amount).toLocaleString()}` : `¥${amount.toLocaleString()}`}
                </button>
            )}
        </td>
    );
}
