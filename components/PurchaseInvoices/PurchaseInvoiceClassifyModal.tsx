'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, Trash2, Search, RefreshCw, Save, ExternalLink, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { PurchaseInvoice, ExpenseCategoryRef, PayeeRef, ProjectMasterRef } from '@/types/purchaseInvoice';

interface Props {
    invoice: PurchaseInvoice;
    onClose: () => void;
    onSaved: () => void;
}

// 画面上で編集する1配分行（案件×費目×金額）。amount は入力文字列で保持する。
interface AllocationRow {
    key: string;
    projectMasterId: string;
    projectLabel: string;
    expenseCategoryId: string;
    amount: string;
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

// 初期配分行を決める。①既存の配分があればそれを使う ②無ければ旧単一フィールドから1行を生成（移行期の互換）
// ③どちらも無ければ費目だけAI推定を入れた空1行。
function initialAllocations(inv: PurchaseInvoice): AllocationRow[] {
    if (inv.allocations && inv.allocations.length > 0) {
        return inv.allocations.map((a) => ({
            key: a.id,
            projectMasterId: a.projectMasterId ?? '',
            projectLabel: a.projectMaster ? a.projectMaster.name || a.projectMaster.title : '',
            expenseCategoryId: a.expenseCategoryId ?? '',
            amount: toAmountStr(a.amount),
        }));
    }
    if (inv.projectMasterId) {
        return [{
            key: 'init-0',
            projectMasterId: inv.projectMasterId,
            projectLabel: inv.projectMaster ? inv.projectMaster.name || inv.projectMaster.title : '',
            expenseCategoryId: inv.expenseCategoryId ?? '',
            amount: toAmountStr(inv.totalAmount),
        }];
    }
    return [{ key: 'init-0', projectMasterId: '', projectLabel: '', expenseCategoryId: inv.expenseCategoryId ?? '', amount: '' }];
}

export default function PurchaseInvoiceClassifyModal({ invoice, onClose, onSaved }: Props) {
    const [payeeName, setPayeeName] = useState(invoice.payeeName ?? '');
    const [payeeId, setPayeeId] = useState(invoice.payeeId ?? '');
    const [issueDate, setIssueDate] = useState(toInputDate(invoice.issueDate));
    const [dueDate, setDueDate] = useState(toInputDate(invoice.dueDate));
    const [totalAmount, setTotalAmount] = useState(toAmountStr(invoice.totalAmount));
    const [taxAmount, setTaxAmount] = useState(toAmountStr(invoice.taxAmount));
    // AIが推定した費目。新しい配分行の初期費目に使う（既存行の費目は上書きしない）。
    const [aiCategoryId, setAiCategoryId] = useState(invoice.expenseCategoryId ?? '');
    const [notes, setNotes] = useState(invoice.notes ?? '');
    const [payeeKana, setPayeeKana] = useState(invoice.payeeKana ?? '');
    const [bankName, setBankName] = useState(invoice.bankName ?? '');
    const [branchName, setBranchName] = useState(invoice.branchName ?? '');
    const [accountType, setAccountType] = useState(invoice.accountType ?? '');
    const [accountNumber, setAccountNumber] = useState(invoice.accountNumber ?? '');
    const [accountHolder, setAccountHolder] = useState(invoice.accountHolder ?? '');
    const [showBankFields, setShowBankFields] = useState(
        !!(invoice.bankName || invoice.accountNumber || invoice.accountHolder)
    );

    const [allocations, setAllocations] = useState<AllocationRow[]>(() => initialAllocations(invoice));
    const keyCounter = useRef(0);
    const newKey = () => `new-${keyCounter.current++}`;

    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);
    const [payees, setPayees] = useState<PayeeRef[]>([]);

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

    // 配分の集計（税込金額との差額をリアルタイム表示・確定可否に使う）
    const totalNum = Number(totalAmount) || 0;
    const allocTotal = allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const remainder = totalNum - allocTotal;
    const allocationsValid = allocations.length > 0 && allocations.every((a) => a.projectMasterId && a.expenseCategoryId && Number(a.amount) > 0);

