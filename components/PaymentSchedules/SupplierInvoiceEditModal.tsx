'use client';

import React, { useMemo, useState } from 'react';
import { X, AlertTriangle, FileText, Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { usePayees } from '@/hooks/usePayees';
import type { SupplierInvoice } from '@/types/supplierInvoice';
import type { Payee } from '@/types/payee';
import { hasAccountMismatch } from '@/lib/accountMatch';
import { toInputDate } from '@/components/CreditCard/uploadPrep';

interface Props {
    invoice: SupplierInvoice;
    canEdit: boolean;
    onClose: () => void;
    onSaved: () => void;
}

interface FormState {
    payeeName: string;
    payeeKana: string;
    bankName: string;
    branchName: string;
    accountType: string; // '' | '普通' | '当座'
    accountNumber: string;
    accountHolder: string;
    issueDate: string; // YYYY-MM-DD or ''
    dueDate: string;
    totalAmount: string;
    taxAmount: string;
    registrationNumber: string;
    notes: string;
    payeeId: string | null;
}

// 請求書の詳細編集（口座情報・マスター照合・AI再読取）。
// マスター照合は「請求書に書かれた値はそのまま・payeeId だけ付け外し」する方針
// （請求書の記載とマスターの差分＝口座変更検知を活かすため、値の上書きはしない）。
export default function SupplierInvoiceEditModal({ invoice, canEdit, onClose, onSaved }: Props) {
    const { payees } = usePayees({ activeOnly: true });
    const [form, setForm] = useState<FormState>({
        payeeName: invoice.payeeName ?? '',
        payeeKana: invoice.payeeKana ?? '',
        bankName: invoice.bankName ?? '',
        branchName: invoice.branchName ?? '',
        accountType: invoice.accountType ?? '',
        accountNumber: invoice.accountNumber ?? '',
        accountHolder: invoice.accountHolder ?? '',
        issueDate: toInputDate(invoice.issueDate),
        dueDate: toInputDate(invoice.dueDate),
        totalAmount: invoice.totalAmount != null ? String(Number(invoice.totalAmount)) : '',
        taxAmount: invoice.taxAmount != null ? String(Number(invoice.taxAmount)) : '',
        registrationNumber: invoice.registrationNumber ?? '',
        notes: invoice.notes ?? '',
        payeeId: invoice.payeeId ?? null,
    });
    const [payeeSearch, setPayeeSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const added = Boolean(invoice.paymentScheduleId);
    const isPdf = invoice.mimeType === 'application/pdf' || invoice.sourceType === 'pdf';

    const selectedPayee: Payee | null = useMemo(
        () => (form.payeeId ? payees.find((p) => p.id === form.payeeId) ?? invoice.payee : null),
        [form.payeeId, payees, invoice.payee],
    );
    const mismatch = hasAccountMismatch(selectedPayee, { accountNumber: form.accountNumber || null });

    const filteredPayees = useMemo(() => {
        const q = payeeSearch.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
        if (!q) return [];
        return payees
            .filter((p) => {
                const fields = [p.name, p.nameKana, p.alias, p.bankName, p.accountNumber];
                return fields.some((f) => (f ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(q));
            })
            .slice(0, 20);
    }, [payees, payeeSearch]);

    const handleSave = async () => {
        try {
            setSubmitting(true);
            setError(null);
            const res = await fetch(`/api/supplier-invoices/${invoice.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payeeName: form.payeeName,
                    payeeKana: form.payeeKana,
                    bankName: form.bankName,
                    branchName: form.branchName,
                    accountType: form.accountType || null,
                    accountNumber: form.accountNumber,
                    accountHolder: form.accountHolder,
                    issueDate: form.issueDate || null,
                    dueDate: form.dueDate || null,
                    totalAmount: form.totalAmount === '' ? null : form.totalAmount,
                    taxAmount: form.taxAmount === '' ? null : form.taxAmount,
                    registrationNumber: form.registrationNumber,
                    notes: form.notes,
                    payeeId: form.payeeId,
                }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || '保存に失敗しました');
            }
            toast.success('保存しました');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存に失敗しました');
        } finally {
            setSubmitting(false);
        }
    };

    // AIで再読取（未追加のみ）。読み取り結果はサーバーで保存されるので、閉じて一覧を更新する
    const handleReExtract = async () => {
        if (!confirm('AIで読み取り直しますか？\n手で修正した内容は読み取り結果で上書きされます。')) return;
        try {
            setExtracting(true);
            setError(null);
            const res = await fetch(`/api/supplier-invoices/${invoice.id}/extract`, { method: 'POST' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || '再読み取りに失敗しました');
            }
            toast.success('読み取り直しました');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : '再読み取りに失敗しました');
        } finally {
            setExtracting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <h2 className="text-lg font-semibold">請求書の詳細</h2>
                    <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-5 p-6">
                    {/* 証憑プレビュー */}
                    <div className="space-y-2">
                        {isPdf ? (
                            invoice.signedUrl ? (
                                <a
                                    href={invoice.signedUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-8 text-slate-500 hover:bg-slate-100"
                                >
                                    <FileText className="w-10 h-10" />
                                    <span className="text-xs">PDFを開く</span>
                                </a>
                            ) : (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400 text-xs">プレビューなし</div>
                            )
                        ) : invoice.signedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={invoice.signedUrl} alt={invoice.fileName} className="w-full rounded-xl border border-slate-200 object-contain max-h-[420px] bg-slate-50" />
                        ) : (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400 text-xs">プレビューなし</div>
                        )}
                        <p className="text-[11px] text-slate-400 truncate" title={invoice.fileName}>{invoice.fileName}</p>
                        {canEdit && !added && (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleReExtract}
                                disabled={extracting || submitting}
                                leftIcon={extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                className="w-full"
                            >
                                {extracting ? 'AI読み取り中…' : 'AIで再読取'}
                            </Button>
                        )}
                    </div>

                    {/* フォーム */}
                    <div className="space-y-4">
                        {error && (
                            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                        )}
                        {added && (
                            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                支払予定に追加済みです。ここでの修正は受け箱の記録にのみ反映され、作成済みの支払予定は変わりません。
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">請求元（振込先名）</label>
                                <input
                                    type="text"
                                    value={form.payeeName}
                                    onChange={(e) => setForm({ ...form, payeeName: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="例：株式会社山田建材"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">フリガナ</label>
                                <input
                                    type="text"
                                    value={form.payeeKana}
                                    onChange={(e) => setForm({ ...form, payeeKana: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="例：ヤマダケンザイ"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">発行日</label>
                                <input
                                    type="date"
                                    value={form.issueDate}
                                    onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">支払期日</label>
                                <input
                                    type="date"
                                    value={form.dueDate}
                                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">金額（税込）</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={form.totalAmount}
                                    onChange={(e) => setForm({ ...form, totalAmount: e.target.value.replace(/[^\d]/g, '') })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-right font-semibold"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">うち消費税</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={form.taxAmount}
                                    onChange={(e) => setForm({ ...form, taxAmount: e.target.value.replace(/[^\d]/g, '') })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-right"
                                />
                            </div>
                        </div>

                        {/* 振込先口座（請求書に書かれた値） */}
                        <div className="rounded border border-slate-200 bg-slate-50 p-3">
                            <div className="mb-2 text-xs font-medium text-slate-600">振込先口座（請求書の記載）</div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                <input
                                    type="text"
                                    value={form.bankName}
                                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="銀行名"
                                />
                                <input
                                    type="text"
                                    value={form.branchName}
                                    onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="支店名"
                                />
                                <select
                                    value={form.accountType}
                                    onChange={(e) => setForm({ ...form, accountType: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                >
                                    <option value="">種別 --</option>
                                    <option value="普通">普通</option>
                                    <option value="当座">当座</option>
                                </select>
                                <input
                                    type="text"
                                    value={form.accountNumber}
                                    onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="口座番号"
                                />
                                <input
                                    type="text"
                                    value={form.accountHolder}
                                    onChange={(e) => setForm({ ...form, accountHolder: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm md:col-span-4"
                                    placeholder="口座名義（例：カ）ヤマダケンザイ）"
                                />
                            </div>
                        </div>

                        {/* マスター照合 */}
                        <div className="rounded border border-slate-200 p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-medium text-slate-600">振込先マスター照合</span>
                                {form.payeeId && canEdit && (
                                    <button type="button" onClick={() => setForm({ ...form, payeeId: null })} className="text-xs text-slate-500 hover:underline">
                                        照合を外す
                                    </button>
                                )}
                            </div>
                            {selectedPayee ? (
                                <div className={`rounded px-3 py-2 text-sm border ${mismatch ? 'border-red-300 bg-red-50' : 'border-teal-200 bg-teal-50'}`}>
                                    <div className="font-medium text-slate-800">✓ {selectedPayee.name}</div>
                                    <div className="text-xs text-slate-600 mt-0.5">
                                        マスター登録口座: {selectedPayee.bankName} {selectedPayee.branchName} {selectedPayee.accountType} {selectedPayee.accountNumber ?? '（未登録）'}
                                    </div>
                                    {mismatch && (
                                        <div className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-red-700">
                                            <AlertTriangle className="w-4 h-4 shrink-0" />
                                            <span>
                                                請求書の口座（{form.accountNumber}）がマスターと一致しません。取引先の口座変更か、請求書の口座差し替え（詐欺）の可能性があります。振込前に取引先へ電話等で確認してください。
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <p className="mb-2 text-xs text-amber-700">
                                        マスターに一致がありません。支払予定への追加時に上の内容で新規登録されます。既存のマスターに紐付ける場合は検索してください。
                                    </p>
                                    {canEdit && (
                                        <>
                                            <input
                                                type="text"
                                                value={payeeSearch}
                                                onChange={(e) => setPayeeSearch(e.target.value)}
                                                className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                                placeholder="振込先マスターを検索..."
                                            />
                                            {payeeSearch && (
                                                <div className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-white">
                                                    {filteredPayees.length === 0 ? (
                                                        <div className="px-3 py-2 text-sm text-slate-500">該当なし</div>
                                                    ) : (
                                                        filteredPayees.map((p) => (
                                                            <button
                                                                type="button"
                                                                key={p.id}
                                                                onClick={() => {
                                                                    setForm({ ...form, payeeId: p.id });
                                                                    setPayeeSearch('');
                                                                }}
                                                                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                                                            >
                                                                <div className="font-medium">{p.name}</div>
                                                                <div className="text-xs text-slate-500">
                                                                    {p.bankName} {p.branchName} {p.accountType} {p.accountNumber}
                                                                </div>
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">インボイス登録番号</label>
                                <input
                                    type="text"
                                    value={form.registrationNumber}
                                    onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="T1234567890123"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-slate-600">備考</label>
                                <input
                                    type="text"
                                    value={form.notes}
                                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                    disabled={!canEdit}
                                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 border-t pt-4">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                閉じる
                            </Button>
                            {canEdit && (
                                <Button type="button" variant="primary" onClick={handleSave} isLoading={submitting} disabled={extracting}>
                                    保存
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
