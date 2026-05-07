'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Payee, PayeeInput } from '@/types/payee';

interface PayeeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: PayeeInput) => Promise<void>;
    initial?: Payee | null;
}

const empty: PayeeInput = {
    name: '',
    nameKana: '',
    alias: '',
    feeBearer: 'them',
    bankName: '',
    branchName: '',
    accountType: '普通',
    accountNumber: '',
    accountHolder: '',
    notes: '',
    isActive: true,
};

export default function PayeeModal({ isOpen, onClose, onSubmit, initial }: PayeeModalProps) {
    const [form, setForm] = useState<PayeeInput>(empty);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (initial) {
            setForm({
                name: initial.name,
                nameKana: initial.nameKana ?? '',
                alias: initial.alias ?? '',
                feeBearer: initial.feeBearer,
                bankName: initial.bankName ?? '',
                branchName: initial.branchName ?? '',
                accountType: initial.accountType ?? '普通',
                accountNumber: initial.accountNumber ?? '',
                accountHolder: initial.accountHolder ?? '',
                notes: initial.notes ?? '',
                isActive: initial.isActive,
            });
        } else {
            setForm(empty);
        }
        setError(null);
    }, [initial, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) {
            setError('振込先名は必須です');
            return;
        }
        try {
            setSubmitting(true);
            setError(null);
            await onSubmit(form);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存に失敗しました');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <h2 className="text-lg font-semibold">
                        {initial ? '振込先を編集' : '振込先を追加'}
                    </h2>
                    <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 p-6">
                    {error && (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                            <label className="mb-1 block text-sm font-medium">
                                振込先名 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                                placeholder="例：㈱開成工業"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium">フリガナ</label>
                            <input
                                type="text"
                                value={form.nameKana ?? ''}
                                onChange={(e) => setForm({ ...form, nameKana: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                placeholder="例：カイセイコウギョウ"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium">略称</label>
                            <input
                                type="text"
                                value={form.alias ?? ''}
                                onChange={(e) => setForm({ ...form, alias: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                placeholder="例：開成"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="mb-1 block text-sm font-medium">手数料負担</label>
                            <div className="flex gap-4">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="feeBearer"
                                        checked={form.feeBearer === 'them'}
                                        onChange={() => setForm({ ...form, feeBearer: 'them' })}
                                    />
                                    <span>先方負担（手数料を引いて振込）</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="feeBearer"
                                        checked={form.feeBearer === 'us'}
                                        onChange={() => setForm({ ...form, feeBearer: 'us' })}
                                    />
                                    <span>当社負担（Excelの「●」マーク）</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium">銀行名</label>
                            <input
                                type="text"
                                value={form.bankName ?? ''}
                                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                placeholder="例：愛媛銀行"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium">支店名</label>
                            <input
                                type="text"
                                value={form.branchName ?? ''}
                                onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                placeholder="例：見奈良支店"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium">口座種別</label>
                            <select
                                value={form.accountType ?? ''}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        accountType: e.target.value === '' ? null : (e.target.value as '普通' | '当座'),
                                    })
                                }
                                className="w-full rounded border border-slate-300 px-3 py-2"
                            >
                                <option value="">選択してください</option>
                                <option value="普通">普通</option>
                                <option value="当座">当座</option>
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium">口座番号</label>
                            <input
                                type="text"
                                value={form.accountNumber ?? ''}
                                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                placeholder="例：3711502"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="mb-1 block text-sm font-medium">口座名義（カナ）</label>
                            <input
                                type="text"
                                value={form.accountHolder ?? ''}
                                onChange={(e) => setForm({ ...form, accountHolder: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                placeholder="例：カ）オーケーグランデ"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="mb-1 block text-sm font-medium">備考</label>
                            <textarea
                                value={form.notes ?? ''}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                                rows={3}
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={form.isActive}
                                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                                />
                                <span className="text-sm">有効（利用中）</span>
                            </label>
                        </div>
                    </div>

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