    const updateRow = (key: string, patch: Partial<AllocationRow>) =>
        setAllocations((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const removeRow = (key: string) =>
        setAllocations((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
    const addRow = () =>
        setAllocations((prev) => [...prev, { key: newKey(), projectMasterId: '', projectLabel: '', expenseCategoryId: aiCategoryId, amount: '' }]);
    // 残額（税込−配分合計）をこの行に足し込み、合計を税込金額にぴったり合わせる。
    const applyRemainderTo = (key: string) =>
        setAllocations((prev) => prev.map((r) => {
            if (r.key !== key) return r;
            const next = (Number(r.amount) || 0) + remainder;
            return { ...r, amount: next > 0 ? String(next) : '0' };
        }));

    const onSelectPayee = (id: string) => {
        setPayeeId(id);
        const p = payees.find((x) => x.id === id);
        if (p) {
            setPayeeName(p.name);
            // 既存マスターの口座情報を補完
            if (p.nameKana != null) setPayeeKana(p.nameKana);
            if (p.bankName != null) setBankName(p.bankName);
            if (p.branchName != null) setBranchName(p.branchName);
            if (p.accountType != null) setAccountType(p.accountType);
            if (p.accountNumber != null) setAccountNumber(p.accountNumber);
            if (p.accountHolder != null) setAccountHolder(p.accountHolder);
            setShowBankFields(true);
        }
    };

    // 保存・確定で共通の本文。新UIは配分(allocations)を送り、旧 projectMasterId/expenseCategoryId 単一は送らない。
    const buildBody = (nextStatus?: string): Record<string, unknown> => ({
        payeeName,
        payeeId: payeeId || null,
        issueDate: issueDate || null,
        dueDate: dueDate || null,
        totalAmount: totalAmount || null,
        taxAmount: taxAmount || null,
        notes,
        payeeKana: payeeKana || null,
        bankName: bankName || null,
        branchName: branchName || null,
        accountType: accountType || null,
        accountNumber: accountNumber || null,
        accountHolder: accountHolder || null,
        allocations: allocations.map((a) => ({
            projectMasterId: a.projectMasterId || null,
            expenseCategoryId: a.expenseCategoryId || null,
            amount: a.amount || null,
        })),
        ...(nextStatus ? { status: nextStatus } : {}),
    });

    const save = async (nextStatus?: string) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/purchase-invoices/${invoice.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBody(nextStatus)),
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
                if (data.expenseCategoryId) setAiCategoryId(data.expenseCategoryId);
                setPayeeKana(data.payeeKana ?? '');
                setBankName(data.bankName ?? '');
                setBranchName(data.branchName ?? '');
                setAccountType(data.accountType ?? '');
                setAccountNumber(data.accountNumber ?? '');
                setAccountHolder(data.accountHolder ?? '');
                if (data.bankName || data.accountNumber) setShowBankFields(true);
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
    // 不足（残額あり）は確定可。超過（配分が税込を超える）は不可。
    const canConfirm = !!payeeName.trim() && totalNum > 0 && allocationsValid && remainder >= 0;
    const confirmHint = !payeeName.trim()
        ? '支払先を入力してください'
        : totalNum <= 0
            ? '税込金額を入力してください'
            : !allocationsValid
                ? '各配分に案件・費目・金額を入力してください'
                : remainder < 0
                    ? '配分の合計が税込金額を超えています'
                    : undefined;

    const handleConfirm = async () => {
        setConfirming(true);
        try {
            const sres = await fetch(`/api/purchase-invoices/${invoice.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBody()),
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
    const hasUnassigned = allocations.some((r) => !r.projectMasterId);

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

                        {/* 案件への配分（1枚を複数案件へ按分） */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-xs font-semibold text-slate-600">案件への配分</label>
                                <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800">
                                    <Plus className="w-3.5 h-3.5" />案件を追加
                                </button>
                            </div>
                            <div className="space-y-2">
                                {allocations.map((row) => (
                                    <AllocationRowEditor
                                        key={row.key}
                                        row={row}
                                        categories={categories}
                                        canRemove={allocations.length > 1}
                                        remainder={remainder}
                                        onChange={(patch) => updateRow(row.key, patch)}
                                        onRemove={() => removeRow(row.key)}
                                        onApplyRemainder={() => applyRemainderTo(row.key)}
                                    />
                                ))}
                            </div>
                            {/* 合計バー（一致=ティール／不足=アンバー・確定可／超過=赤・確定不可） */}
                            <div className={`mt-2 flex items-center justify-between px-3 py-2 rounded-xl border text-sm ${totalNum > 0 && remainder === 0 ? 'bg-teal-50 border-teal-200 text-teal-800' : remainder < 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                                <span>配分 <strong>¥{allocTotal.toLocaleString()}</strong> / 税込 ¥{totalNum.toLocaleString()}</span>
                                <span className="font-semibold">
                                    {totalNum === 0 ? '税込金額を入力' : remainder === 0 ? '✓ 一致' : remainder > 0 ? `残り ¥${remainder.toLocaleString()}（原価未計上）` : `超過 ¥${(-remainder).toLocaleString()}`}
                                </span>
                            </div>
                            {hint && hasUnassigned && <p className="text-xs text-slate-400 mt-1">AIヒント: {hint}</p>}
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">メモ</label>
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none" />
                        </div>

                        <div>
                            <button type="button" onClick={() => setShowBankFields((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                                振込先口座（任意）<span className="text-slate-400">{showBankFields ? '▲' : '▼'}</span>
                            </button>
                            {showBankFields && (
                                <div className="space-y-2 p-2.5 border border-slate-200 rounded-xl bg-slate-50">
                                    <div className="grid grid-cols-2 gap-2">
                                        <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm" placeholder="銀行名" />
                                        <input value={branchName} onChange={(e) => setBranchName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm" placeholder="支店名" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <select value={accountType} onChange={(e) => setAccountType(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm">
                                            <option value="">口座種別</option>
                                            <option value="普通">普通</option>
                                            <option value="当座">当座</option>
                                        </select>
                                        <input inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm" placeholder="口座番号" />
                                    </div>
                                    <input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm" placeholder="口座名義（カナ）" />
                                    <input value={payeeKana} onChange={(e) => setPayeeKana(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm" placeholder="支払先フリガナ（カタカナ）" />
                                </div>
                            )}
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
                                    title={confirmHint}
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

// 1配分行のエディタ。案件検索（デバウンス）を行ごとに自前で持つ。
function AllocationRowEditor({
    row,
    categories,
    canRemove,
    remainder,
    onChange,
    onRemove,
    onApplyRemainder,
}: {
    row: AllocationRow;
    categories: ExpenseCategoryRef[];
    canRemove: boolean;
    remainder: number;
    onChange: (patch: Partial<AllocationRow>) => void;
    onRemove: () => void;
    onApplyRemainder: () => void;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ProjectMasterRef[]>([]);
    const [searching, setSearching] = useState(false);
    const [editingProject, setEditingProject] = useState(!row.projectMasterId);

    useEffect(() => {
        if (!editingProject) return;
        const q = query.trim();
        const h = setTimeout(async () => {
            setSearching(true);
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
                    setResults(list.slice(0, 30).map((p) => ({ id: p.id, title: p.title, name: p.name ?? null })));
                }
            } catch (e) {
                logger.error('project search failed', e);
            } finally {
                setSearching(false);
            }
        }, 300);
        return () => clearTimeout(h);
    }, [query, editingProject]);

    const pick = (p: ProjectMasterRef) => {
        onChange({ projectMasterId: p.id, projectLabel: p.name || p.title });
        setEditingProject(false);
        setQuery('');
        setResults([]);
    };

    return (
        <div className="p-2.5 border border-slate-200 rounded-xl bg-slate-50 space-y-2">
            {/* 案件 */}
            {!editingProject && row.projectMasterId ? (
                <div className="flex items-center gap-2">
                    <span className="flex-1 px-2.5 py-1.5 bg-teal-50 border border-teal-200 rounded-lg text-teal-800 text-sm truncate">{row.projectLabel || '（案件名 未取得）'}</span>
                    <button type="button" onClick={() => setEditingProject(true)} className="px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-white">変更</button>
                    {canRemove && (
                        <button type="button" onClick={onRemove} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg" title="この配分を削除"><Trash2 className="w-4 h-4" /></button>
                    )}
                </div>
            ) : (
                <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white">
                            <Search className="w-4 h-4 text-slate-400 shrink-0" />
                            <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-0 outline-none text-sm bg-transparent" placeholder="案件名・現場名で検索" />
                            {searching && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />}
                        </div>
                        {results.length > 0 && (
                            <div className="mt-1 max-h-40 overflow-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
                                {results.map((p) => (
                                    <button type="button" key={p.id} onClick={() => pick(p)} className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-slate-50 truncate">{p.name || p.title}</button>
                                ))}
                            </div>
                        )}
                    </div>
                    {canRemove && (
                        <button type="button" onClick={onRemove} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg shrink-0" title="この配分を削除"><Trash2 className="w-4 h-4" /></button>
                    )}
                </div>
            )}
            {/* 費目 + 金額 */}
            <div className="flex items-center gap-2">
                <select value={row.expenseCategoryId} onChange={(e) => onChange({ expenseCategoryId: e.target.value })} className="flex-1 min-w-0 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
                    <option value="">費目を選択</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="flex items-center gap-1 shrink-0">
                    <span className="text-slate-400 text-sm">¥</span>
                    <input inputMode="numeric" value={row.amount} onChange={(e) => onChange({ amount: e.target.value.replace(/[^0-9]/g, '') })} className="w-28 px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-500" placeholder="0" />
                </div>
            </div>
            {/* 残額充当 */}
            {remainder !== 0 && (
                <button type="button" onClick={onApplyRemainder} className="text-xs text-teal-700 hover:underline">
                    残額 ¥{Math.abs(remainder).toLocaleString()} を{remainder > 0 ? 'この行に充当' : 'この行から差引'}
                </button>
            )}
        </div>
    );
}
