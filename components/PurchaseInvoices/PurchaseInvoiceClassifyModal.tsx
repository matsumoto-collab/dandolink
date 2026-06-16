'use client';

import React, { useState, useEffect } from 'react';
import { X, Loader2, Trash2, Search, RefreshCw, Save, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { PurchaseInvoice, ExpenseCategoryRef, PayeeRef, ProjectMasterRef } from '@/types/purchaseInvoice';

interface Props {
    invoice: PurchaseInvoice;
    onClose: () => void;
    onSaved: () => void;
}

const toInputDate = (s: string | null) => {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const toAmountStr = (n: number | string | null) => (n == null || n === '' ? '' : String(Number(n)));

function projectHintOf(inv: PurchaseInvoice): string | null {
    const d = inv.extractedData as { projectHint?: string } | null;
    return d && typeof d.projectHint === 'string' && d.projectHint ? d.projectHint : null;
}

export default function PurchaseInvoiceClassifyModal({ invoice, onClose, onSaved }: Props) {
    const [payeeName, setPayeeName] = useState(invoice.payeeName ?? '');
    const [payeeId, setPayeeId] = useState(invoice.payeeId ?? '');
    const [issueDate, setIssueDate] = useState(toInputDate(invoice.issueDate));
    const [dueDate, setDueDate] = useState(toInputDate(invoice.dueDate));
    const [totalAmount, setTotalAmount] = useState(toAmountStr(invoice.totalAmount));
    const [taxAmount, setTaxAmount] = useState(toAmountStr(invoice.taxAmount));
    const [expenseCategoryId, setExpenseCategoryId] = useState(invoice.expenseCategoryId ?? '');
    const [notes, setNotes] = useState(invoice.notes ?? '');

    const [projectMasterId, setProjectMasterId] = useState(invoice.projectMasterId ?? '');
    const [selectedProjectLabel, setSelectedProjectLabel] = useState(
        invoice.projectMaster ? invoice.projectMaster.name || invoice.projectMaster.title : ''
    );

    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);
    const [payees, setPayees] = useState<PayeeRef[]>([]);

    const [projectQuery, setProjectQuery] = useState('');
    const [projectResults, setProjectResults] = useState<ProjectMasterRef[]>([]);
    const [searchingProject, setSearchingProject] = useState(false);
    const [showProjectSearch, setShowProjectSearch] = useState(!invoice.projectMasterId);

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const [cRes, pRes] = await Promise.all([
                    fetch('/api/master-data/expense-categories'),
                    fetch('/api/payees'),
                ]);
                if (cRes.ok) setCategories(await cRes.json());
                if (pRes.ok) setPayees(await pRes.json());
            } catch (e) {
                logger.error('master fetch failed', e);
            }
        })();
    }, []);

    useEffect(() => {
        if (!showProjectSearch) return;
        const q = projectQuery.trim();
        const h = setTimeout(async () => {
            setSearchingProject(true);
            try {
                const url = q
                    ? `/api/project-masters?status=active&search=${encodeURIComponent(q)}`
                    : '/api/project-masters?status=active';
                const res = await fetch(url, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    const list: Array<{ id: string; title: string; name: string | null }> = Array.isArray(data)
                        ? data
                        : data.items ?? data.projectMasters ?? [];
                    setProjectResults(list.slice(0, 30).map((p) => ({ id: p.id, title: p.title, name: p.name ?? null })));
                }
            } catch (e) {
                logger.error('project search failed', e);
            } finally {
                setSearchingProject(false);
            }
        }, 300);
        return () => clearTimeout(h);
    }, [projectQuery, showProjectSearch]);

    const selectProject = (p: ProjectMasterRef) => {
        setProjectMasterId(p.id);
        setSelectedProjectLabel(p.name || p.title);
        setShowProjectSearch(false);
        setProjectQuery('');
    };
    const clearProject = () => {
        setProjectMasterId('');
        setSelectedProjectLabel('');
        setShowProjectSearch(true);
    };

    const onSelectPayee = (id: string) => {
        setPayeeId(id);
        const p = payees.find((x) => x.id === id);
        if (p) setPayeeName(p.name);
    };

    const save = async (nextStatus?: string) => {
        setSaving(true);
        try {
            const body: Record<string, unknown> = {
                payeeName,
                payeeId: payeeId || null,
                issueDate: issueDate || null,
                dueDate: dueDate || null,
                totalAmount: totalAmount || null,
                taxAmount: taxAmount || null,
                expenseCategoryId: expenseCategoryId || null,
                projectMasterId: projectMasterId || null,
                notes,
            };
            if (nextStatus) body.status = nextStatus;
            const res = await fetch(`/api/purchase-invoices/${invoice.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                toast.success('保存しました');
                onSaved();
            } else {
                const e = await res.json().catch(() => ({}));
                toast.error(e.error || '保存に失敗しました');
            }
        } catch {
            toast.error('保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/purchase-invoices/${invoice.id}`, { method: 'DELETE' });
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

    const handleReextract = async () => {
        setExtracting(true);
        try {
            const res = await fetch(`/api/purchase-invoices/${invoice.id}/extract`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setPayeeName(data.payeeName ?? '');
                setIssueDate(toInputDate(data.issueDate));
                setDueDate(toInputDate(data.dueDate));
                setTotalAmount(toAmountStr(data.totalAmount));
                setTaxAmount(toAmountStr(data.taxAmount));
                if (data.expenseCategoryId) setExpenseCategoryId(data.expenseCategoryId);
                toast.success('AIで再読み取りしました');
            } else {
                const e = await res.json().catch(() => ({}));
                toast.error(e.error || '再読み取りに失敗しました');
            }
        } catch {
            toast.error('再読み取りに失敗しました');
        } finally {
            setExtracting(false);
        }
    };

    const isConfirmed = invoice.status === 'confirmed';
    const canConfirm = !!projectMasterId && !!expenseCategoryId && !!totalAmount && !!payeeName.trim();

    const handleConfirm = async () => {
        setConfirming(true);
        try {
            const saveBody = {
                payeeName,
                payeeId: payeeId || null,
                issueDate: issueDate || null,
                dueDate: dueDate || null,
                totalAmount: totalAmount || null,
                taxAmount: taxAmount || null,
                expenseCategoryId: expenseCategoryId || null,
                projectMasterId: projectMasterId || null,
                notes,
            };
            const sres = await fetch(`/api/purchase-invoices/${invoice.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(saveBody),
            });
            if (!sres.ok) {
                const e = await sres.json().catch(() => ({}));
                toast.error(e.error || '保存に失敗しました');
                return;
            }
            const cres = await fetch(`/api/purchase-invoices/${invoice.id}/confirm`, { method: 'POST' });
            if (cres.ok) {
                toast.success('確定し、原価と支払予定に登録しました');
                onSaved();
            } else {
                const e = await cres.json().catch(() => ({}));
                toast.error(e.error || '確定に失敗しました');
            }
        } catch {
            toast.error('確定に失敗しました');
        } finally {
            setConfirming(false);
        }
    };

    const isImage = invoice.mimeType.startsWith('image/');
    const hint = projectHintOf(invoice);

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <h3 className="font-bold text-slate-900">仕入請求書の仕分け</h3>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2">
                    {/* 左: プレビュー */}
                    <div className="bg-slate-100 p-3 lg:border-r border-slate-200 min-h-[240px] flex flex-col">
                        <div className="flex-1 flex items-center justify-center overflow-hidden">
                            {isImage && invoice.signedUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={invoice.signedUrl} alt="請求書" className="max-w-full max-h-[70vh] object-contain rounded" />
                            ) : invoice.signedUrl ? (
                                <iframe src={invoice.signedUrl} className="w-full h-[70vh] rounded" title="請求書PDF" />
                            ) : (
                                <p className="text-slate-400 text-sm">プレビューを表示できません</p>
                            )}
                        </div>
                        {invoice.signedUrl && (
                            <a
                                href={invoice.signedUrl}
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
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">支払先</label>
                            <input value={payeeName} onChange={(e) => { setPayeeName(e.target.value); setPayeeId(''); }} className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500" placeholder="支払先名" />
                            {payees.length > 0 && (
                                <select value={payeeId} onChange={(e) => onSelectPayee(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500">
                                    <option value="">振込先マスターから選択…</option>
                                    {payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">税込金額</label>
                                <input inputMode="numeric" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500" placeholder="0" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">うち消費税</label>
                                <input inputMode="numeric" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500" placeholder="0" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">発行日</label>
                                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">支払期日</label>
                                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">費目</label>
                            <select value={expenseCategoryId} onChange={(e) => setExpenseCategoryId(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500">
                                <option value="">未選択</option>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">紐付け案件</label>
                            {!showProjectSearch && projectMasterId ? (
                                <div className="flex items-center gap-2">
                                    <span className="flex-1 px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl text-teal-800 text-sm truncate">{selectedProjectLabel}</span>
                                    <button onClick={clearProject} className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">変更</button>
                                </div>
                            ) : (
                                <div>
                                    <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-xl">
                                        <Search className="w-4 h-4 text-slate-400" />
                                        <input value={projectQuery} onChange={(e) => setProjectQuery(e.target.value)} className="flex-1 outline-none text-sm" placeholder="案件名・現場名で検索" />
                                        {searchingProject && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                                    </div>
                                    {projectResults.length > 0 && (
                                        <div className="mt-1 max-h-44 overflow-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                                            {projectResults.map((p) => (
                                                <button key={p.id} onClick={() => selectProject(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 truncate">{p.name || p.title}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {hint && !projectMasterId && <p className="text-xs text-slate-400 mt-1">AIヒント: {hint}</p>}
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">メモ</label>
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none" />
                        </div>

                        {invoice.items.length > 0 && (
                            <details className="text-sm">
                                <summary className="cursor-pointer text-slate-500">AIが読み取った明細（{invoice.items.length}件）</summary>
                                <div className="mt-1 border border-slate-200 rounded-xl divide-y divide-slate-100">
                                    {invoice.items.map((it) => (
                                        <div key={it.id} className="flex justify-between px-3 py-1.5">
                                            <span className="truncate text-slate-700">{it.name}</span>
                                            <span className="text-slate-500 shrink-0 ml-2">{it.amount != null && it.amount !== '' ? `¥${Number(it.amount).toLocaleString()}` : ''}</span>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2">
                        {confirmDelete ? (
                            <>
                                <button onClick={handleDelete} disabled={deleting} className="px-3 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50">{deleting ? '削除中…' : '本当に削除'}</button>
                                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-sm text-slate-600">キャンセル</button>
                            </>
                        ) : (
                            <>
                                <button onClick={() => setConfirmDelete(true)} className="p-2 text-slate-500 hover:bg-slate-200 rounded-xl" title="削除"><Trash2 className="w-4 h-4" /></button>
                                {invoice.status !== 'confirmed' && (
                                    <button onClick={handleReextract} disabled={extracting} className="p-2 text-slate-500 hover:bg-slate-200 rounded-xl disabled:opacity-50" title="AIで再読み取り">
                                        {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {isConfirmed ? (
                            <span className="text-sm font-medium text-teal-700">確定済み（原価・支払予定に登録済み）</span>
                        ) : (
                            <>
                                <button onClick={() => save('classified')} disabled={saving || confirming} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium inline-flex items-center gap-2 disabled:opacity-50">
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    仕分けを保存
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={!canConfirm || confirming || saving}
                                    title={!canConfirm ? '支払先・税込金額・費目・案件を入力してください' : undefined}
                                    className="px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium inline-flex items-center gap-2 disabled:opacity-50"
                                >
                                    {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    確定して登録
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
