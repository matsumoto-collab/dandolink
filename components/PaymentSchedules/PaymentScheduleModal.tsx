'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { usePayees } from '@/hooks/usePayees';
import { PaymentSchedule, PaymentScheduleInput, PaymentType } from '@/types/paymentSchedule';
import type { Payee } from '@/types/payee';

interface PaymentScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: PaymentScheduleInput) => Promise<void>;
    initial?: PaymentSchedule | null;
    defaultPaymentDate?: string; // YYYY-MM-DD
}

const formatDate = (d: Date | string | null | undefined) => {
    if (!d) return '';
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const todayStr = () => formatDate(new Date());

const empty: PaymentScheduleInput = {
    paymentDate: todayStr(),
    paymentType: 'transfer',
    payeeId: null,
    payeeName: '',
    amount: 0,
    feeFlag: false,
    dueDate: null,
    bankName: '',
    branchName: '',
    accountType: '普通',
    accountNumber: '',
    isPaid: false,
    notes: '',
    sortOrder: 0,
};

export default function PaymentScheduleModal({
    isOpen,
    onClose,
    onSubmit,
    initial,
    defaultPaymentDate,
}: PaymentScheduleModalProps) {
    const { payees } = usePayees({ activeOnly: true });
    const [form, setForm] = useState<PaymentScheduleInput>(empty);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [payeeSearch, setPayeeSearch] = useState('');

    useEffect(() => {
        if (initial) {
            setForm({
                paymentDate: formatDate(initial.paymentDate),
                paymentType: initial.paymentType,
                payeeId: initial.payeeId ?? null,
                payeeName: initial.payeeName,
                amount: Number(initial.amount),
                feeFlag: initial.feeFlag,
                dueDate: initial.dueDate ? formatDate(initial.dueDate) : null,
                bankName: initial.bankName ?? '',
                branchName: initial.branchName ?? '',
                accountType: initial.accountType ?? '普通',
                accountNumber: initial.accountNumber ?? '',
                isPaid: initial.isPaid,
                notes: initial.notes ?? '',
                sortOrder: initial.sortOrder,
            });
        } else {
            setForm({
                ...empty,
                paymentDate: defaultPaymentDate ?? todayStr(),
            });
        }
        setPayeeSearch('');
        setError(null);
    }, [initial, isOpen, defaultPaymentDate]);

    const filteredPayees = useMemo(() => {
        const q = payeeSearch.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
        if (!q) return payees;
        return payees.filter((p) => {
            const fields = [p.name, p.nameKana, p.alias, p.bankName, p.accountNumber];
            return fields.some((f) =>
                (f ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(q)
            );
        });
    }, [payees, payeeSearch]);

    if (!isOpen) return null;

    const applyPayee = (p: Payee) => {
        setForm({
            ...form,
            payeeId: p.id,
            payeeName: p.name,
            bankName: p.bankName ?? '',
            branchName: p.branchName ?? '',
            accountType: (p.accountType as '普通' | '当座' | null) ?? '普通',
            accountNumber: p.accountNumber ?? '',
            feeFlag: p.feeBearer === 'us',
        });
        setPayeeSearch('');
    };

    const clearPayee = () => {
        setForm({ ...form, payeeId: null });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.payeeName.trim()) {
            setError('振込先名は必須です');
            return;
        }
        if (!form.paymentDate) {
            setError('支払日は必須です');
            return;
        }
        if (form.amount === null || form.amount === undefined || isNaN(Number(form.amount))) {
            setError('金額を数値で入力してください');
            return;
        }
        try {
            setSubmitting(true);
            setError(null);
            await onSubmit({
                ...form,
                amount: Number(form.amount),
                payeeId: form.payeeId || null,
                dueDate: form.dueDate || null,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存に失敗しました');
        } finally {
            setSubmitting(false);
        }
    };

    const isPaymentSlip = form.paymentType === 'payment_slip';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <h2 className="text-lg font-semibold">
                        {initial ? '支払予定を編集' : '支払予定を追加'}
                    </h2>
                    <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5 p-6">
                    {error && (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    {/* 支払種別（小さく上部に） */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">支払種別</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="paymentType"
                                    checked={form.paymentType === 'transfer'}
                                    onChange={() => setForm({ ...form, paymentType: 'transfer' as PaymentType })}
                                />
                                <span className="text-sm">銀行振込</span>
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="paymentType"
                                    checked={form.paymentType === 'payment_slip'}
                                    onChange={() => setForm({ ...form, paymentType: 'payment_slip' as PaymentType })}
                                />
                                <span className="text-sm">払込用紙（公共料金など）</span>
                            </label>
                        </div>
                    </div>

                    {/* 1. 支払日 */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                            ① 支払日 <span className="text-red-500">*</span>
                        </label>
                        {(() => {
                            const baseDate = form.paymentDate ? new Date(form.paymentDate) : new Date();
                            const baseY = baseDate.getFullYear();
                            const baseM = baseDate.getMonth();
                            const tenthStr = `${baseY}-${String(baseM + 1).padStart(2, '0')}-10`;
                            const eomDate = new Date(baseY, baseM + 1, 0);
                            const eomStr = `${eomDate.getFullYear()}-${String(eomDate.getMonth() + 1).padStart(2, '0')}-${String(eomDate.getDate()).padStart(2, '0')}`;
                            const dayNum = baseDate.getDate();
                            const isTenth = form.paymentDate === tenthStr;
                            const isEom = form.paymentDate === eomStr;
                            const isCustom = !!form.paymentDate && !isTenth && !isEom;
                            return (
                                <div className="mb-2 grid grid-cols-3 gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setForm({ ...form, paymentDate: tenthStr })}
                                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                            isTenth
                                                ? 'border-slate-800 bg-slate-800 text-white'
                                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        10日
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setForm({ ...form, paymentDate: eomStr })}
                                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                            isEom
                                                ? 'border-slate-800 bg-slate-800 text-white'
                                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        末日
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isTenth || isEom) {
                                                const d = new Date(form.paymentDate);
                                                d.setDate(d.getDate() === 10 ? 11 : d.getDate() - 1);
                                                const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                setForm({ ...form, paymentDate: ds });
                                            }
                                        }}
                                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                            isCustom
                                                ? 'border-slate-800 bg-slate-800 text-white'
                                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        指定する{isCustom && ` (${dayNum}日)`}
                                    </button>
                                </div>
                            );
                        })()}
                        <input
                            type="date"
                            value={form.paymentDate}
                            onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                            className="w-full rounded border border-slate-300 px-3 py-2"
                        />
                        <p className="mt-1 text-xs text-slate-500">
                            ボタンで「10日」「末日」を素早く選択。緊急支払いの場合はカレンダーで日付を指定
                        </p>

                        {isPaymentSlip && (
                            <div className="mt-3">
                                <label className="mb-1 block text-sm font-medium text-slate-700">振込期日</label>
                                <input
                                    type="date"
                                    value={form.dueDate ?? ''}
                                    onChange={(e) => setForm({ ...form, dueDate: e.target.value || null })}
                                    className="w-full rounded border border-slate-300 px-3 py-2"
                                />
                            </div>
                        )}
                    </div>

                    {/* 2. 振込先指定 */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                            ② 振込先指定 <span className="text-red-500">*</span>
                        </label>

                        {/* マスターから選択（振込のみ） */}
                        {!isPaymentSlip && (
                            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-3">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-xs font-medium text-slate-600">マスターから選択</span>
                                    {form.payeeId && (
                                        <button
                                            type="button"
                                            onClick={clearPayee}
                                            className="text-xs text-slate-500 hover:underline"
                                        >
                                            マスターから外す
                                        </button>
                                    )}
                                </div>
                                {!form.payeeId && (
                                    <>
                                        <input
                                            type="text"
                                            value={payeeSearch}
                                            onChange={(e) => setPayeeSearch(e.target.value)}
                                            className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                            placeholder="振込先を検索..."
                                        />
                                        {payeeSearch && (
                                            <div className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white">
                                                {filteredPayees.length === 0 ? (
                                                    <div className="px-3 py-2 text-sm text-slate-500">該当なし</div>
                                                ) : (
                                                    filteredPayees.slice(0, 20).map((p) => (
                                                        <button
                                                            type="button"
                                                            key={p.id}
                                                            onClick={() => applyPayee(p)}
                                                            className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                                                        >
                                                            <div className="font-medium">{p.name}</div>
                                                            <div className="text-xs text-slate-500">
                                                                {p.bankName} {p.branchName} {p.accountType}{' '}
                                                                {p.accountNumber}
                                                            </div>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                                {form.payeeId && (
                                    <div className="rounded bg-white px-3 py-2 text-sm border border-slate-200">
                                        マスター連動中: <span className="font-medium">{form.payeeName}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 振込先名 */}
                        <div className="mb-2">
                            <label className="mb-1 block text-xs font-medium text-slate-600">振込先名</label>
                            <input
                                type="text"
                                value={form.payeeName}
                                onChange={(e) => setForm({ ...form, payeeName: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                placeholder="例：㈱開成工業"
                            />
                        </div>

                        {/* 銀行情報（振込のみ） */}
                        {!isPaymentSlip && (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                <div className="md:col-span-1">
                                    <label className="mb-1 block text-xs font-medium text-slate-600">銀行名</label>
                                    <input
                                        type="text"
                                        value={form.bankName ?? ''}
                                        onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="mb-1 block text-xs font-medium text-slate-600">支店名</label>
                                    <input
                                        type="text"
                                        value={form.branchName ?? ''}
                                        onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="mb-1 block text-xs font-medium text-slate-600">種別</label>
                                    <select
                                        value={form.accountType ?? ''}
                                        onChange={(e) =>
                                            setForm({
                                                ...form,
                                                accountType:
                                                    e.target.value === ''
                                                        ? null
                                                        : (e.target.value as '普通' | '当座'),
                                            })
                                        }
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        <option value="">--</option>
                                        <option value="普通">普通</option>
                                        <option value="当座">当座</option>
                                    </select>
                                </div>
                                <div className="md:col-span-1">
                                    <label className="mb-1 block text-xs font-medium text-slate-600">口座番号</label>
                                    <input
                                        type="text"
                                        value={form.accountNumber ?? ''}
                                        onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 3. 手数料 */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">③ 手数料</label>
                        <label className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.feeFlag ?? false}
                                onChange={(e) => setForm({ ...form, feeFlag: e.target.checked })}
                            />
                            <span className="text-sm">手数料を当社負担にする（●）</span>
                        </label>
                    </div>

                    {/* 4. 金額 */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                            ④ 金額 <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="number"
                            step="1"
                            min="0"
                            value={form.amount}
                            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                            className="w-full rounded border border-slate-300 px-3 py-2 text-right text-lg font-semibold"
                        />
                    </div>

                    {/* 5. 備考 */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">⑤ 備考</label>
                        <textarea
                            value={form.notes ?? ''}
                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            className="w-full rounded border border-slate-300 px-3 py-2"
                            rows={2}
                            placeholder="補足事項があれば入力"
                        />
                    </div>

                    {/* 支払済（編集時用） */}
                    {initial && (
                        <div className="border-t pt-4">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={form.isPaid ?? false}
                                    onChange={(e) => setForm({ ...form, isPaid: e.target.checked })}
                                />
                                <span className="text-sm">支払済みにする</span>
                            </label>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            キャンセル
                        </Button>
                        <Button type="submit" variant="primary" isLoading={submitting}>
                            {initial ? '更新' : '追加'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
